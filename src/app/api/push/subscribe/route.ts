import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

/**
 * Browser push services only — the server sends a request to whatever endpoint is stored here, so
 * an arbitrary URL would let any signed-in user point it at a slow or hostile host (clogging the
 * push queue for everyone) or at an internal address.
 */
const PUSH_SERVICE_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge (Chromium), Android
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /(^|\.)push\.apple\.com$/, // Safari / iOS
  /(^|\.)notify\.windows\.com$/, // legacy Edge
];

/** Devices kept per account — a phone and a laptop or two; the oldest drop off beyond this. */
const MAX_DEVICES_PER_USER = 5;

const schema = z.object({
  endpoint: z
    .string()
    .max(1000)
    .url()
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" && PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname));
      } catch {
        return false;
      }
    }),
  // Real keys are 87 (p256dh) and 22 (auth) base64url characters.
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export async function POST(request: NextRequest) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { endpoint, keys } = parsed.data;

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth },
    create: { userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
  });

  // Keep only the newest few devices per account.
  const surplus = await prisma.pushSubscription.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    skip: MAX_DEVICES_PER_USER,
    select: { id: true },
  });
  if (surplus.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: surplus.map((s) => s.id) } } });
  }

  return NextResponse.json({ ok: true });
}
