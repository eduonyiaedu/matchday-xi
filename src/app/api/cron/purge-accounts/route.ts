import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { withJobRun } from "@/lib/job-run";
import { purgeExpiredAccounts } from "@/lib/services/purge-accounts";

export const runtime = "nodejs";

// Once-daily — needs its own cron-job.org schedule entry (the project's real cron scheduler),
// same as matchday-notify: POST this URL with the usual Authorization bearer header, e.g. on a
// "0 3 * * *" schedule (any once-daily time works, this isn't time-sensitive).
export async function POST(request: NextRequest) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const result = await withJobRun("PURGE_EXPIRED_ACCOUNTS", purgeExpiredAccounts);
  return NextResponse.json(result);
}
