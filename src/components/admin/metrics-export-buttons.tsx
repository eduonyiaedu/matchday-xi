"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const FORMATS: { format: "xlsx" | "docx" | "pptx"; label: string }[] = [
  { format: "xlsx", label: "Export Excel" },
  { format: "docx", label: "Export Word" },
  { format: "pptx", label: "Export PowerPoint" },
];

export function MetricsExportButtons({ from, to }: { from: string; to: string }) {
  const [downloading, setDownloading] = useState<string | null>(null);

  async function handleExport(format: "xlsx" | "docx" | "pptx") {
    setDownloading(format);
    try {
      const res = await fetch(`/api/admin/metrics/export?format=${format}&from=${from}&to=${to}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+)"/);
      a.download = match?.[1] ?? `matchday-xi-metrics.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Couldn't generate that export. Try again?");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {FORMATS.map(({ format, label }) => (
        <Button key={format} variant="outline" size="sm" disabled={downloading !== null} onClick={() => handleExport(format)}>
          {downloading === format ? "Preparing..." : label}
        </Button>
      ))}
    </div>
  );
}
