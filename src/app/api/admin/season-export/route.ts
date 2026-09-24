import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { listSeasons } from "@/lib/seasons";
import {
  advanceSeasonExports,
  emailSeasonExportLinks,
  requestSeasonExport,
  seasonExportLinks,
  type ExportFile,
} from "@/lib/season-export";

export const runtime = "nodejs";
export const maxDuration = 60;

async function findSeason(request: NextRequest) {
  const label = request.nextUrl.searchParams.get("season");
  return (await listSeasons()).find((s) => s.label === label) ?? null;
}

/**
 * Download one file of a season's finished export (?season=2026-27&file=0) — redirects to a
 * short-lived signed link to the stored file (admin only).
 */
export async function GET(request: NextRequest) {
  const { response } = await requireAdmin();
  if (response) return response;

  const season = await findSeason(request);
  if (!season) return NextResponse.json({ error: "Unknown season" }, { status: 404 });
  const row = await prisma.season.findUniqueOrThrow({ where: { id: season.id }, select: { exportFiles: true } });
  const files = (row.exportFiles as unknown as ExportFile[] | null) ?? [];
  const file = files[Number(request.nextUrl.searchParams.get("file"))];
  if (!file) return NextResponse.json({ error: "No such file — prepare the export first." }, { status: 404 });

  const [link] = await seasonExportLinks([file], season.label);
  return NextResponse.redirect(link.url);
}

const actionSchema = z.object({ action: z.enum(["build", "email"]) });

/**
 * From /admin/prizes: "build" (re)builds a season's export in the background; "email" emails the
 * download links — straight away if an export is ready, otherwise once a new build finishes.
 */
export async function POST(request: NextRequest) {
  const { response } = await requireAdmin();
  if (response) return response;

  const season = await findSeason(request);
  if (!season) return NextResponse.json({ error: "Unknown season" }, { status: 404 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const row = await prisma.season.findUniqueOrThrow({ where: { id: season.id }, select: { exportStatus: true } });
  if (parsed.data.action === "email" && row.exportStatus === "READY") {
    const email = await emailSeasonExportLinks(season);
    if (email === "busy") {
      return NextResponse.json({ error: "It's already being sent — check your inbox in a minute." }, { status: 409 });
    }
    if (email === "failed") {
      return NextResponse.json({ error: "Couldn't send it just now — try again in a few minutes." }, { status: 502 });
    }
    return NextResponse.json({ status: "emailed" });
  }

  const started = await requestSeasonExport(season, { email: parsed.data.action === "email" });
  // Start building now, in the background after this response; the 5-minute sweep carries on
  // with anything that doesn't fit in this one run.
  after(() => advanceSeasonExports(45_000).catch((error) => console.error("[season-export] background run failed:", error)));
  return NextResponse.json({ status: started ? "started" : "already-running" });
}
