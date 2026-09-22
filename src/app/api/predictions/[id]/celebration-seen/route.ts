import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** Marks a Perfect XI's celebration as shown, so (app)/layout.tsx's auto-trigger doesn't show it again. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const prediction = await prisma.prediction.findUnique({ where: { id }, select: { userId: true } });
  if (!prediction) return NextResponse.json({ error: "Prediction not found" }, { status: 404 });
  if (prediction.userId !== user.id) {
    return NextResponse.json({ error: "This prediction isn't yours" }, { status: 403 });
  }

  await prisma.prediction.update({ where: { id }, data: { perfectXiCelebrationShownAt: new Date() } });
  return NextResponse.json({ ok: true });
}
