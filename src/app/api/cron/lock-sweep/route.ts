import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { withJobRun } from "@/lib/job-run";
import { lockSweep } from "@/lib/services/lock-sweep";
import { notifySweep } from "@/lib/services/notify-sweep";

export const runtime = "nodejs";
// notifySweep processes fixtures sequentially and fans out a push to every subscriber per
// fixture — several Premier League kickoffs routinely cross the "opens"/"30-min" threshold in
// the same 5-minute tick, and the platform's default timeout is well under what that can take.
// If the function were killed between a push blast and its dedup-flag write, the same users
// would get notified again on the next tick.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  // Two unrelated concerns sharing one 5-minute trigger rather than provisioning a second
  // cron-job.org schedule for notifySweep alone — logged as separate JobRuns either way.
  const [lockResult, notifyResult] = await Promise.all([
    withJobRun("LOCK_SWEEP", lockSweep),
    withJobRun("NOTIFY_SWEEP", notifySweep),
  ]);
  return NextResponse.json({ ...lockResult, ...notifyResult });
}
