import { Router, type IRouter } from "express";
import { and, desc, eq, isNull, lt, ne, or, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  matchesTable,
  messagesTable,
  swipesTable,
  usersTable,
  reportsTable,
} from "@workspace/db";
import { requireAuthAndNotBanned as requireAuth } from "../middleware/auth";
import { sendPushNotification } from "../lib/notifications";
import { emitToUser, emitToMatch } from "../lib/socket";

const router: IRouter = Router();
const REVEAL_THRESHOLD = 5;

const DANGEROUS_KEYWORDS: string[] = [
  "send me nudes", "send nudes", "nudes", "nude pic", "nude photo",
  "how old are you really", "you seem young", "are you a minor", "are you underage",
  "don't tell anyone", "our secret", "keep this secret", "don't tell your parents",
  "meet me alone", "come to my place", "come home with me",
  "i'll pay you", "i'll give you money", "cash for pics", "money for photos",
  "snap me", "kik me", "telegram me", "what's your snap", "whatsapp me outside",
  "send me your address", "where do you live exactly", "what's your home address",
  "sexual", "sex with", "sleep with me", "hook up now", "casual sex",
  "18?", "are you 18", "prove you're 18",
  "child", "underage", "minor", "teen", "teenager", "jailbait",
  "grooming", "exploitation",
];

function scanForDangerousContent(content: string): { flagged: boolean; reason: string | null } {
  const lower = content.toLowerCase();
  for (const kw of DANGEROUS_KEYWORDS) {
    if (lower.includes(kw)) {
      return { flagged: true, reason: `Matched keyword: "${kw}"` };
    }
  }
  const phonePattern = /(\+?1?\s*[-.]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/;
  if (phonePattern.test(content)) {
    return { flagged: true, reason: "Phone number detected" };
  }
  return { flagged: false, reason: null };
}

type UserRow = typeof usersTable.$inferSelect;

function computeCompatibility(me: UserRow, other: UserRow): { score: number; isCompatible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (me.intent && other.intent && me.intent !== "" && me.intent === other.intent) {
    score++;
    reasons.push("Same relationship goal");
  }

  if (me.drinking && other.drinking && me.drinking !== "" && me.drinking === other.drinking) {
    score++;
    reasons.push("Same drinking habits");
  }

  if (me.smoking && other.smoking && me.smoking !== "" && me.smoking === other.smoking) {
    score++;
    reasons.push("Same smoking habits");
  }

  const meAge = me.age;
  const otherAge = other.age;
  if (meAge && other.minAgePreference && other.maxAgePreference &&
      meAge >= other.minAgePreference && meAge <= other.maxAgePreference) {
    score++;
    reasons.push("You fit their age preference");
  }

  if (otherAge && me.minAgePreference && me.maxAgePreference &&
      otherAge >= me.minAgePreference && otherAge <= me.maxAgePreference) {
    score++;
    reasons.push("They fit your age preference");
  }

  if (me.city && other.city && me.city !== "" &&
      me.city.toLowerCase().trim() === other.city.toLowerCase().trim()) {
    score++;
    reasons.push("Same city");
  }

  if (me.relationshipGoal && other.relationshipGoal && me.relationshipGoal !== "" &&
      me.relationshipGoal === other.relationshipGoal) {
    score++;
    reasons.push("Same life goals");
  }

  return { score, isCompatible: score >= 3, reasons };
}

async function buildMatchRecord(
  match: typeof matchesTable.$inferSelect,
  currentUserId: string,
  currentUser: UserRow | null,
  lastMsg?: { content: string; createdAt: Date } | null
) {
  const otherUserId =
    match.user1Id === currentUserId ? match.user2Id : match.user1Id;

  const [otherUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, otherUserId))
    .limit(1);

  if (!otherUser) return null;

  const photosToReturn = match.status === "revealed" ? otherUser.photos : [];

  const myMessageCount = match.user1Id === currentUserId
    ? match.user1MessageCount
    : match.user2MessageCount;
  const theirMessageCount = match.user1Id === currentUserId
    ? match.user2MessageCount
    : match.user1MessageCount;

  const compatibility = currentUser
    ? computeCompatibility(currentUser, otherUser)
    : { score: 0, isCompatible: false, reasons: [] };

  function activeLabel(d: Date | null | undefined): string | null {
    if (!d) return null;
    const diff = Date.now() - d.getTime();
    if (diff < 24 * 3600000) return "Active today";
    if (diff < 7 * 24 * 3600000) return "Active this week";
    return null;
  }

  return {
    id: match.id,
    otherUser: {
      id: otherUser.id,
      name: otherUser.name || "Anonymous",
      age: otherUser.age ?? null,
      city: otherUser.city || "",
      intent: otherUser.intent || "",
      bio: otherUser.bio || "",
      photos: photosToReturn,
      prompts: [] as { question: string; answer: string }[],
      activeLabel: activeLabel(otherUser.lastActiveAt),
    },
    messageCount: match.messageCount,
    myMessageCount,
    theirMessageCount,
    isCompatible: compatibility.isCompatible,
    compatibilityScore: compatibility.score,
    compatibilityReasons: compatibility.reasons,
    status: match.status,
    lastMessage: lastMsg?.content ?? null,
    lastActivity:
      lastMsg?.createdAt?.toISOString() ?? match.updatedAt.toISOString(),
    createdAt: match.createdAt.toISOString(),
    expiresAt: match.expiresAt?.toISOString() ?? null,
    messageRequestAccepted: match.messageRequestAccepted,
    unmatchedAt: match.unmatchedAt?.toISOString() ?? null,
    unmatchedBy: match.unmatchedBy ?? null,
  };
}

