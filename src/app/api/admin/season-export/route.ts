import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { listSeasons } from "@/lib/seasons";
import { buildSeasonExport, emailSeasonExportIfNeeded, seasonExportFilename } from "@/lib/season-export";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * "Email it to me" from /admin/prizes (?season=2026-27) — also the retry path if the automatic
 * email after confirming winners didn't arrive (re-confirming can't retry it: an already-confirmed
 * season is no longer the one up for confirmation).
 */
export async function POST(request: NextRequest) {
  const { response } = await requireAdmin();
  if (response) return response;

  const label = request.nextUrl.searchParams.get("season");
  const season = (await listSeasons()).find((s) => s.label === label);
  if (!season) return NextResponse.json({ error: "Unknown season" }, { status: 404 });

  const sent = await emailSeasonExportIfNeeded(season, { resend: true });
  if (!sent) {
    return NextResponse.json(
      { error: "Couldn't send it — it may already be on its way. Try again in a few minutes, or download it instead." },
      { status: 409 },
    );
  }
  return NextResponse.json({ sent: true });
}

/** Admin download of a season's full data export (?season=2026-27) — built fresh on each request. */
export async function GET(request: NextRequest) {
  const { response } = await requireAdmin();
  if (response) return response;

  const label = request.nextUrl.searchParams.get("season");
  const season = (await listSeasons()).find((s) => s.label === label);
  if (!season) return NextResponse.json({ error: "Unknown season" }, { status: 404 });

  const file = await buildSeasonExport(season);
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${seasonExportFilename(season)}"`,
    },
  });
}
