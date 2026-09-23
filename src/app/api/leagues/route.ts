import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createPrivateLeagueSchema } from "@/lib/validation";

export const runtime = "nodejs";

class OneLeaguePerCreatorError extends Error {}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") +
    "-" +
    Math.random().toString(36).slice(2, 7)
  );
}

/** Public: search private leagues by name (rulebook §12b — discoverable, join still needs approval). */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const leagues = await prisma.privateLeague.findMany({
    where: q ? { name: { contains: q, mode: "insensitive" } } : {},
    include: { creator: { select: { displayName: true } }, _count: { select: { memberships: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ leagues });
}

export async function POST(request: NextRequest) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // TODO: gate behind a subscription tier once paid tiers exist (rulebook §12b ties creation to
  // "subscribed users"; there is no subscription tier at all in this free-tier-only MVP, so
  // creation is open to any logged-in user for now, per founder decision).

  const parsed = createPrivateLeagueSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;

  if (data.teamRule === "SINGLE_TEAM" && !data.restrictedTeamId) {
    return NextResponse.json({ error: "restrictedTeamId is required for the SINGLE_TEAM rule" }, { status: 400 });
  }
  // The end date is inclusive (see lib/league-window.ts), so a one-day league (end == start) is valid.
  if (data.endDate < data.startDate) {
    return NextResponse.json({ error: "endDate can't be before startDate" }, { status: 400 });
  }

  const team = await prisma.team.findUnique({ where: { id: data.teamId } });
  if (!team?.isPremierLeagueClub || !team.isActive) {
    return NextResponse.json({ error: "teamId must be an active Premier League club" }, { status: 400 });
  }
  if (data.teamRule === "SINGLE_TEAM" && data.teamId !== data.restrictedTeamId) {
    return NextResponse.json({ error: "Your own team must match the league's required team" }, { status: 400 });
  }

  // The creator's team choice becomes their own membership row, approved immediately — this is
  // what makes the creator able to build a lineup right away, instead of relying on a page-level
  // bypass with nothing backing it at the API layer (the exact bug this fixes).
  //
  // The "one league per creator" check and the create used to be two separate round-trips, which
  // let two concurrent POSTs (a double-click, or a client retry) both read zero existing leagues
  // and both create one. An advisory lock keyed on the creator's id makes the check-then-create
  // exclusive per user: the second call blocks until the first transaction commits, then correctly
  // sees the just-created league and is rejected.
  try {
    const league = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"private-league-create:" + user.id}))`;

      const existingOwned = await tx.privateLeague.count({ where: { creatorId: user.id } });
      if (existingOwned > 0) {
        throw new OneLeaguePerCreatorError();
      }

      const created = await tx.privateLeague.create({
        data: {
          creatorId: user.id,
          name: data.name,
          slug: slugify(data.name),
          teamRule: data.teamRule,
          restrictedTeamId: data.teamRule === "SINGLE_TEAM" ? data.restrictedTeamId : undefined,
          startDate: data.startDate,
          endDate: data.endDate,
          // isPaid/entryFee intentionally omitted — always default to free (false/null) in this build.
        },
      });
      await tx.privateLeagueMembership.create({
        data: {
          leagueId: created.id,
          userId: user.id,
          teamId: data.teamId,
          status: "APPROVED",
          respondedAt: new Date(),
        },
      });
      return created;
    });

    return NextResponse.json({ league }, { status: 201 });
  } catch (error) {
    if (error instanceof OneLeaguePerCreatorError) {
      return NextResponse.json({ error: "You can only create one private league" }, { status: 403 });
    }
    throw error;
  }
}
