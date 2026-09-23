import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { getAdminMetricsCached, parseMetricsRange } from "@/lib/admin-metrics";
import { LocalTime } from "@/components/ui/local-time";
import { MetricCard } from "@/components/admin/metric-card";
import { MetricsDateRangeForm } from "@/components/admin/metrics-date-range-form";
import { MetricsExportButtons } from "@/components/admin/metrics-export-buttons";
import { Footer } from "@/components/layout/footer";

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; refresh?: string }>;
}) {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/fixtures");

  const { from: fromParam, to: toParam, refresh } = await searchParams;
  const { range, fromInput, toInput } = parseMetricsRange(fromParam, toParam);

  const { sections, computedAt } = await getAdminMetricsCached(range, { refresh: refresh === "1" });

  return (
    <div className="flex min-h-svh flex-col">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4">
        <div>
          <Link href="/admin" className="text-sm text-muted-foreground hover:underline">
            ← Back to admin
          </Link>
          <h1 className="text-2xl font-bold">Traction metrics</h1>
          <p className="text-sm text-muted-foreground">
            Growth, engagement, retention, and virality — built for pulling into investor updates.
          </p>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <MetricsDateRangeForm defaultFrom={fromInput} defaultTo={toInput} />
          <MetricsExportButtons from={fromInput} to={toInput} />
        </div>
        <p className="-mt-3 text-xs text-muted-foreground">
          Figures as of <LocalTime iso={computedAt.toISOString()} /> — saved and reused for up to an hour (a day for ranges that end before today).{" "}
          <Link href={`/admin/analytics?from=${fromInput}&to=${toInput}&refresh=1`} className="underline">
            Recount now
          </Link>
        </p>

        {sections.map((section) => (
          <div key={section.key} className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-semibold uppercase text-muted-foreground">{section.title}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {section.metrics.map((metric) => (
                <MetricCard key={metric.key} metric={metric} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <Footer />
    </div>
  );
}
