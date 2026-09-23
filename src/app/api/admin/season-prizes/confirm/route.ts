import { after, NextResponse } from "next/server";
import { advanceSeasonExports, requestSeasonExport } from "@/lib/season-export";
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
    // The season's full data export (it includes the winners) is built in the background once
    // they're confirmed, and the download links emailed to the founder when it's ready — also
    // available any time from /admin/prizes. The 5-minute sweep carries on with a big build.
    if (result.created) {
      await requestSeasonExport(result.season, { email: true });
      after(() => advanceSeasonExports(35_000).catch((error) => console.error("[season-export] background run failed:", error)));
    }
    return NextResponse.json({ season: result.season.label, created: result.created, winners: result.count, notified });
  } catch (error) {
    if (error instanceof SeasonNotOverError || error instanceof SeasonHasUnscoredFixturesError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
