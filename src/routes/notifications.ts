import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, usersTable } from "@workspace/db";
import { requireAuthAndNotBanned as requireAuth } from "../middleware/auth";

const router: IRouter = Router();

const tokenSchema = z.object({
  token: z.string().min(1),
});

router.post("/notifications/token", requireAuth, async (req, res) => {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid token" });
    return;
  }

  await db
    .update(usersTable)
    .set({ pushToken: parsed.data.token })
    .where(eq(usersTable.id, req.user!.userId));

  res.json({ ok: true });
});

router.delete("/notifications/token", requireAuth, async (req, res) => {
  await db
    .update(usersTable)
    .set({ pushToken: null })
    .where(eq(usersTable.id, req.user!.userId));

  res.json({ ok: true });
});

export default router;
