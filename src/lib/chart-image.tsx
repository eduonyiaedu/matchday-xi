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
  // Dense series (e.g. "Sessions per day" over a 90-day range) used to render as garbage: a fixed
  // 10px gap between 90 bars needs ~890px of gaps alone, more than the ~820px plot width, so every
  // bar collapsed to zero width while the per-bar values and date labels piled on top of each
  // other (confirmed by rendering one, 2026-09-23). So: the gap shrinks with bar count, per-bar
  // values only show when there's room for them, and at most ~14 date labels are drawn.
  const gap = series.length <= 24 ? 10 : series.length <= 60 ? 3 : 1;
  const showValues = series.length <= 24;
  const labelEvery = Math.max(1, Math.ceil(series.length / 14));

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
        <div style={{ display: "flex", flex: 1, alignItems: "flex-end", gap, marginTop: 24 }}>
          {series.map((s, i) => {
            const barHeight = Math.max((s.value / max) * plotHeight, 3);
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, minWidth: 0 }}>
                {showValues && (
                  <div style={{ display: "flex", fontSize: 13, fontWeight: 600, color: CHALK, marginBottom: 6 }}>{s.value}</div>
                )}
                <div
                  style={{
                    display: "flex",
                    width: showValues ? "70%" : "100%",
                    height: barHeight,
                    backgroundColor: GOLD,
                    borderRadius: showValues ? 6 : 1,
                  }}
                />
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", marginTop: 10, gap }}>
          {series.map((s, i) => (
            <div
              key={i}
              style={{ display: "flex", flex: 1, minWidth: 0, justifyContent: "center", fontSize: 10, color: MUTED, whiteSpace: "nowrap" }}
            >
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
