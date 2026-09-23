import { after, NextResponse } from "next/server";
import { emailSeasonExportIfNeeded } from "@/lib/season-export";
import { requireAdmin } from "@/lib/require-admin";
import { confirmSeasonPrizes, SeasonHasUnscoredFixturesError, SeasonNotOverError } from "@/lib/season-prizes";
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
    // The season's full data export is emailed to the founder once winners are confirmed (it
    // includes them). Built after the response is sent so the Confirm button isn't kept waiting;
    // sent at most once per season, and downloadable any time from /admin/prizes regardless.
    after(() => emailSeasonExportIfNeeded(result.season));
    return NextResponse.json({ season: result.season.label, created: result.created, winners: result.count, notified });
  } catch (error) {
    if (error instanceof SeasonNotOverError || error instanceof SeasonHasUnscoredFixturesError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
