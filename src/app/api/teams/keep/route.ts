import { NextResponse } from "next/server";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentSeason } from "@/lib/seasons";

export const runtime = "nodejs";

/**
 * "Keep my club" answer to the new-season prompt on Home (lib/new-season.ts). Only records that
 * the question was answered — the club itself still locks with the season's first prediction.
 */
export async function POST() {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const season = await getCurrentSeason();
  if (!season) return NextResponse.json({ error: "No season yet" }, { status: 409 });

  await prisma.user.update({ where: { id: user.id }, data: { seasonClubConfirmedFor: season.label } });
  return NextResponse.json({ ok: true });
}