router.get("/matches", requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  const now = new Date();

  const [currentUser, allMatches] = await Promise.all([
    db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1).then((r) => r[0] ?? null),
    db.select().from(matchesTable)
      .where(or(eq(matchesTable.user1Id, userId), eq(matchesTable.user2Id, userId)))
      .orderBy(desc(matchesTable.updatedAt)),
  ]);

  const expiredMatches = allMatches.filter(
    (m) => m.expiresAt !== null && m.expiresAt < now && m.messageCount === 0
  );
  if (expiredMatches.length > 0) {
    await Promise.all(
      expiredMatches.map(async (m) => {
        await db.delete(messagesTable).where(eq(messagesTable.matchId, m.id));
        await db.delete(matchesTable).where(eq(matchesTable.id, m.id));
      })
    );
  }

  const activeMatches = allMatches.filter(
    (m) => !(m.expiresAt !== null && m.expiresAt < now && m.messageCount === 0)
  );

  const results = await Promise.all(
    activeMatches.map(async (match) => {
      const [lastMsg] = await db
        .select({
          content: messagesTable.content,
          createdAt: messagesTable.createdAt,
        })
        .from(messagesTable)
        .where(eq(messagesTable.matchId, match.id))
        .orderBy(desc(messagesTable.createdAt))
        .limit(1);

      return buildMatchRecord(match, userId, currentUser, lastMsg);
    })
  );

  res.json(results.filter(Boolean));
});

router.get("/matches/:matchId/messages", requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  const matchId = String(req.params["matchId"]);

  const [match] = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.id, matchId))
    .limit(1);

  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  if (match.user1Id !== userId && match.user2Id !== userId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const cursor = req.query["cursor"] as string | undefined;
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10) || 50, 100);

  const msgs = await db
    .select()
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.matchId, matchId),
        cursor ? lt(messagesTable.createdAt, new Date(cursor)) : undefined
      )
    )
    .orderBy(desc(messagesTable.createdAt))
    .limit(limit);

  res.json(
    msgs.reverse().map((m) => ({
      id: m.id,
      matchId: m.matchId,
      senderId: m.senderId,
      content: m.content,
      type: m.type,
      createdAt: m.createdAt.toISOString(),
    }))
  );
});

const sendMsgSchema = z.object({
  content: z.string().min(1, "Message cannot be empty").max(2000),
});

