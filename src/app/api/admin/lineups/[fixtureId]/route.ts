import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { prisma } from "@/lib/prisma";
import { applyOfficialLineup, type LineupEntryInput } from "@/lib/services/lineup-scoring";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({
  teamId: z.string().uuid(),
  squadPlayerIds: z.array(z.string().uuid()).min(1).max(11),
});

/** Manual fallback for the automated API-Football lineup fetch — same scoring path either way. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ fixtureId: string }> }) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { fixtureId } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { teamId, squadPlayerIds } = parsed.data;

  const fixture = await prisma.fixture.findUnique({ where: { id: fixtureId } });
  if (!fixture) return NextResponse.json({ error: "Fixture not found" }, { status: 404 });
  if (teamId !== fixture.homeTeamId && teamId !== fixture.awayTeamId) {
    return NextResponse.json({ error: "Team is not part of this fixture" }, { status: 400 });
  }

  const players = await prisma.squadPlayer.findMany({
    where: { id: { in: squadPlayerIds }, teamId, isActive: true },
  });
  if (players.length !== squadPlayerIds.length) {
    return NextResponse.json({ error: "One or more players don't belong to this team" }, { status: 400 });
  }
  const playerById = new Map(players.map((p) => [p.id, p]));

  const entries: LineupEntryInput[] = squadPlayerIds.map((id) => {
    const player = playerById.get(id)!;
    return {
      squadPlayerId: player.id,
      rawApiFootballPlayerId: null,
      rawName: player.name,
      isGoalkeeper: player.position === "GOALKEEPER",
    };
  });

  const result = await applyOfficialLineup(fixtureId, teamId, entries, { source: "MANUAL" });
  return NextResponse.json(result);
}
