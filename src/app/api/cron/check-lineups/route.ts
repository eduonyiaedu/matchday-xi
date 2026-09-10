import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { withJobRun } from "@/lib/job-run";
import { checkLineupsAndScore } from "@/lib/services/lineup-check";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const result = await withJobRun("CHECK_LINEUPS", checkLineupsAndScore);
  return NextResponse.json(result);
}
