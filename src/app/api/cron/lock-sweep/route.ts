import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { withJobRun } from "@/lib/job-run";
import { lockSweep } from "@/lib/services/lock-sweep";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const result = await withJobRun("LOCK_SWEEP", lockSweep);
  return NextResponse.json(result);
}
