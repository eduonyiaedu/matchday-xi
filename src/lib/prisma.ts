import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient() {
  // Supabase's Session pooler caps this project at 15 total connections — but `pg.Pool` defaults
  // to `max: 10` *per instance*, and Vercel can run several serverless instances concurrently
  // (each cold-starting its own pool), on top of local dev also holding its own. Two concurrent
  // instances alone would already exceed 15 with the default; this is what caused the
  // "EMAXCONNSESSION max clients reached" errors seen both in production (killed a CHECK_LINEUPS
  // run on 2026-09-12) and locally. A small per-instance cap leaves headroom for several
  // concurrent instances plus local dev to all fit under the shared budget.
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 2 });
  return new PrismaClient({ adapter });
}

// Reuse a single client across hot reloads in dev; serverless functions get one per cold start.
export const prisma = global.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
