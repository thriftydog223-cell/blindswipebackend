import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, reportsTable, usersTable, swipesTable, matchesTable, messagesTable } from "@workspace/db";
import { eq, and, or } from "drizzle-orm";
import { requireAuthAndNotBanned } from "../middleware/auth";

const router: IRouter = Router();

const submitReportSchema = z.object({
  reportedUserId: z.string().uuid(),
  reason: z.string().min(1).max(200),
  notes: z.string().max(1000).optional(),
});

router.post("/reports", requireAuthAndNotBanned, async (req, res) => {
  const parsed = submitReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }

  const { reportedUserId, reason, notes } = parsed.data;
  const reporterId = req.user!.userId;

  if (reportedUserId === reporterId) {
    res.status(400).json({ error: "You cannot report yourself" });
    return;
  }

  const [reported] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, reportedUserId))
    .limit(1);

  if (!reported) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const existing = await db
    .select({ id: reportsTable.id })
    .from(reportsTable)
    .where(
      and(
        eq(reportsTable.reporterId, reporterId),
        eq(reportsTable.reportedId, reportedUserId),
        eq(reportsTable.status, "pending"),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "You have already submitted a report for this user" });
    return;
  }

  const [report] = await db
    .insert(reportsTable)
    .values({ reporterId, reportedId: reportedUserId, reason, notes })
    .returning();

  const swipePromises = [
    db.insert(swipesTable).values({ swiperId: reporterId, swipedId: reportedUserId, direction: "left" }).onConflictDoNothing(),
    db.insert(swipesTable).values({ swiperId: reportedUserId, swipedId: reporterId, direction: "left" }).onConflictDoNothing(),
  ];

  const existingMatch = await db
    .select({ id: matchesTable.id })
    .from(matchesTable)
    .where(
      or(
        and(eq(matchesTable.user1Id, reporterId), eq(matchesTable.user2Id, reportedUserId)),
        and(eq(matchesTable.user1Id, reportedUserId), eq(matchesTable.user2Id, reporterId)),
      ),
    )
    .limit(1);

  const cleanupPromises = existingMatch.length > 0
    ? [
        db.delete(messagesTable).where(eq(messagesTable.matchId, existingMatch[0]!.id)),
        db.delete(matchesTable).where(eq(matchesTable.id, existingMatch[0]!.id)),
      ]
    : [];

  await Promise.all([...swipePromises, ...cleanupPromises]);

  res.status(201).json({ id: report!.id, message: "Report submitted" });
});

export default router;
