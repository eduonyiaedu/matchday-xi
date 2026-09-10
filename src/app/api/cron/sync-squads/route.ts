import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { withJobRun } from "@/lib/job-run";
import { syncTeamsAndSquads } from "@/lib/services/fixture-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const result = await withJobRun("SYNC_SQUADS", syncTeamsAndSquads);
  return NextResponse.json(result);
}
