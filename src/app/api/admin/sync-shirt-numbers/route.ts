import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { withJobRun } from "@/lib/job-run";
import { syncShirtNumbersAndU21Squads } from "@/lib/services/squad-enrichment-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const { response } = await requireAdmin();
  if (response) return response;

  const result = await withJobRun("SYNC_SHIRT_NUMBERS", syncShirtNumbersAndU21Squads);
  return NextResponse.json(result);
}
