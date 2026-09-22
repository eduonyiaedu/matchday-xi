import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { withJobRun } from "@/lib/job-run";
import { matchdayNotifySweep } from "@/lib/services/matchday-notify";

export const runtime = "nodejs";
export const maxDuration = 60;

// Once-daily at 8am UTC — NOT part of the existing 5-minute lock-sweep/notify-sweep cadence.
// Needs its own cron-job.org schedule entry (the project's real cron scheduler — see the
// "no `schedule` trigger" note in .github/workflows/prediction-lifecycle.yml for why GitHub
// Actions' own scheduler isn't used here): POST this URL with the usual Authorization bearer
// header on a "0 8 * * *" schedule.
export async function POST(request: NextRequest) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const result = await withJobRun("MATCHDAY_NOTIFY", matchdayNotifySweep);
  return NextResponse.json(result);
}
