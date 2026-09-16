import ExcelJS from "exceljs";
import type { Metric, MetricSection, DateRange } from "@/lib/admin-metrics";
import { renderBarChartPng } from "@/lib/chart-image";

const GOLD_ARGB = "FFF0B429";
const PITCH_ARGB = "FF0B1F17";
const CHALK_ARGB = "FFF5F3EC";

function sheetName(title: string): string {
  // Excel sheet names: max 31 chars, no : \ / ? * [ ]
  return title.replace(/[:\\/?*[\]]/g, "").slice(0, 31);
}

async function writeMetric(worksheet: ExcelJS.Worksheet, workbook: ExcelJS.Workbook, metric: Metric, row: number): Promise<number> {
  const labelCell = worksheet.getCell(row, 1);
  labelCell.value = metric.label;
  labelCell.font = { bold: true, size: 13, color: { argb: CHALK_ARGB } };
  labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PITCH_ARGB } };
  row++;

  const descCell = worksheet.getCell(row, 1);
  descCell.value = metric.description;
  descCell.font = { italic: true, size: 10, color: { argb: "FF8A9A90" } };
  worksheet.mergeCells(row, 1, row, 6);
  descCell.alignment = { wrapText: true };
  row += 2;

  if (metric.kind === "number" || metric.kind === "percent" || metric.kind === "duration") {
    const suffix = metric.kind === "percent" ? "%" : metric.unit ? ` ${metric.unit}` : "";
    const valueCell = worksheet.getCell(row, 1);
    valueCell.value = `${metric.value}${suffix}`;
    valueCell.font = { bold: true, size: 20, color: { argb: GOLD_ARGB } };
    row += 2;
  } else if (metric.kind === "timeseries" && metric.series) {
    worksheet.getCell(row, 1).value = "Label";
    worksheet.getCell(row, 2).value = "Value";
    worksheet.getRow(row).font = { bold: true };
    row++;
    const tableStart = row;
    for (const point of metric.series) {
      worksheet.getCell(row, 1).value = point.label;
      worksheet.getCell(row, 2).value = point.value;
      row++;
    }
    if (metric.series.length > 0) {
      try {
        const png = await renderBarChartPng(metric.label, metric.series);
        // @types/node version differs between this project and a transitive dep of `docx`,
        // producing two structurally-incompatible global Buffer declarations that TypeScript
        // can't reconcile even though both are the same real Node Buffer at runtime.
        const imageId = workbook.addImage({ buffer: png, extension: "png" } as unknown as ExcelJS.Image);
        worksheet.addImage(imageId, { tl: { col: 3, row: tableStart - 1 }, ext: { width: 450, height: 240 } });
      } catch (error) {
        console.error("[xlsx-export] chart render failed:", error);
      }
    }
    row += 2;
  } else if (metric.kind === "table" && metric.columns && metric.rows) {
    metric.columns.forEach((col, i) => {
      const cell = worksheet.getCell(row, i + 1);
      cell.value = col;
      cell.font = { bold: true };
    });
    row++;
    for (const dataRow of metric.rows) {
      dataRow.forEach((value, i) => {
        worksheet.getCell(row, i + 1).value = value;
      });
      row++;
    }
    row += 1;
  }

  return row + 1;
}

export async function buildXlsxWorkbook(sections: MetricSection[], range: DateRange): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Matchday XI";
  workbook.created = new Date();

  const cover = workbook.addWorksheet("Overview");
  cover.getCell(1, 1).value = "Matchday XI — Traction Metrics";
  cover.getCell(1, 1).font = { bold: true, size: 18 };
  cover.getCell(2, 1).value = `Range: ${range.from.toDateString()} – ${range.to.toDateString()}`;
  cover.getCell(3, 1).value = `Generated: ${new Date().toDateString()}`;
  cover.getCell(5, 1).value = "Sections";
  cover.getCell(5, 1).font = { bold: true };
  sections.forEach((s, i) => {
    cover.getCell(6 + i, 1).value = s.title;
  });
  cover.getColumn(1).width = 40;

  for (const section of sections) {
    const worksheet = workbook.addWorksheet(sheetName(section.title));
    worksheet.getColumn(1).width = 32;
    for (let i = 2; i <= 6; i++) worksheet.getColumn(i).width = 20;
    let row = 1;
    for (const metric of section.metrics) {
      row = await writeMetric(worksheet, workbook, metric, row);
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
