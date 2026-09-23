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
    // Clearing a flag is remembered, so automatic checks (lib/account-trust.ts) never re-flag
    // someone the founder has already judged genuine.
    data: parsed.data.flagged
      ? { isFlaggedDuplicate: true, flagReason: "Flagged by admin", flagClearedAt: null }
      : { isFlaggedDuplicate: false, flagReason: null, flagClearedAt: new Date() },
  });
  if (count === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ userId: parsed.data.userId, flagged: parsed.data.flagged });
}
