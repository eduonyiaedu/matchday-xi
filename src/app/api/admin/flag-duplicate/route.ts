import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({ userId: z.string().uuid(), flagged: z.boolean() });

/** Manual fair-play flag — disqualifies from prize eligibility without touching accrued points (rulebook §10). */
export async function POST(request: NextRequest) {
  const { response } = await requireAdmin();
  if (response) return response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { count } = await prisma.user.updateMany({
    where: { id: parsed.data.userId },
    data: { isFlaggedDuplicate: parsed.data.flagged, flagReason: parsed.data.flagged ? "Flagged by admin" : null },
  });
  if (count === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ userId: parsed.data.userId, flagged: parsed.data.flagged });
}
