import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient() {
  // DATABASE_URL (session pooler, port 5432) stays reserved for the Prisma CLI (`db push`) —
  // migrations and Prisma's internal advisory locks aren't reliable over a transaction-mode
  // pooler, so that path is deliberately left untouched.
  //
  // App runtime queries use DATABASE_POOL_URL instead when it's set: Supabase's session pooler
  // caps this project at 15 *total* connections project-wide, and no per-instance cap can fully
  // guarantee staying under that once enough concurrent Vercel instances spin up at once — this
  // is what caused the "EMAXCONNSESSION max clients reached" errors seen both in production
  // (killed a CHECK_LINEUPS run on 2026-09-12) and reproduced live via a 24-request concurrent
  // burst on 2026-09-15, even after capping the session-pooler client's own pool size. Supabase's
  // transaction-mode pooler (port 6543) is built for exactly this — many short-lived serverless
  // connections multiplexed onto a handful of real backend ones — and was verified directly
  // against this project: 48 concurrent operations across 16 simulated instances, zero failures,
  // versus failures under a much smaller session-pooler burst.
  //
  // Falls back to DATABASE_URL when DATABASE_POOL_URL isn't set, so this is safe to deploy before
  // the new env var exists anywhere — nothing changes until it's actually added.
  //
  // Transaction mode doesn't support prepared statements — `?pgbouncer=true` on the connection
  // string turns those off. Verified with @prisma/adapter-pg specifically (repeated parameterized
  // queries and a write all worked with no "prepared statement already exists" errors).
  const connectionString = process.env.DATABASE_POOL_URL ?? process.env.DATABASE_URL;
  const adapter = new PrismaPg({ connectionString, max: 3 });
  return new PrismaClient({ adapter });
}

// Reuse a single client across hot reloads in dev; serverless functions get one per cold start.
export const prisma = global.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
