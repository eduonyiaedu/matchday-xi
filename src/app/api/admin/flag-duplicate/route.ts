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

  const user = await prisma.user.update({
    where: { id: parsed.data.userId },
    data: { isFlaggedDuplicate: parsed.data.flagged },
  });
  return NextResponse.json({ user });
}
