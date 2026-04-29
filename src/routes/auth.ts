import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { eq, and, gt, or } from "drizzle-orm";
import { z } from "zod";
import { db, usersTable, passwordResetTokensTable, swipesTable, matchesTable, messagesTable, reportsTable, type PublicUser } from "@workspace/db";
import { requireAuth, requireAuthAndNotBanned, signToken } from "../middleware/auth";
import { sendPasswordResetEmail, sendEmailVerificationEmail } from "../lib/email";

const router: IRouter = Router();

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date of birth format (YYYY-MM-DD)"),
});

function computeAgeFromDob(dob: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  age: z.number().int().min(18).max(120).optional(),
  bio: z.string().optional(),
  city: z.string().optional(),
  gender: z.string().optional(),
  sexualOrientation: z.string().optional(),
  intent: z.string().optional(),
  photos: z.array(z.string()).optional(),
  height: z.number().int().min(100).max(250).optional().nullable(),
  relationshipGoal: z.string().optional(),
  drinking: z.string().optional(),
  smoking: z.string().optional(),
  minAgePreference: z.number().int().min(18).max(120).optional(),
  maxAgePreference: z.number().int().min(18).max(120).optional(),
  voiceClipUrl: z.string().url().optional().nullable(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const resetPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
  code: z.string().length(6, "Invalid reset code"),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

function toPublicUser(user: typeof usersTable.$inferSelect): PublicUser {
  const { passwordHash: _, ...rest } = user;
  return rest;
}

router.post("/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }

  const { email, password, dateOfBirth } = parsed.data;

  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) {
    res.status(400).json({ error: "Invalid date of birth" });
    return;
  }
  const userAge = computeAgeFromDob(dob);
  if (userAge < 18) {
    res.status(403).json({ error: "You must be 18 or older to use Wyndr" });
    return;
  }
  if (userAge > 120) {
    res.status(400).json({ error: "Invalid date of birth" });
    return;
  }

  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
  const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const [user] = await db
    .insert(usersTable)
    .values({
      email: email.toLowerCase(),
      passwordHash,
      dateOfBirth: dob,
      age: userAge,
      emailVerificationCode: verificationCode,
      emailVerificationExpiry: verificationExpiry,
      isEmailVerified: false,
    })
    .returning();

  if (!user) {
    res.status(500).json({ error: "Failed to create account" });
    return;
  }

  console.log("[DEBUG] About to call sendEmailVerificationEmail for:", email.toLowerCase());
  try {
    await sendEmailVerificationEmail(email.toLowerCase(), verificationCode);
  } catch (error) {
    console.error("[ERROR] sendEmailVerificationEmail failed:", error);
    throw error;
  }
  console.log("[DEBUG] sendEmailVerificationEmail call completed");

  const token = signToken({ userId: user.id, email: user.email });
  res.status(201).json({ token, user: toPublicUser(user) });
});

router.post("/auth/verify-email", requireAuth, async (req, res) => {
  const { code } = req.body as { code?: string };
  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "Verification code is required" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.isEmailVerified) {
    res.json({ message: "Email already verified" });
    return;
  }

  if (!user.emailVerificationCode || !user.emailVerificationExpiry) {
    res.status(400).json({ error: "No verification code found. Please request a new one." });
    return;
  }

  if (user.emailVerificationExpiry < new Date()) {
    res.status(400).json({ error: "Verification code has expired. Please request a new one." });
    return;
  }

  if (user.emailVerificationCode !== code.trim()) {
    res.status(400).json({ error: "Invalid verification code" });
    return;
  }

  await db
    .update(usersTable)
    .set({ isEmailVerified: true, emailVerificationCode: null, emailVerificationExpiry: null })
    .where(eq(usersTable.id, user.id));

  res.json({ message: "Email verified successfully" });
});

router.post("/auth/resend-verification", requireAuth, async (req, res) => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.isEmailVerified) {
    res.json({ message: "Email already verified" });
    return;
  }

  const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
  const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db
    .update(usersTable)
    .set({ emailVerificationCode: verificationCode, emailVerificationExpiry: verificationExpiry })
    .where(eq(usersTable.id, user.id));

  sendEmailVerificationEmail(user.email, verificationCode).catch(() => {});

  res.json({ message: "Verification email sent" });
});

router.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email or password format" });
    return;
  }

  const { email, password } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (user.isBanned) {
    res.status(403).json({ error: "Your account has been suspended", code: "ACCOUNT_SUSPENDED" });
    return;
  }

  const token = signToken({ userId: user.id, email: user.email });
  res.json({ token, user: toPublicUser(user) });
});

router.get("/auth/me", requireAuthAndNotBanned, async (req, res) => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.userId))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  res.json(toPublicUser(user));
});

router.put("/auth/profile", requireAuthAndNotBanned, async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }

  const updates = parsed.data;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(usersTable.id, req.user!.userId))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(toPublicUser(user));
});

router.delete("/auth/account", requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  await db.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, userId));
  await db.delete(reportsTable).where(or(eq(reportsTable.reporterId, userId), eq(reportsTable.reportedId, userId)));
  await db.delete(swipesTable).where(or(eq(swipesTable.swiperId, userId), eq(swipesTable.swipedId, userId)));
  const userMatches = await db
    .select({ id: matchesTable.id })
    .from(matchesTable)
    .where(or(eq(matchesTable.user1Id, userId), eq(matchesTable.user2Id, userId)));
  if (userMatches.length > 0) {
    const matchIds = userMatches.map((m) => m.id);
    const { inArray } = await import("drizzle-orm");
    await db.delete(messagesTable).where(inArray(messagesTable.matchId, matchIds));
    await db.delete(matchesTable).where(inArray(matchesTable.id, matchIds));
  }
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  res.json({ message: "Account permanently deleted" });
});

router.post("/auth/forgot-password", async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }

  const { email } = parsed.data;

  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  if (!user) {
    res.json({ message: "If that email is registered, a reset code has been sent." });
    return;
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const tokenHash = crypto.createHash("sha256").update(code).digest("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await db.insert(passwordResetTokensTable).values({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  console.log("[DEBUG] About to call sendPasswordResetEmail for:", user.email);
  try {
    await sendPasswordResetEmail(user.email, code);
  } catch (error) {
    console.error("[ERROR] sendPasswordResetEmail failed:", error);
    throw error;
  }
  console.log("[DEBUG] sendPasswordResetEmail call completed");

  res.json({ message: "If that email is registered, a reset code has been sent." });
});

router.post("/auth/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }

  const { email, code, newPassword } = parsed.data;

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  if (!user) {
    res.status(400).json({ error: "Invalid or expired reset code" });
    return;
  }

  const tokenHash = crypto.createHash("sha256").update(code).digest("hex");
  const now = new Date();

  const [token] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.userId, user.id),
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        eq(passwordResetTokensTable.used, false),
        gt(passwordResetTokensTable.expiresAt, now),
      ),
    )
    .limit(1);

  if (!token) {
    res.status(400).json({ error: "Invalid or expired reset code" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await Promise.all([
    db
      .update(usersTable)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id)),
    db
      .update(passwordResetTokensTable)
      .set({ used: true })
      .where(eq(passwordResetTokensTable.id, token.id)),
  ]);

  res.json({ message: "Password updated successfully" });
});

export default router;
