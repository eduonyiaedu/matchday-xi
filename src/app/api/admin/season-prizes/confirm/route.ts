import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { confirmSeasonPrizes, SeasonNotOverError } from "@/lib/season-prizes";
import { notifySeasonPrizesIfNeeded } from "@/lib/prize-notify";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Founder confirms the season's 1st/2nd/3rd from /admin/prizes. Placings are locked in first (in
 * their own transaction), and the announcement goes out only after that has committed — a push
 * failure must never undo a confirmed result.
 */
export async function POST() {
  const { response } = await requireAdmin();
  if (response) return response;

  try {
    const result = await confirmSeasonPrizes();
    const notified = await notifySeasonPrizesIfNeeded(result.season.competitionId, result.season.label);
    return NextResponse.json({ season: result.season.label, created: result.created, winners: result.count, notified });
  } catch (error) {
    if (error instanceof SeasonNotOverError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