router.post("/matches/:matchId/messages", requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  const matchId = String(req.params["matchId"]);

  const parsed = sendMsgSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }

  const [match] = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.id, matchId))
    .limit(1);

  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  if (match.user1Id !== userId && match.user2Id !== userId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const scan = scanForDangerousContent(parsed.data.content);

  const [msg] = await db
    .insert(messagesTable)
    .values({
      matchId,
      senderId: userId,
      content: parsed.data.content,
      isFlagged: scan.flagged,
      flagReason: scan.reason ?? undefined,
    })
    .returning();

  if (scan.flagged && scan.reason) {
    const recipientId2 = match.user1Id === userId ? match.user2Id : match.user1Id;
    await db.insert(reportsTable).values({
      reporterId: recipientId2,
      reportedId: userId,
      reason: "Flagged message",
      notes: `Auto-flagged: ${scan.reason}. Message: "${parsed.data.content.slice(0, 200)}"`,
    }).onConflictDoNothing();
  }

  if (!msg) {
    res.status(500).json({ error: "Failed to send message" });
    return;
  }

  const isUser1 = match.user1Id === userId;
  const newUser1Count = isUser1 ? match.user1MessageCount + 1 : match.user1MessageCount;
  const newUser2Count = isUser1 ? match.user2MessageCount : match.user2MessageCount + 1;
  const newCount = match.messageCount + 1;

  const bothReachedThreshold = newUser1Count >= REVEAL_THRESHOLD && newUser2Count >= REVEAL_THRESHOLD;
  const newStatus = bothReachedThreshold ? "revealed" : match.status;

  const [updatedMatch] = await db
    .update(matchesTable)
    .set({
      messageCount: newCount,
      user1MessageCount: newUser1Count,
      user2MessageCount: newUser2Count,
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(matchesTable.id, matchId))
    .returning();

  if (!updatedMatch) {
    res.status(500).json({ error: "Failed to update match" });
    return;
  }

  const recipientId =
    updatedMatch.user1Id === userId ? updatedMatch.user2Id : updatedMatch.user1Id;

  const [currentUserRow, sender, recipient] = await Promise.all([
    db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1).then((r) => r[0] ?? null),
    db.select({ name: usersTable.name })
      .from(usersTable).where(eq(usersTable.id, userId)).limit(1),
    db.select({ pushToken: usersTable.pushToken })
      .from(usersTable).where(eq(usersTable.id, recipientId)).limit(1),
  ]);

  const matchRecord = await buildMatchRecord(updatedMatch, userId, currentUserRow, {
    content: msg.content,
    createdAt: msg.createdAt,
  });

  const senderName = sender[0]?.name || "Someone";
  const isReveal = newStatus === "revealed" && match.status !== "revealed";

  const newMsgPayload = {
    id: msg.id,
    matchId: msg.matchId,
    senderId: msg.senderId,
    content: msg.content,
    type: msg.type,
    createdAt: msg.createdAt.toISOString(),
  };

  emitToMatch(matchId, "new_message", newMsgPayload);
  if (isReveal) {
    emitToUser(recipientId, "match_revealed", { matchId });
    emitToUser(userId, "match_revealed", { matchId });
  }
  emitToUser(recipientId, "new_message", { ...newMsgPayload, senderName });

  if (recipient[0]?.pushToken) {
    sendPushNotification({
      to: recipient[0].pushToken,
      title: isReveal ? "Photos unlocked!" : `${senderName} sent you a message`,
      body: isReveal
        ? `${senderName} and you have unlocked each other's photos!`
        : parsed.data.content.length > 80
        ? parsed.data.content.slice(0, 77) + "…"
        : parsed.data.content,
      data: { type: isReveal ? "reveal" : "message", matchId },
    });
  }

  res.status(201).json({
    message: {
      id: msg.id,
      matchId: msg.matchId,
      senderId: msg.senderId,
      content: msg.content,
      type: msg.type,
      isFlagged: msg.isFlagged,
      createdAt: msg.createdAt.toISOString(),
    },
    match: matchRecord,
    flaggedWarning: scan.flagged
      ? "Your message has been flagged for review. Sending harmful, explicit, or soliciting content violates our Community Guidelines and may result in a permanent ban."
      : null,
  });
});

router.post("/matches/:matchId/messages/read", requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  const matchId = String(req.params["matchId"]);

  const [match] = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.id, matchId))
    .limit(1);

  if (!match || (match.user1Id !== userId && match.user2Id !== userId)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const readNow = new Date();
  await db
    .update(messagesTable)
    .set({ readAt: readNow })
    .where(
      and(
        eq(messagesTable.matchId, matchId),
        isNull(messagesTable.readAt),
        ne(messagesTable.senderId, userId)
      )
    );

  const senderId = match.user1Id === userId ? match.user2Id : match.user1Id;
  emitToUser(senderId, "messages_read", { matchId, readAt: readNow.toISOString() });

  res.json({ readAt: readNow.toISOString() });
});

router.post("/matches/:matchId/unmatch", requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  const matchId = String(req.params["matchId"]);

  const [match] = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.id, matchId))
    .limit(1);

  if (!match || (match.user1Id !== userId && match.user2Id !== userId)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  if (match.unmatchedAt) {
    res.json({ message: "Already unmatched" });
    return;
  }

  await db
    .update(matchesTable)
    .set({ unmatchedBy: userId, unmatchedAt: new Date(), status: "unmatched" })
    .where(eq(matchesTable.id, matchId));

  const otherId = match.user1Id === userId ? match.user2Id : match.user1Id;
  emitToUser(otherId, "unmatched", { matchId });

  res.json({ message: "Unmatched successfully" });
});

router.post("/matches/:matchId/accept", requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  const matchId = String(req.params["matchId"]);

  const [match] = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.id, matchId))
    .limit(1);

  if (!match || (match.user1Id !== userId && match.user2Id !== userId)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  await db
    .update(matchesTable)
    .set({ messageRequestAccepted: true })
    .where(eq(matchesTable.id, matchId));

  const otherId = match.user1Id === userId ? match.user2Id : match.user1Id;
  emitToUser(otherId, "match_accepted", { matchId });

  res.json({ message: "Match accepted" });
});

router.delete("/matches/:matchId", requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  const matchId = String(req.params["matchId"]);

  const [match] = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.id, matchId))
    .limit(1);

  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  if (match.user1Id !== userId && match.user2Id !== userId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const otherUserId = match.user1Id === userId ? match.user2Id : match.user1Id;

  await db.delete(messagesTable).where(eq(messagesTable.matchId, matchId));
  await db.delete(matchesTable).where(eq(matchesTable.id, matchId));

  const existingSwipe = await db
    .select()
    .from(swipesTable)
    .where(and(eq(swipesTable.swiperId, userId), eq(swipesTable.swipedId, otherUserId)))
    .limit(1);

  if (existingSwipe.length === 0) {
    await db.insert(swipesTable).values({
      swiperId: userId,
      swipedId: otherUserId,
      direction: "left",
    });
  }

  res.json({ message: "Conversation ended" });
});

export default router;
