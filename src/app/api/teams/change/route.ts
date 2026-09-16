import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { changeTeamSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rulebook §2 (v2.1): team is locked the moment the first global prediction is submitted.
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

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { favoriteTeamId: team.id },
  });

  return NextResponse.json({ user: updated });
}
