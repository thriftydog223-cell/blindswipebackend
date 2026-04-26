import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const REPORT_REASONS = [
  "Inappropriate photos",
  "Fake profile",
  "Harassment",
  "Underage",
  "Spam",
  "Other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export type ReportStatus = "pending" | "reviewed" | "actioned";

export const reportsTable = pgTable("reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  reporterId: uuid("reporter_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  reportedId: uuid("reported_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

export type Report = typeof reportsTable.$inferSelect;
