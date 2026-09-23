import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  WidthType,
  AlignmentType,
} from "docx";
import { formatMetricValue, type Metric, type MetricSection, type DateRange } from "@/lib/admin-metrics";
import { renderBarChartPng } from "@/lib/chart-image";

const GOLD = "F0B429";

async function metricToDocxBlocks(metric: Metric): Promise<(Paragraph | Table)[]> {
  const blocks: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: metric.label, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: metric.description, italics: true, color: "8A9A90", size: 20 })] }),
  ];

  if (metric.kind === "number" || metric.kind === "percent" || metric.kind === "duration") {
    blocks.push(
      new Paragraph({
        spacing: { before: 120, after: 120 },
        children: [new TextRun({ text: formatMetricValue(metric), bold: true, size: 44, color: GOLD })],
      }),
    );
  } else if (metric.kind === "timeseries" && metric.series) {
    if (metric.series.length > 0) {
      try {
        const png = await renderBarChartPng(metric.label, metric.series);
        blocks.push(
          new Paragraph({
            children: [new ImageRun({ data: png, transformation: { width: 550, height: 293 }, type: "png" })],
          }),
        );
      } catch (error) {
        console.error("[docx-export] chart render failed:", error);
      }
    } else {
      blocks.push(new Paragraph({ children: [new TextRun("No data in this range.")] }));
    }
  } else if (metric.kind === "table" && metric.columns && metric.rows) {
    const headerRow = new TableRow({
      children: metric.columns.map(
        (col) =>
          new TableCell({
            width: { size: 100 / metric.columns!.length, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: col, bold: true })] })],
          }),
      ),
    });
    const dataRows = metric.rows.map(
      (r) =>
        new TableRow({
          children: r.map(
            (cell) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun(String(cell))] })],
              }),
          ),
        }),
    );
    if (metric.rows.length === 0) {
      blocks.push(new Paragraph({ children: [new TextRun("No data in this range.")] }));
    } else {
      blocks.push(new Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } }));
    }
  }

  blocks.push(new Paragraph({ text: "" }));
  return blocks;
}

export async function buildDocxReport(sections: MetricSection[], range: DateRange): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: "Matchday XI — Traction Metrics", bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({ text: `Range: ${range.from.toDateString()} – ${range.to.toDateString()}`, color: "8A9A90" }),
      ],
    }),
    new Paragraph({
      children: [new TextRun({ text: `Generated: ${new Date().toDateString()}`, color: "8A9A90" })],
    }),
    new Paragraph({ text: "" }),
  ];

  for (const section of sections) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(section.title)] }));
    for (const metric of section.metrics) {
      children.push(...(await metricToDocxBlocks(metric)));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}
