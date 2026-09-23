import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { withJobRun } from "@/lib/job-run";
import { runMonthlyPrizeRollupIfDue } from "@/lib/prizes";
import { recomputeCurrentSeasonTotals } from "@/lib/seasons";

export const runtime = "nodejs";
// Eligibility + draw + winner announcement in one call — explicit, matching the other cron routes.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const result = await withJobRun("DAILY_ROLLUP", async () => ({
    monthlyPrize: await runMonthlyPrizeRollupIfDue(),
    // Nightly self-check: keeps User.totalPoints exactly equal to this season's scored predictions
    // (the leaderboard resets each season). Normally 0 — a non-zero count means it corrected drift.
    seasonTotalsCorrected: await recomputeCurrentSeasonTotals(),
  }));
  return NextResponse.json(result);
}
