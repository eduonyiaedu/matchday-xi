import { ImageResponse } from "next/og";
import { loadOgFonts } from "@/lib/og-fonts";

const CHALK = "#F5F3EC";
const MUTED = "#8A9A90";
const GOLD = "#F0B429";
const BG = "#0B1F17";

/**
 * Renders a single-series bar chart to a PNG buffer, for embedding in the Excel/Word exports —
 * exceljs has no native chart-object support (only images), and Word exports read better with a
 * picture than a huge data table. The PowerPoint export uses pptxgenjs's real native charts
 * instead, so this isn't used there.
 */
export async function renderBarChartPng(
  title: string,
  series: { label: string; value: number }[],
  options: { width?: number; height?: number } = {},
): Promise<Buffer> {
  const width = options.width ?? 900;
  const height = options.height ?? 480;
  const fonts = await loadOgFonts();
  const plotHeight = height - 170;
  const max = Math.max(...series.map((s) => s.value), 1);
  // Beyond ~24 bars, labels would overlap into unreadable noise — thin them out while every bar
  // still renders, matching how a dense time-series chart is usually presented.
  const labelEvery = series.length > 24 ? Math.ceil(series.length / 24) : 1;

  const res = new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: BG,
          padding: 40,
          fontFamily: "Inter",
        }}
      >
        <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: CHALK }}>{title}</div>
        <div style={{ display: "flex", flex: 1, alignItems: "flex-end", gap: 10, marginTop: 24 }}>
          {series.map((s) => {
            const barHeight = Math.max((s.value / max) * plotHeight, 3);
            return (
              <div key={s.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                <div style={{ display: "flex", fontSize: 13, fontWeight: 600, color: CHALK, marginBottom: 6 }}>{s.value}</div>
                <div style={{ display: "flex", width: "70%", height: barHeight, backgroundColor: GOLD, borderRadius: 6 }} />
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", marginTop: 10, gap: 10 }}>
          {series.map((s, i) => (
            <div key={s.label} style={{ display: "flex", flex: 1, justifyContent: "center", fontSize: 10, color: MUTED, textAlign: "center" }}>
              {i % labelEvery === 0 ? s.label : ""}
            </div>
          ))}
        </div>
      </div>
    ),
    { width, height, fonts },
  );
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
