import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { withJobRun } from "@/lib/job-run";
import { syncTeamsAndSquads } from "@/lib/services/fixture-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const { response } = await requireAdmin();
  if (response) return response;

  const result = await withJobRun("SYNC_SQUADS", syncTeamsAndSquads);
  return NextResponse.json(result);
}
