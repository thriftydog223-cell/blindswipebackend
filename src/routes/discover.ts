import { Router, type IRouter } from "express";
import { notInArray, sql, eq, and, or, gte, lte, isNull, isNotNull, ne } from "drizzle-orm";
import { db, usersTable, swipesTable } from "@workspace/db";
import { requireAuthAndNotBanned as requireAuth } from "../middleware/auth";

const router: IRouter = Router();

/**
 * Builds a SQL condition that enforces BIDIRECTIONAL orientation compatibility.
 *
 * Both conditions must be true for a candidate to appear:
 *   1. The SEEKER wants the CANDIDATE  (based on seeker's orientation vs candidate's gender)
 *   2. The CANDIDATE wants the SEEKER  (based on candidate's orientation vs seeker's gender)
 *
 * Orientation values stored: "heterosexual", "homosexual", "bisexual"
 * Gender values stored:       "Man", "Woman", "Non-binary", "Other", "Prefer not to say"
 *
 * We use LOWER() everywhere so comparisons are case-insensitive.
 */
function buildCompatibilityFilter(
  seekerGender: string | null | undefined,
  seekerOrientation: string | null | undefined,
) {
  const g = (seekerGender ?? "").toLowerCase().trim();   // seeker's gender (lowercased)
  const o = (seekerOrientation ?? "").toLowerCase().trim(); // seeker's orientation (lowercased)

  // If we don't know the seeker's orientation, skip the filter (admin/incomplete profiles).
  if (!g || !o || o === "prefer_not_to_say") return null;

  // ------------------------------------------------------------------
  // Part 1 — seeker wants the candidate
  // ------------------------------------------------------------------
  let seekerWantsCandidate: ReturnType<typeof sql>;

  if (o === "heterosexual" || o === "straight") {
    // Seeker wants the opposite gender.
    seekerWantsCandidate = sql`LOWER(${usersTable.gender}) != ${g} AND LOWER(${usersTable.gender}) != '' AND ${usersTable.gender} IS NOT NULL`;
  } else if (o === "homosexual" || o === "gay" || o === "lesbian") {
    // Seeker wants the same gender.
    seekerWantsCandidate = sql`LOWER(${usersTable.gender}) = ${g} AND ${g} != ''`;
  } else {
    // Bisexual — seeker wants any gender.
    seekerWantsCandidate = sql`true`;
  }

  // ------------------------------------------------------------------
  // Part 2 — candidate wants the seeker (checked against their stored orientation)
  //
  // "heterosexual/straight" → candidate wants someone of OPPOSITE gender to themselves
  //   ↳ seeker's gender must differ from candidate's gender
  //
  // "homosexual/gay/lesbian" → candidate wants someone of the SAME gender as themselves
  //   ↳ seeker's gender must equal candidate's gender
  //
  // "bisexual" → candidate wants any gender → always OK
  // ------------------------------------------------------------------
  const candidateWantsSeeker = sql`
    CASE
      WHEN LOWER(${usersTable.sexualOrientation}) IN ('heterosexual', 'straight')
        THEN ${g} != LOWER(${usersTable.gender}) AND ${g} != '' AND ${usersTable.gender} IS NOT NULL
      WHEN LOWER(${usersTable.sexualOrientation}) IN ('homosexual', 'gay', 'lesbian')
        THEN ${g} = LOWER(${usersTable.gender}) AND ${g} != '' AND ${usersTable.gender} IS NOT NULL
      ELSE
        true
    END
  `;

  return sql`(${seekerWantsCandidate}) AND (${candidateWantsSeeker})`;
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

  const compatibilityFilter = seeker
    ? buildCompatibilityFilter(seeker.gender, seeker.sexualOrientation)
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
    isNotNull(usersTable.gender),
    isNotNull(usersTable.sexualOrientation),
    ne(usersTable.bio, ""),
    ne(usersTable.gender, ""),
    ne(usersTable.sexualOrientation, ""),
    sql`array_length(${usersTable.photos}, 1) > 0`,
  );

  const filters = [
    baseExclude,
    notBanned,
    ageFilter,
    profileComplete,
    ...(compatibilityFilter ? [compatibilityFilter] : []),
  ];

  const users = await db
    .select()
    .from(usersTable)
    .where(and(...filters))
    .orderBy(sql`RANDOM()`)
    .limit(limit);

  function activeLabel(d: Date | null | undefined): string | null {
    if (!d) return null;
    const diff = Date.now() - d.getTime();
    if (diff < 24 * 3600000) return "Active today";
    if (diff < 7 * 24 * 3600000) return "Active this week";
    return null;
  }

  const cards = users.map((u) => ({
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
