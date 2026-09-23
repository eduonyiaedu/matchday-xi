import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { getAdminMetricsCached, parseMetricsRange } from "@/lib/admin-metrics";
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

export async function GET(request: NextRequest) {
  const { response } = await requireAdmin();
  if (response) return response;

  const format = request.nextUrl.searchParams.get("format") as Format | null;
  if (!format || !(format in FORMATS)) {
    return NextResponse.json({ error: "format must be one of xlsx, docx, pptx" }, { status: 400 });
  }

  const { range, toInput } = parseMetricsRange(
    request.nextUrl.searchParams.get("from"),
    request.nextUrl.searchParams.get("to"),
  );

  const { sections } = await getAdminMetricsCached(range);

  const buffer =
    format === "xlsx"
      ? await buildXlsxWorkbook(sections, range)
      : format === "docx"
        ? await buildDocxReport(sections, range)
        : await buildPptxDeck(sections, range);

  const { contentType, ext } = FORMATS[format];
  const filename = `matchday-xi-metrics-${toInput}.${ext}`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
