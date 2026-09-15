import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { withJobRun } from "@/lib/job-run";
import { lockSweep } from "@/lib/services/lock-sweep";
import { notifySweep } from "@/lib/services/notify-sweep";

export const runtime = "nodejs";

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
