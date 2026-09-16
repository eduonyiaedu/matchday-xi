import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ManualSyncButtons } from "@/components/admin/manual-sync-button";
import { DuplicateFlagList } from "@/components/admin/duplicate-flag-list";
import { Footer } from "@/components/layout/footer";

export default async function AdminPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/fixtures");

  const [unresolvedCount, users] = await Promise.all([
    // Anything not yet fully scored — lets the founder jump into manual entry early (e.g. a
    // known API outage) rather than only after the automated retries have given up.
    prisma.fixture.count({ where: { status: { in: ["LOCKED", "LINEUPS_FETCHED", "NEEDS_MANUAL_REVIEW"] } } }),
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

        <div className="grid gap-4 sm:grid-cols-3">
          <Link href="/admin/lineups">
            <Card className="h-full hover:bg-white/5">
              <CardContent className="flex items-center justify-between pt-4">
                <div>
                  <p className="font-heading text-sm font-semibold uppercase">Unresolved lineups</p>
                  <p className="mt-1 text-xs text-muted-foreground">Fixtures still needing an official XI</p>
                </div>
                <Badge variant={unresolvedCount > 0 ? "destructive" : "secondary"} className="text-base">
                  {unresolvedCount}
                </Badge>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/jobs">
            <Card className="h-full hover:bg-white/5">
              <CardContent className="pt-4">
                <p className="font-heading text-sm font-semibold uppercase">Cron job runs</p>
                <p className="mt-1 text-xs text-muted-foreground">Recent automation history</p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/analytics">
            <Card className="h-full hover:bg-white/5">
              <CardContent className="pt-4">
                <p className="font-heading text-sm font-semibold uppercase">Traction metrics</p>
                <p className="mt-1 text-xs text-muted-foreground">Growth, retention, engagement — exportable</p>
              </CardContent>
            </Card>
          </Link>
        </div>

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
