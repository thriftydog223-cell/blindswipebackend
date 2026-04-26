import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const lastActiveTouched = new Map<string, number>();
const LAST_ACTIVE_THROTTLE_MS = 5 * 60 * 1000;

async function touchLastActive(userId: string): Promise<void> {
  const now = Date.now();
  const last = lastActiveTouched.get(userId) ?? 0;
  if (now - last < LAST_ACTIVE_THROTTLE_MS) return;
  lastActiveTouched.set(userId, now);
  try {
    await db
      .update(usersTable)
      .set({ lastActiveAt: new Date() })
      .where(eq(usersTable.id, userId));
  } catch {}
}

const JWT_SECRET =
  process.env["JWT_SECRET"] ??
  process.env["SESSION_SECRET"] ??
  "dev-secret-change-in-production";

export interface JwtPayload {
  userId: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export async function requireAuthAndNotBanned(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  let decoded: JwtPayload;
  try {
    decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const [user] = await db
    .select({ isBanned: usersTable.isBanned })
    .from(usersTable)
    .where(eq(usersTable.id, decoded.userId))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  if (user.isBanned) {
    res.status(403).json({ error: "Your account has been suspended", code: "ACCOUNT_SUSPENDED" });
    return;
  }

  req.user = decoded;
  touchLastActive(decoded.userId).catch(() => {});
  next();
}
