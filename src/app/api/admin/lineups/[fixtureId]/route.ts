import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { prisma } from "@/lib/prisma";
import { applyOfficialLineup, FixtureVoidedError, type LineupEntryInput } from "@/lib/services/lineup-scoring";
import { SeasonFrozenError } from "@/lib/seasons";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z
  .object({
    teamId: z.string().uuid(),
    squadPlayerIds: z.array(z.string().uuid()).max(11),
    // A real starter who isn't in our squad data at all (an academy call-up or new signing the
    // squad sync hasn't picked up yet — more likely while API-Football's U21 enrichment is down).
    // Recorded by name only, exactly like the automated path records an unmatched API-Football
    // name, so nobody can be scored as "correct" for them — which is the honest outcome, since
    // nobody could have picked them either.
    unlistedPlayers: z
      .array(z.object({ name: z.string().trim().min(1).max(80), isGoalkeeper: z.boolean() }))
      .max(11)
      .default([]),
  })
  .refine((d) => d.squadPlayerIds.length + d.unlistedPlayers.length === 11, {
    message: "A lineup must have exactly 11 players.",
  })
  .refine((d) => new Set(d.squadPlayerIds).size === d.squadPlayerIds.length, {
    message: "The same player was picked twice.",
  });

// Statuses where a real confirmed lineup can exist. SCORED stays allowed so the founder can
// correct a mistake; applyOfficialLineup only applies the net points change on a re-save.
const LINEUP_ENTRY_STATUSES = new Set(["LOCKED", "LINEUPS_FETCHED", "NEEDS_MANUAL_REVIEW", "SCORED"]);

/** Manual fallback for the automated API-Football lineup fetch — same scoring path either way. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ fixtureId: string }> }) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { fixtureId } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { teamId, squadPlayerIds, unlistedPlayers } = parsed.data;

  const fixture = await prisma.fixture.findUnique({ where: { id: fixtureId } });
  if (!fixture) return NextResponse.json({ error: "Fixture not found" }, { status: 404 });
  if (teamId !== fixture.homeTeamId && teamId !== fixture.awayTeamId) {
    return NextResponse.json({ error: "Team is not part of this fixture" }, { status: 400 });
  }
  // A voided (postponed/abandoned) fixture must never be scored, and a fixture that hasn't
  // locked yet is still open for predictions — scoring it now would leave any prediction
  // submitted after this save permanently unscored.
  if (!LINEUP_ENTRY_STATUSES.has(fixture.status) || new Date() < fixture.lockAt) {
    return NextResponse.json(
      { error: `A lineup can't be entered for this fixture right now (status: ${fixture.status}).` },
      { status: 409 },
    );
  }

  // Deliberately not filtered to isActive — the founder is the authority on who actually
  // started, and a real starter can have been deactivated by a squad sync after the fact.
  const players = await prisma.squadPlayer.findMany({
    where: { id: { in: squadPlayerIds }, teamId },
  });
  if (players.length !== squadPlayerIds.length) {
    return NextResponse.json({ error: "One or more players don't belong to this team" }, { status: 400 });
  }
  const playerById = new Map(players.map((p) => [p.id, p]));

  const entries: LineupEntryInput[] = [
    ...squadPlayerIds.map((id) => {
      const player = playerById.get(id)!;
      return {
        squadPlayerId: player.id,
        rawApiFootballPlayerId: null,
        rawName: player.name,
        isGoalkeeper: player.position === "GOALKEEPER",
      };
    }),
    ...unlistedPlayers.map((p) => ({
      squadPlayerId: null,
      rawApiFootballPlayerId: null,
      rawName: p.name,
      isGoalkeeper: p.isGoalkeeper,
    })),
  ];

  try {
    const result = await applyOfficialLineup(fixtureId, teamId, entries, { source: "MANUAL" });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof FixtureVoidedError) {
      return NextResponse.json({ error: "This fixture was just voided — its lineup can't be entered." }, { status: 409 });
    }
    if (error instanceof SeasonFrozenError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
