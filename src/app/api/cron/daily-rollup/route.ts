import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { withJobRun } from "@/lib/job-run";
import { runMonthlyPrizeRollupIfDue } from "@/lib/prizes";

export const runtime = "nodejs";
// Eligibility + draw + winner announcement in one call — explicit, matching the other cron routes.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const result = await withJobRun("DAILY_ROLLUP", runMonthlyPrizeRollupIfDue);
  return NextResponse.json(result);
}
