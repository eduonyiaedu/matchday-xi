import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({ username: z.string().regex(/^[a-z0-9_]{3,20}$/) });

/** Public, pre-signup check — no auth required (there's no session to check against yet). */
export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ available: false, error: "Invalid username format" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { username: parsed.data.username } });
  return NextResponse.json({ available: !existing });
}
