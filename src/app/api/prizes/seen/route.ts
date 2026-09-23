import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const schema = z.object({ kind: z.enum(["monthly", "season"]), id: z.string().uuid() });

/** Dismisses a "You won!" banner on Home. Only the winner themself can dismiss their own. */
export async function POST(request: NextRequest) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { kind, id } = parsed.data;

  const { count } =
    kind === "monthly"
      ? await prisma.monthlyPrizeDraw.updateMany({
          where: { id, winnerUserId: user.id, winnerSeenAt: null },
          data: { winnerSeenAt: new Date() },
        })
      : await prisma.seasonPrize.updateMany({
          where: { id, userId: user.id, seenAt: null },
          data: { seenAt: new Date() },
        });
  return NextResponse.json({ dismissed: count > 0 });
}
