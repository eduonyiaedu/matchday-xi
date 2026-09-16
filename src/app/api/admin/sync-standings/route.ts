import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { withJobRun } from "@/lib/job-run";
import { syncStandingsAndScorers } from "@/lib/services/standings-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const { response } = await requireAdmin();
  if (response) return response;

  const result = await withJobRun("SYNC_STANDINGS", syncStandingsAndScorers);
  return NextResponse.json(result);
}
