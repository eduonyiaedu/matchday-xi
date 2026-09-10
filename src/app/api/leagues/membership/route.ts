import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { respondToMembershipSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** League creator approves or denies a pending join request. */
export async function POST(request: NextRequest) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = respondToMembershipSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  const membership = await prisma.privateLeagueMembership.findUnique({
    where: { id: parsed.data.membershipId },
    include: { league: true },
  });
  if (!membership) return NextResponse.json({ error: "Membership request not found" }, { status: 404 });
  if (membership.league.creatorId !== user.id) {
    return NextResponse.json({ error: "Only the league creator can respond to requests" }, { status: 403 });
  }

  const updated = await prisma.privateLeagueMembership.update({
    where: { id: membership.id },
    data: { status: parsed.data.approve ? "APPROVED" : "DENIED", respondedAt: new Date() },
  });

  return NextResponse.json({ membership: updated });
}
