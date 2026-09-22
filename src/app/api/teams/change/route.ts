import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { changeTeamSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rulebook §2 (v2.1): team is locked the moment the first global prediction is submitted. This
  // first check is just a fast-path UX rejection — `user` here can be a stale snapshot if a
  // predictions/route.ts submission is mid-flight and about to set favoriteTeamLockedAt, so it
  // doesn't guard the actual write below.
  if (user.favoriteTeamLockedAt) {
    return NextResponse.json(
      { error: "Your team is locked in after your first prediction and can't be changed." },
      { status: 403 },
    );
  }

  const parsed = changeTeamSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  const team = await prisma.team.findUnique({ where: { id: parsed.data.teamId } });
  if (!team?.isPremierLeagueClub || !team.isActive) {
    return NextResponse.json({ error: "Pick one of the 20 Premier League clubs" }, { status: 400 });
  }

  // Authoritative guard: a single atomic UPDATE ... WHERE favoriteTeamLockedAt IS NULL, so a
  // first-prediction submission that locks the team concurrently (between the snapshot check
  // above and here) can't be raced — whichever commits first wins, and the loser's update
  // affects zero rows instead of silently overwriting a just-locked team.
  const { count } = await prisma.user.updateMany({
    where: { id: user.id, favoriteTeamLockedAt: null },
    data: { favoriteTeamId: team.id },
  });
  if (count === 0) {
    return NextResponse.json(
      { error: "Your team is locked in after your first prediction and can't be changed." },
      { status: 403 },
    );
  }

  const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  return NextResponse.json({ user: updated });
}
