import { Router, type IRouter } from "express";
import { notInArray, sql, eq, and, or, gte, lte, isNull, isNotNull, ne } from "drizzle-orm";
import { db, usersTable, swipesTable } from "@workspace/db";
import { requireAuthAndNotBanned as requireAuth } from "../middleware/auth";

const router: IRouter = Router();

function buildOrientationFilter(seekerGender: string, seekerOrientation: string) {
  const g = seekerGender?.toLowerCase();
  const o = seekerOrientation?.toLowerCase();

  if (!o || !g || o === "prefer_not_to_say" || o === "") return null;

  if (o === "heterosexual" || o === "straight") {
    const oppositeGender = g === "man" ? "Woman" : g === "woman" ? "Man" : null;
    if (!oppositeGender) return null;
    const seekerGenderNorm = g === "man" ? "Man" : "Woman";
    return and(
      eq(usersTable.gender, oppositeGender),
      or(
        eq(usersTable.sexualOrientation, "heterosexual"),
        eq(usersTable.sexualOrientation, "bisexual"),
        eq(usersTable.sexualOrientation, "Heterosexual"),
        eq(usersTable.sexualOrientation, "Bisexual"),
      )
    );
  }

  if (o === "homosexual" || o === "gay" || o === "lesbian") {
    const sameGender = g === "man" ? "Man" : "Woman";
    return and(
      eq(usersTable.gender, sameGender),
      or(
        eq(usersTable.sexualOrientation, "homosexual"),
        eq(usersTable.sexualOrientation, "bisexual"),
        eq(usersTable.sexualOrientation, "Homosexual"),
        eq(usersTable.sexualOrientation, "Bisexual"),
      )
    );
  }

  if (o === "bisexual") {
    const seekerGenderNorm = g === "man" ? "Man" : "Woman";
    const oppositeGender = g === "man" ? "Woman" : "Man";
    return or(
      and(
        eq(usersTable.gender, oppositeGender),
        or(
          eq(usersTable.sexualOrientation, "heterosexual"),
          eq(usersTable.sexualOrientation, "bisexual"),
          eq(usersTable.sexualOrientation, "Heterosexual"),
          eq(usersTable.sexualOrientation, "Bisexual"),
        )
      ),
      and(
        eq(usersTable.gender, seekerGenderNorm),
        or(
          eq(usersTable.sexualOrientation, "homosexual"),
          eq(usersTable.sexualOrientation, "bisexual"),
          eq(usersTable.sexualOrientation, "Homosexual"),
          eq(usersTable.sexualOrientation, "Bisexual"),
        )
      )
    );
  }

  return null;
}

router.get("/discover", requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 50);

  const [seeker] = await db
    .select({
      gender: usersTable.gender,
      sexualOrientation: usersTable.sexualOrientation,
      minAgePreference: usersTable.minAgePreference,
      maxAgePreference: usersTable.maxAgePreference,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const alreadySwiped = await db
    .select({ swipedId: swipesTable.swipedId })
    .from(swipesTable)
    .where(eq(swipesTable.swiperId, userId));

  const excludeIds = [userId, ...alreadySwiped.map((s) => s.swipedId)];

  const orientationFilter = seeker
    ? buildOrientationFilter(seeker.gender, seeker.sexualOrientation)
    : null;

  const minAge = seeker?.minAgePreference ?? 18;
  const maxAge = seeker?.maxAgePreference ?? 65;

  const ageFilter = and(
    or(isNull(usersTable.age), gte(usersTable.age, minAge)),
    or(isNull(usersTable.age), lte(usersTable.age, maxAge)),
  );

  const baseExclude = notInArray(usersTable.id, excludeIds.length > 0 ? excludeIds : [userId]);
  const notBanned = eq(usersTable.isBanned, false);

  const profileComplete = and(
    isNotNull(usersTable.age),
    isNotNull(usersTable.voiceClipUrl),
    ne(usersTable.bio, ""),
    ne(usersTable.gender, ""),
    ne(usersTable.sexualOrientation, ""),
    sql`array_length(${usersTable.photos}, 1) > 0`,
  );

  const filters = [baseExclude, notBanned, ageFilter, profileComplete, ...(orientationFilter ? [orientationFilter] : [])];
  const whereClause = and(...filters);

  const users = await db
    .select()
    .from(usersTable)
    .where(whereClause)
    .orderBy(sql`RANDOM()`)
    .limit(limit);

  const seekerG = seeker?.gender?.toLowerCase() ?? "";
  const seekerO = seeker?.sexualOrientation?.toLowerCase() ?? "";

  const compatibleCards = users.filter((u) => {
    const candidateG = u.gender?.toLowerCase() ?? "";
    const candidateO = u.sexualOrientation?.toLowerCase() ?? "";

    let seekerWantsCandidate = true;
    if (seekerO === "heterosexual" || seekerO === "straight") {
      seekerWantsCandidate = candidateG !== seekerG && candidateG !== "";
    } else if (seekerO === "homosexual" || seekerO === "gay" || seekerO === "lesbian") {
      seekerWantsCandidate = candidateG === seekerG && candidateG !== "";
    }

    let candidateWantsSeeker = true;
    if (candidateO === "heterosexual" || candidateO === "straight") {
      candidateWantsSeeker = seekerG !== candidateG && seekerG !== "";
    } else if (candidateO === "homosexual" || candidateO === "gay" || candidateO === "lesbian") {
      candidateWantsSeeker = seekerG === candidateG && seekerG !== "";
    }

    return seekerWantsCandidate && candidateWantsSeeker;
  });

  function activeLabel(d: Date | null | undefined): string | null {
    if (!d) return null;
    const diff = Date.now() - d.getTime();
    if (diff < 24 * 3600000) return "Active today";
    if (diff < 7 * 24 * 3600000) return "Active this week";
    return null;
  }

  const cards = compatibleCards.map((u) => ({
    id: u.id,
    name: u.name || "Anonymous",
    age: u.age ?? null,
    city: u.city || "",
    intent: u.intent || "",
    bio: u.bio || "",
    hasPhoto: u.photos.length > 0,
    hasVoice: !!u.voiceClipUrl,
    voiceClipUrl: u.voiceClipUrl ?? null,
    prompts: [] as { question: string; answer: string }[],
    activeLabel: activeLabel(u.lastActiveAt),
  }));

  res.json(cards);
});

export default router;
