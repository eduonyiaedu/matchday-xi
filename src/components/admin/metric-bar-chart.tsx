/**
 * Minimal dependency-free bar chart for a single magnitude series (weekly signups, streak
 * buckets, sessions/day) — thin gold rounded-top bars, direct value labels, a native <title>
 * hover tooltip per bar. Deliberately simple: this is the in-app admin view, not the
 * investor-facing artifact — the polished output for that is the PPT/Excel export.
 */
export function MetricBarChart({ series, unit }: { series: { label: string; value: number }[]; unit?: string }) {
  if (series.length === 0) {
    return <p className="text-sm text-muted-foreground">No data in this range.</p>;
  }

  const max = Math.max(...series.map((s) => s.value), 1);
  const barWidth = 28;
  const gap = 12;
  const plotHeight = 120;
  const width = series.length * (barWidth + gap) + gap;
  const height = plotHeight + 40;

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} role="img" aria-label="Bar chart">
        <line x1={0} y1={plotHeight} x2={width} y2={plotHeight} stroke="var(--chalk)" strokeOpacity={0.14} strokeWidth={1} />
        {series.map((s, i) => {
          const barHeight = max > 0 ? (s.value / max) * plotHeight : 0;
          const x = gap + i * (barWidth + gap);
          const y = plotHeight - barHeight;
          const shortLabel = s.label.length > 10 ? s.label.slice(5) : s.label;
          return (
            <g key={s.label}>
              <title>
                {s.label}: {s.value}
                {unit ? ` ${unit}` : ""}
              </title>
              <rect x={x} y={y} width={barWidth} height={Math.max(barHeight, 2)} rx={4} fill="var(--gold)" />
              <text x={x + barWidth / 2} y={Math.max(y - 4, 10)} textAnchor="middle" fontSize="9" fill="var(--chalk)">
                {s.value}
              </text>
              <text
                x={x + barWidth / 2}
                y={plotHeight + 14}
                textAnchor="end"
                fontSize="9"
                fill="var(--muted-foreground)"
                transform={`rotate(-40 ${x + barWidth / 2} ${plotHeight + 14})`}
              >
                {shortLabel}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
