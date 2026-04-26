import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, matchesTable, messagesTable, usersTable } from "@workspace/db";
import { sendPushNotifications } from "./notifications";

const NUDGE_THRESHOLD_MS = 48 * 60 * 60 * 1000;
const NUDGE_COOLDOWN_MS = 48 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

async function runNudgeJob(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - NUDGE_THRESHOLD_MS);
    const nudgeCooloff = new Date(Date.now() - NUDGE_COOLDOWN_MS);

    const staleMatches = await db
      .select()
      .from(matchesTable)
      .where(
        and(
          or(eq(matchesTable.status, "matched"), eq(matchesTable.status, "revealed")),
          isNull(matchesTable.unmatchedAt),
          sql`${matchesTable.updatedAt} < ${cutoff}`,
          or(
            isNull(matchesTable.lastNudgeSentAt),
            sql`${matchesTable.lastNudgeSentAt} < ${nudgeCooloff}`
          )
        )
      )
      .limit(50);

    if (staleMatches.length === 0) return;

    const now = new Date();
    const notifications: { to: string; title: string; body: string }[] = [];

    for (const match of staleMatches) {
      const [user1, user2] = await Promise.all([
        db.select({ pushToken: usersTable.pushToken, name: usersTable.name })
          .from(usersTable).where(eq(usersTable.id, match.user1Id)).limit(1).then((r) => r[0]),
        db.select({ pushToken: usersTable.pushToken, name: usersTable.name })
          .from(usersTable).where(eq(usersTable.id, match.user2Id)).limit(1).then((r) => r[0]),
      ]);

      await db.update(matchesTable)
        .set({ lastNudgeSentAt: now })
        .where(eq(matchesTable.id, match.id));

      if (user1?.pushToken) {
        notifications.push({
          to: user1.pushToken,
          title: "Don't let this connection fade!",
          body: `You matched with ${user2?.name ?? "someone"} — keep the conversation going.`,
        });
      }
      if (user2?.pushToken) {
        notifications.push({
          to: user2.pushToken,
          title: "Don't let this connection fade!",
          body: `You matched with ${user1?.name ?? "someone"} — keep the conversation going.`,
        });
      }
    }

    if (notifications.length > 0) {
      await sendPushNotifications(notifications);
    }
  } catch (err) {
    console.error("[nudgeJob] Error:", err);
  }
}

export function startNudgeJob(): void {
  setTimeout(() => {
    runNudgeJob();
    setInterval(runNudgeJob, CHECK_INTERVAL_MS);
  }, 30_000);
}
