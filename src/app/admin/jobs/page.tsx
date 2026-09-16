import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Footer } from "@/components/layout/footer";
import { LocalTime } from "@/components/ui/local-time";

export default async function AdminJobsPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/fixtures");

  const recentJobs = await prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 50 });

  return (
    <div className="flex min-h-svh flex-col">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4">
        <div>
          <Link href="/admin" className="text-sm text-muted-foreground hover:underline">
            ← Back to admin
          </Link>
          <h1 className="text-2xl font-bold">Recent cron job runs</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Last 50 runs</CardTitle>
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
            {recentJobs.length === 0 && <p className="text-muted-foreground">No jobs have run yet.</p>}
          </CardContent>
        </Card>
      </div>
      <Footer />
    </div>
  );
}
