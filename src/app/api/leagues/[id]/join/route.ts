import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { joinLeagueSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: leagueId } = await params;
  const league = await prisma.privateLeague.findUnique({ where: { id: leagueId } });
  if (!league) return NextResponse.json({ error: "Private league not found" }, { status: 404 });

  const parsed = joinLeagueSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  // SINGLE_TEAM leagues have an implied team — any client-sent teamId is ignored. Otherwise a
  // team choice is required.
  let teamId: string;
  if (league.teamRule === "SINGLE_TEAM") {
    if (!league.restrictedTeamId) {
      return NextResponse.json({ error: "This league is misconfigured (no required team set)" }, { status: 500 });
    }
    teamId = league.restrictedTeamId;
  } else {
    if (!parsed.data.teamId) {
      return NextResponse.json({ error: "teamId is required to join this league" }, { status: 400 });
    }
    const team = await prisma.team.findUnique({ where: { id: parsed.data.teamId } });
    if (!team?.isPremierLeagueClub || !team.isActive) {
      return NextResponse.json({ error: "teamId must be an active Premier League club" }, { status: 400 });
    }
    teamId = team.id;
  }

  // Permanent once approved — but free to change on any attempt before that (still PENDING, or
  // after a DENIED response), per founder direction. The check and the write are lock-guarded
  // together: without it, a join request racing the league creator's concurrent approval
  // (/api/leagues/membership) could read "not yet approved" and then blindly upsert PENDING over
  // a membership that became APPROVED in between, reverting the approval and reassigning the
  // "permanent" team — re-checking status fresh after acquiring the lock closes that gap.
  const membership = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"league-join:" + leagueId + ":" + user.id}))`;
    const fresh = await tx.privateLeagueMembership.findUnique({
      where: { leagueId_userId: { leagueId, userId: user.id } },
    });
    if (fresh?.status === "APPROVED") return null;

    return tx.privateLeagueMembership.upsert({
      where: { leagueId_userId: { leagueId, userId: user.id } },
      update: { teamId, status: "PENDING", respondedAt: null },
      create: { leagueId, userId: user.id, teamId, status: "PENDING" },
    });
  });

  if (!membership) {
    return NextResponse.json({ error: "You're already an approved member — your team is locked in" }, { status: 409 });
  }

  return NextResponse.json({ membership });
}
