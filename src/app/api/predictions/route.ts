import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { leagueWindowEndExclusive } from "@/lib/league-window";
import { submitPredictionSchema } from "@/lib/validation";
import { scopeKeyFor } from "@/lib/prediction-scope";
import { getNextEligibleFixture, isPredictionWindowOpen } from "@/lib/next-fixture";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const fixtureId = request.nextUrl.searchParams.get("fixtureId");
  const privateLeagueId = request.nextUrl.searchParams.get("privateLeagueId");
  if (!fixtureId) return NextResponse.json({ error: "fixtureId is required" }, { status: 400 });

  const prediction = await prisma.prediction.findUnique({
    where: {
      userId_fixtureId_scopeKey: {
        userId: user.id,
        fixtureId,
        scopeKey: scopeKeyFor(privateLeagueId),
      },
    },
    include: { slots: true },
  });

  return NextResponse.json({ prediction });
}

export async function POST(request: NextRequest) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = submitPredictionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const { fixtureId, teamId, formation, slots } = parsed.data;
  const privateLeagueId = parsed.data.privateLeagueId ?? null;

  // Every player must be used exactly once, and slot indices must exactly cover 0-10.
  const slotIndices = new Set(slots.map((s) => s.slotIndex));
  const playerIds = new Set(slots.map((s) => s.squadPlayerId));
  if (slotIndices.size !== 11 || playerIds.size !== 11) {
    return NextResponse.json({ error: "Each of the 11 slots and players must be unique" }, { status: 400 });
  }

  const fixture = await prisma.fixture.findUnique({ where: { id: fixtureId } });
  if (!fixture) return NextResponse.json({ error: "Fixture not found" }, { status: 404 });

  // Authoritative lock check — live comparison, never trust client-sent lock state.
  if (new Date() >= fixture.lockAt) {
    return NextResponse.json({ error: "This fixture is locked — kickoff is too close." }, { status: 403 });
  }
  if (fixture.homeTeamId !== teamId && fixture.awayTeamId !== teamId) {
    return NextResponse.json({ error: "That team isn't playing in this fixture" }, { status: 400 });
  }

  // Authoritative "next match only, opens 24h before kickoff" gate — applies everywhere
  // (global and private-league predictions alike), scoped to the team being predicted for.
  const nextFixture = await getNextEligibleFixture(teamId);
  if (!nextFixture || nextFixture.id !== fixture.id) {
    return NextResponse.json(
      { error: "You can only predict for this team's next upcoming fixture." },
      { status: 403 },
    );
  }
  if (!isPredictionWindowOpen(fixture)) {
    return NextResponse.json({ error: "Predictions open 24 hours before kickoff." }, { status: 403 });
  }

  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team?.isPremierLeagueClub || !team.isActive) {
    return NextResponse.json({ error: "Predictions can only be made for a Premier League club" }, { status: 400 });
  }

  if (privateLeagueId) {
    const league = await prisma.privateLeague.findUnique({ where: { id: privateLeagueId } });
    if (!league) return NextResponse.json({ error: "Private league not found" }, { status: 404 });

    const membership = await prisma.privateLeagueMembership.findUnique({
      where: { leagueId_userId: { leagueId: privateLeagueId, userId: user.id } },
    });
    if (membership?.status !== "APPROVED") {
      return NextResponse.json({ error: "You're not an approved member of this league" }, { status: 403 });
    }
    if (membership.teamId !== teamId) {
      return NextResponse.json({ error: "This league requires your assigned team" }, { status: 400 });
    }
    if (fixture.kickoffAt < league.startDate || fixture.kickoffAt >= leagueWindowEndExclusive(league.endDate)) {
      return NextResponse.json({ error: "This fixture is outside the league's active window" }, { status: 400 });
    }
    if (league.teamRule === "SINGLE_TEAM" && league.restrictedTeamId !== teamId) {
      return NextResponse.json({ error: "This league requires a specific team" }, { status: 400 });
    }
  } else {
    // Global/per-team prediction: must be for the user's own favorite team.
    if (user.favoriteTeamId !== teamId) {
      return NextResponse.json({ error: "You can only predict for your favorite team" }, { status: 400 });
    }
  }

  const squadPlayers = await prisma.squadPlayer.findMany({
    where: { id: { in: Array.from(playerIds) } },
  });
  if (squadPlayers.length !== 11) {
    return NextResponse.json({ error: "One or more selected players don't exist" }, { status: 400 });
  }
  const squadPlayerById = new Map(squadPlayers.map((p) => [p.id, p]));

  for (const slot of slots) {
    const player = squadPlayerById.get(slot.squadPlayerId)!;
    if (player.teamId !== teamId || !player.isActive) {
      return NextResponse.json(
        { error: `${player.name} is not an active player for this team` },
        { status: 400 },
      );
    }
    const mustBeGoalkeeper = slot.slotIndex === 0;
    const isGoalkeeper = player.position === "GOALKEEPER";
    if (mustBeGoalkeeper !== isGoalkeeper) {
      return NextResponse.json(
        {
          error: mustBeGoalkeeper
            ? "Slot 0 (GK) must be a player tagged Goalkeeper"
            : `${player.name} is a Goalkeeper and can only fill the GK slot`,
        },
        { status: 400 },
      );
    }
  }

  const isFirstGlobalPrediction =
    !privateLeagueId &&
    !user.favoriteTeamLockedAt &&
    (await prisma.prediction.count({ where: { userId: user.id, privateLeagueId: null } })) === 0;

  const scopeKey = scopeKeyFor(privateLeagueId);
  // Canonical order-independent signature — matches this app's own scoring rule that slot
  // position never affects correctness, only which 11 players were picked. Lets the lock-time
  // "X% of users picked the exact lineup you did" nudge group predictions by identical XI without
  // caring which slot each player was assigned to.
  const lineupSignature = [...playerIds].sort().join(",");
  const prediction = await prisma.$transaction(async (tx) => {
    // A real `upsert` (single atomic ON CONFLICT, not a find-then-branch) — two concurrent submits
    // of a user's first-ever prediction for this fixture (a double-tap, or a client retry) both
    // read no existing row under the old find-then-create/update, so the loser's create() threw an
    // uncaught unique-constraint error instead of the same idempotent success the winner got.
    const upserted = await tx.prediction.upsert({
      where: { userId_fixtureId_scopeKey: { userId: user.id, fixtureId, scopeKey } },
      update: { teamId, formation, lineupSignature, updatedAt: new Date() },
      create: { userId: user.id, fixtureId, teamId, formation, privateLeagueId, scopeKey, lineupSignature },
    });

    await tx.predictionSlot.deleteMany({ where: { predictionId: upserted.id } });
    await tx.predictionSlot.createMany({
      data: slots.map((s) => ({ predictionId: upserted.id, slotIndex: s.slotIndex, squadPlayerId: s.squadPlayerId })),
    });

    if (isFirstGlobalPrediction) {
      await tx.user.update({ where: { id: user.id }, data: { favoriteTeamLockedAt: new Date() } });
    }

    return upserted;
  });

  return NextResponse.json({ prediction });
}
