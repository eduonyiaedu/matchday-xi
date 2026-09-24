import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { withJobRun } from "@/lib/job-run";
import { lockSweep } from "@/lib/services/lock-sweep";
import { notifySweep } from "@/lib/services/notify-sweep";
import { advanceSeasonExports, SEASON_EXPORT_PENDING } from "@/lib/season-export";
import { prisma } from "@/lib/prisma";

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
  // A season export being built in the background (lib/season-export.ts) gets its next piece done
  // on each tick — only logged as a job run while one is actually in progress.
  const exportPending = (await prisma.season.count({ where: SEASON_EXPORT_PENDING })) > 0;
  // allSettled, not all: each job records its own success/failure on its JobRun (that's what
  // /admin/jobs and the audits watch), so one job failing must neither cut the others short — a
  // rejected Promise.all returns immediately and the platform can freeze the rest mid-run once the
  // response is sent — nor make this whole route fail, which cron-job.org could count towards
  // disabling the 5-minute schedule that lock-sweep itself depends on.
  const [lock, notify, exported] = await Promise.allSettled([
    withJobRun("LOCK_SWEEP", lockSweep),
    withJobRun("NOTIFY_SWEEP", notifySweep),
    exportPending ? withJobRun("SEASON_EXPORT", async () => ({ seasonExports: await advanceSeasonExports(40_000) })) : null,
  ]);
  const outcome = (r: PromiseSettledResult<unknown>) =>
    r.status === "fulfilled" ? r.value : { error: r.reason instanceof Error ? r.reason.message : String(r.reason) };
  return NextResponse.json({ lockSweep: outcome(lock), notifySweep: outcome(notify), seasonExport: outcome(exported) });
}
