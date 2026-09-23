import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricBarChart } from "@/components/admin/metric-bar-chart";
import { formatMetricValue, type Metric } from "@/lib/admin-metrics";

export function MetricCard({ metric }: { metric: Metric }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{metric.label}</CardTitle>
        <p className="text-xs text-muted-foreground">{metric.description}</p>
      </CardHeader>
      <CardContent>
        {(metric.kind === "number" || metric.kind === "percent" || metric.kind === "duration") && (
          <p className="font-heading text-3xl font-semibold text-gold">{formatMetricValue(metric)}</p>
        )}

        {metric.kind === "timeseries" && metric.series && <MetricBarChart series={metric.series} unit={metric.unit} />}

        {metric.kind === "table" && metric.columns && metric.rows && (
          <div className="overflow-x-auto">
            {metric.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data in this range.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    {metric.columns.map((col) => (
                      <th key={col} className="py-1.5 pr-4 font-medium">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metric.rows.map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      {row.map((cell, j) => (
                        <td key={j} className="py-1.5 pr-4">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
