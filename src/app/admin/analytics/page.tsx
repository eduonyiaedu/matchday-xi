import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { getAdminMetrics } from "@/lib/admin-metrics";
import { MetricCard } from "@/components/admin/metric-card";
import { MetricsDateRangeForm } from "@/components/admin/metrics-date-range-form";
import { MetricsExportButtons } from "@/components/admin/metrics-export-buttons";
import { Footer } from "@/components/layout/footer";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/fixtures");

  const { from: fromParam, to: toParam } = await searchParams;
  const now = new Date();
  const defaultFrom = isoDate(new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000));
  const defaultTo = isoDate(now);
  const from = fromParam ? new Date(fromParam) : new Date(defaultFrom);
  const to = toParam ? new Date(toParam) : new Date(defaultTo);

  const sections = await getAdminMetrics({ from, to });

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
          <MetricsDateRangeForm defaultFrom={fromParam ?? defaultFrom} defaultTo={toParam ?? defaultTo} />
          <MetricsExportButtons from={fromParam ?? defaultFrom} to={toParam ?? defaultTo} />
        </div>

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
