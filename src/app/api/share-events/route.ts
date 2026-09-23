import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const schema = z.object({ predictionId: z.string().uuid(), method: z.enum(["share", "download"]) });

/**
 * Records that the signed-in player shared or saved their own share card (called by the share
 * overlay after the share sheet succeeds or the download fallback runs). Fire-and-forget from the
 * client — a failure here must never get in the way of the share itself.
 */
export async function POST(request: NextRequest) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // Only the prediction's owner shares it from the app, so only count those.
  const prediction = await prisma.prediction.findFirst({
    where: { id: parsed.data.predictionId, userId: user.id },
    select: { id: true },
  });
  if (!prediction) return NextResponse.json({ recorded: false });

  await prisma.shareEvent.create({ data: { userId: user.id, predictionId: prediction.id, method: parsed.data.method } });
  return NextResponse.json({ recorded: true });
}
