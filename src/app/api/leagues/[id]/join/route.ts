import { NextResponse } from "next/server";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: leagueId } = await params;
  const league = await prisma.privateLeague.findUnique({ where: { id: leagueId } });
  if (!league) return NextResponse.json({ error: "Private league not found" }, { status: 404 });

  const membership = await prisma.privateLeagueMembership.upsert({
    where: { leagueId_userId: { leagueId, userId: user.id } },
    update: {},
    create: { leagueId, userId: user.id, status: "PENDING" },
  });

  return NextResponse.json({ membership });
}
