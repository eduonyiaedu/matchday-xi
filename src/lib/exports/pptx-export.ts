import PptxGenJS from "pptxgenjs";
import { formatMetricValue, type Metric, type MetricSection, type DateRange } from "@/lib/admin-metrics";

const GOLD = "F0B429";
const PITCH = "0B1F17";
const PITCH_LIGHT = "132A20";
const CHALK = "F5F3EC";
const MUTED = "8A9A90";

function addMetricSlide(pptx: PptxGenJS, metric: Metric) {
  const slide = pptx.addSlide();
  slide.background = { color: PITCH };
  slide.addText(metric.label, { x: 0.5, y: 0.35, w: 9, h: 0.6, fontSize: 24, bold: true, color: CHALK });
  slide.addText(metric.description, { x: 0.5, y: 0.95, w: 9, h: 0.7, fontSize: 12, italic: true, color: MUTED });

  if (metric.kind === "number" || metric.kind === "percent" || metric.kind === "duration") {
    slide.addText(formatMetricValue(metric), {
      x: 0.5,
      y: 2,
      w: 9,
      h: 2,
      fontSize: 72,
      bold: true,
      color: GOLD,
      align: "center",
      valign: "middle",
    });
  } else if (metric.kind === "timeseries" && metric.series) {
    if (metric.series.length === 0) {
      slide.addText("No data in this range.", { x: 0.5, y: 2.5, w: 9, h: 1, fontSize: 16, color: MUTED, align: "center" });
    } else {
      slide.addChart(
        pptx.ChartType.bar,
        [{ name: metric.label, labels: metric.series.map((s) => s.label), values: metric.series.map((s) => s.value) }],
        {
          x: 0.5,
          y: 1.9,
          w: 9,
          h: 4.5,
          chartColors: [GOLD],
          catAxisLabelColor: MUTED,
          valAxisLabelColor: MUTED,
          dataLabelColor: CHALK,
          // Per-bar numbers only when there's room — a 90-day daily series is unreadable with them.
          showValue: metric.series.length <= 24,
          plotArea: { fill: { color: PITCH_LIGHT } },
          chartArea: { fill: { color: PITCH } },
        },
      );
    }
  } else if (metric.kind === "table" && metric.columns && metric.rows) {
    if (metric.rows.length === 0) {
      slide.addText("No data in this range.", { x: 0.5, y: 2.5, w: 9, h: 1, fontSize: 16, color: MUTED, align: "center" });
    } else {
      const headerRow = metric.columns.map((col) => ({
        text: col,
        options: { bold: true, color: PITCH, fill: { color: GOLD } },
      }));
      const dataRows = metric.rows.map((r) => r.map((cell) => ({ text: String(cell), options: { color: CHALK, fill: { color: PITCH_LIGHT } } })));
      slide.addTable([headerRow, ...dataRows], { x: 0.5, y: 1.9, w: 9, fontSize: 11, autoPage: true });
    }
  }
}

export async function buildPptxDeck(sections: MetricSection[], range: DateRange): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "MDXI", width: 10, height: 6.5 });
  pptx.layout = "MDXI";

  const title = pptx.addSlide();
  title.background = { color: PITCH };
  title.addText("Matchday XI", { x: 0.5, y: 2.2, w: 9, h: 1, fontSize: 44, bold: true, color: CHALK, align: "center" });
  title.addText("Traction Metrics", { x: 0.5, y: 3, w: 9, h: 0.7, fontSize: 24, color: GOLD, align: "center" });
  title.addText(`${range.from.toDateString()} – ${range.to.toDateString()}`, {
    x: 0.5,
    y: 3.8,
    w: 9,
    h: 0.5,
    fontSize: 14,
    color: MUTED,
    align: "center",
  });

  for (const section of sections) {
    const sectionSlide = pptx.addSlide();
    sectionSlide.background = { color: PITCH };
    sectionSlide.addText(section.title, { x: 0.5, y: 2.7, w: 9, h: 1, fontSize: 36, bold: true, color: GOLD, align: "center" });
    for (const metric of section.metrics) {
      addMetricSlide(pptx, metric);
    }
  }

  const data = await pptx.write({ outputType: "nodebuffer" });
  return data as Buffer;
}
