import { pgTable, text, integer, timestamp, uuid, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull().default(""),
  age: integer("age"),
  bio: text("bio").notNull().default(""),
  city: text("city").notNull().default(""),
  gender: text("gender").notNull().default(""),
  sexualOrientation: text("sexual_orientation").notNull().default(""),
  intent: text("intent").notNull().default(""),
  photos: text("photos").array().notNull().default([]),
  pushToken: text("push_token"),
  isBanned: boolean("is_banned").notNull().default(false),
  isAdmin: boolean("is_admin").notNull().default(false),
  height: integer("height"),
  relationshipGoal: text("relationship_goal").notNull().default(""),
  drinking: text("drinking").notNull().default(""),
  smoking: text("smoking").notNull().default(""),
  voiceClipUrl: text("voice_clip_url"),
  minAgePreference: integer("min_age_preference").notNull().default(18),
  maxAgePreference: integer("max_age_preference").notNull().default(65),
  dateOfBirth: timestamp("date_of_birth", { withTimezone: true }),
  idVerificationStatus: text("id_verification_status").notNull().default("unverified"),
  idPhotoUrl: text("id_photo_url"),
  safetyTipsShown: boolean("safety_tips_shown").notNull().default(false),
  isEmailVerified: boolean("is_email_verified").notNull().default(false),
  emailVerificationCode: text("email_verification_code"),
  emailVerificationExpiry: timestamp("email_verification_expiry", { withTimezone: true }),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const selectUserSchema = createSelectSchema(usersTable);

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type PublicUser = Omit<User, "passwordHash">;
