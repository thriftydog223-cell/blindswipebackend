import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const matchesTable = pgTable("matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  user1Id: uuid("user1_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  user2Id: uuid("user2_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  messageCount: integer("message_count").notNull().default(0),
  user1MessageCount: integer("user1_message_count").notNull().default(0),
  user2MessageCount: integer("user2_message_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  status: text("status").notNull().default("matched"),
  messageRequestAccepted: boolean("message_request_accepted").notNull().default(true),
  unmatchedBy: uuid("unmatched_by"),
  unmatchedAt: timestamp("unmatched_at", { withTimezone: true }),
  lastNudgeSentAt: timestamp("last_nudge_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Match = typeof matchesTable.$inferSelect;
export type NewMatch = typeof matchesTable.$inferInsert;
