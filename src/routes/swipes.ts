import { Router, type IRouter } from "express";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, swipesTable, matchesTable, usersTable } from "@workspace/db";
import { requireAuthAndNotBanned as requireAuth } from "../middleware/auth";
import { sendPushNotifications } from "../lib/notifications";

const router: IRouter = Router();
const DAILY_SWIPE_LIMIT = 20;

const swipeSchema = z.object({
  swipedUserId: z.string().uuid("Invalid user ID"),
  direction: z.enum(["left", "right"]),
});

router.get("/swipes/remaining", requireAuth, async (req, res) => {
  const swiperId = req.user!.userId;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(swipesTable)
    .where(and(eq(swipesTable.swiperId, swiperId), gte(swipesTable.createdAt, todayStart)));

  const remaining = Math.max(0, DAILY_SWIPE_LIMIT - (count ?? 0));
  res.json({ remaining, limit: DAILY_SWIPE_LIMIT, used: count ?? 0 });
});

router.post("/swipes", requireAuth, async (req, res) => {
  const parsed = swipeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }

  const { swipedUserId, direction } = parsed.data;
  const swiperId = req.user!.userId;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(swipesTable)
    .where(and(eq(swipesTable.swiperId, swiperId), gte(swipesTable.createdAt, todayStart)));

  if ((count ?? 0) >= DAILY_SWIPE_LIMIT) {
    res.status(429).json({
      error: "Daily swipe limit reached",
      code: "SWIPE_LIMIT_REACHED",
      limit: DAILY_SWIPE_LIMIT,
      resetsAt: new Date(new Date().setHours(24, 0, 0, 0)).toISOString(),
    });
    return;
  }

  if (swipedUserId === swiperId) {
    res.status(400).json({ error: "Cannot swipe on yourself" });
    return;
  }

  try {
    await db
      .insert(swipesTable)
      .values({ swiperId, swipedId: swipedUserId, direction })
      .onConflictDoNothing();
  } catch {
    res.status(400).json({ error: "Invalid user" });
    return;
  }

  if (direction === "right") {
    const theirSwipe = await db
      .select()
      .from(swipesTable)
      .where(
        and(
          eq(swipesTable.swiperId, swipedUserId),
          eq(swipesTable.swipedId, swiperId),
          eq(swipesTable.direction, "right")
        )
      )
      .limit(1);

    if (theirSwipe.length > 0) {
      const [user1Id, user2Id] = [swiperId, swipedUserId].sort();

      const existing = await db
        .select({ id: matchesTable.id })
        .from(matchesTable)
        .where(
          and(eq(matchesTable.user1Id, user1Id), eq(matchesTable.user2Id, user2Id))
        )
        .limit(1);

      if (existing.length === 0) {
        const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
        const [match] = await db
          .insert(matchesTable)
          .values({ user1Id, user2Id, expiresAt, messageRequestAccepted: false })
          .returning({ id: matchesTable.id });

        const matchId = match?.id ?? null;

        const [swiper, swiped] = await Promise.all([
          db.select({ name: usersTable.name, pushToken: usersTable.pushToken })
            .from(usersTable).where(eq(usersTable.id, swiperId)).limit(1),
          db.select({ name: usersTable.name, pushToken: usersTable.pushToken })
            .from(usersTable).where(eq(usersTable.id, swipedUserId)).limit(1),
        ]);

        const notifications = [];
        if (swiper[0]?.pushToken) {
          notifications.push({
            to: swiper[0].pushToken,
            title: "It's a match! 🎉",
            body: "You matched with someone on Blind Swipe. Start the conversation!",
            data: { type: "match", matchId },
          });
        }
        if (swiped[0]?.pushToken) {
          notifications.push({
            to: swiped[0].pushToken,
            title: "It's a match! 🎉",
            body: "You matched with someone on Blind Swipe. Start the conversation!",
            data: { type: "match", matchId },
          });
        }
        sendPushNotifications(notifications);

        res.json({ matched: true, matchId });
        return;
      }

      res.json({ matched: true, matchId: existing[0]!.id });
      return;
    }
  }

  res.json({ matched: false, matchId: null });
});

export default router;
