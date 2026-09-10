import { prisma } from "@/lib/prisma";

/**
 * Flips SCHEDULED fixtures to LOCKED once their lockAt time has passed, for UI/query convenience.
 * NOT the authoritative lock check — that's always a live `now() >= fixture.lockAt` comparison
 * at prediction write-time (see app/api/predictions/route.ts). This sweep just keeps `status`
 * accurate for anyone browsing fixtures.
 */
export async function lockSweep() {
  const result = await prisma.fixture.updateMany({
    where: { status: "SCHEDULED", lockAt: { lte: new Date() } },
    data: { status: "LOCKED" },
  });
  return { locked: result.count };
}
