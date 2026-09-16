import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { getAdminMetrics } from "@/lib/admin-metrics";
import { buildXlsxWorkbook } from "@/lib/exports/xlsx-export";
import { buildDocxReport } from "@/lib/exports/docx-export";
import { buildPptxDeck } from "@/lib/exports/pptx-export";

export const runtime = "nodejs";
export const maxDuration = 60;

const FORMATS = {
  xlsx: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" },
  docx: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" },
  pptx: { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: "pptx" },
} as const;

type Format = keyof typeof FORMATS;

function parseDate(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export async function GET(request: NextRequest) {
  const { response } = await requireAdmin();
  if (response) return response;

  const format = request.nextUrl.searchParams.get("format") as Format | null;
  if (!format || !(format in FORMATS)) {
    return NextResponse.json({ error: "format must be one of xlsx, docx, pptx" }, { status: 400 });
  }

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const from = parseDate(request.nextUrl.searchParams.get("from"), defaultFrom);
  const to = parseDate(request.nextUrl.searchParams.get("to"), now);

  const sections = await getAdminMetrics({ from, to });

  const buffer =
    format === "xlsx"
      ? await buildXlsxWorkbook(sections, { from, to })
      : format === "docx"
        ? await buildDocxReport(sections, { from, to })
        : await buildPptxDeck(sections, { from, to });

  const { contentType, ext } = FORMATS[format];
  const filename = `matchday-xi-metrics-${to.toISOString().slice(0, 10)}.${ext}`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
