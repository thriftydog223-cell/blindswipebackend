import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";

const router: IRouter = Router();

const submitIdSchema = z.object({
  idPhotoUrl: z.string().url("Invalid photo URL"),
});

router.post("/verification/id", requireAuth, async (req, res) => {
  const parsed = submitIdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }

  const userId = req.user!.userId;

  const [user] = await db
    .select({ idVerificationStatus: usersTable.idVerificationStatus })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.idVerificationStatus === "verified") {
    res.status(409).json({ error: "Your ID is already verified" });
    return;
  }

  await db
    .update(usersTable)
    .set({
      idPhotoUrl: parsed.data.idPhotoUrl,
      idVerificationStatus: "pending",
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId));

  res.json({ message: "ID photo submitted for review. You will be notified once verified." });
});

router.get("/verification/status", requireAuth, async (req, res) => {
  const userId = req.user!.userId;

  const [user] = await db
    .select({
      idVerificationStatus: usersTable.idVerificationStatus,
      dateOfBirth: usersTable.dateOfBirth,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    idVerificationStatus: user.idVerificationStatus,
    isAgeVerified: !!user.dateOfBirth,
  });
});

router.post("/verification/safety-tips-seen", requireAuth, async (req, res) => {
  const userId = req.user!.userId;

  await db
    .update(usersTable)
    .set({ safetyTipsShown: true, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));

  res.json({ message: "Safety tips marked as seen" });
});

export default router;
