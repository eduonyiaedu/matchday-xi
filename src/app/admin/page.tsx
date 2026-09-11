import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ManualSyncButtons } from "@/components/admin/manual-sync-button";
import { DuplicateFlagList } from "@/components/admin/duplicate-flag-list";
import { Footer } from "@/components/layout/footer";
import { LocalTime } from "@/components/ui/local-time";

export default async function AdminPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/fixtures");

  const [recentJobs, unresolvedLineups, users] = await Promise.all([
    prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
    prisma.fixture.findMany({
      where: { status: "NEEDS_MANUAL_REVIEW" },
      include: { homeTeam: true, awayTeam: true },
    }),
    prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
  ]);

  return (
    <div className="flex min-h-svh flex-col">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/fixtures" className="text-sm text-muted-foreground hover:underline">
              ← Back to app
            </Link>
            <h1 className="text-2xl font-bold">Admin</h1>
          </div>
          <ManualSyncButtons />
        </div>

        {unresolvedLineups.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Needs manual review — no lineup found by kickoff</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              {unresolvedLineups.map((f) => (
                <p key={f.id}>
                  {f.homeTeam.name} vs {f.awayTeam.name} — <LocalTime iso={f.kickoffAt.toISOString()} />
                </p>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent cron job runs</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {recentJobs.map((job) => (
              <div key={job.id} className="flex items-center justify-between border-b pb-1 last:border-0">
                <span>{job.jobName}</span>
                <span className="text-muted-foreground">
                  <LocalTime iso={job.startedAt.toISOString()} />
                </span>
                <Badge variant={job.status === "FAILURE" ? "destructive" : "secondary"}>
                  {job.status ?? "running"}
                </Badge>
              </div>
            ))}
            {recentJobs.length === 0 && (
              <p className="text-muted-foreground">No jobs have run yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Users — duplicate-account fair-play flag</CardTitle>
          </CardHeader>
          <CardContent>
            <DuplicateFlagList
              users={users.map((u) => ({
                id: u.id,
                email: u.email,
                displayName: u.displayName,
                isFlaggedDuplicate: u.isFlaggedDuplicate,
              }))}
            />
          </CardContent>
        </Card>
      </div>
      <Footer />
    </div>
  );
}
