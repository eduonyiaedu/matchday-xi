import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DuplicateFlagList } from "@/components/admin/duplicate-flag-list";
import { Footer } from "@/components/layout/footer";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/fixtures");

  const q = (await searchParams).q?.trim().slice(0, 100) ?? "";

  const [unresolvedCount, feedbackCount, users] = await Promise.all([
    // Anything not yet fully scored — lets the founder jump into manual entry early (e.g. a
    // known API outage) rather than only after the automated retries have given up.
    prisma.fixture.count({ where: { status: { in: ["LOCKED", "LINEUPS_FETCHED", "NEEDS_MANUAL_REVIEW"] } } }),
    prisma.accountDeletionFeedback.count(),
    // Newest 30 by default; a search reaches any user, not just recent sign-ups — a duplicate
    // account is often discovered long after it was created.
    prisma.user.findMany({
      where: q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { displayName: { contains: q, mode: "insensitive" } },
              { username: { contains: q, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  return (
    <div className="flex min-h-svh flex-col">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4">
        <div>
          <Link href="/fixtures" className="text-sm text-muted-foreground hover:underline">
            ← Back to app
          </Link>
          <h1 className="text-2xl font-bold">Admin</h1>
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

          <Link href="/admin/sync">
            <Card className="h-full hover:bg-white/5">
              <CardContent className="pt-4">
                <p className="font-heading text-sm font-semibold uppercase">Sync options</p>
                <p className="mt-1 text-xs text-muted-foreground">Manually trigger squad/fixture/standings syncs</p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/prizes">
            <Card className="h-full hover:bg-white/5">
              <CardContent className="pt-4">
                <p className="font-heading text-sm font-semibold uppercase">Prizes</p>
                <p className="mt-1 text-xs text-muted-foreground">Monthly draw winners and season 1st/2nd/3rd</p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/feedback">
            <Card className="h-full hover:bg-white/5">
              <CardContent className="flex items-center justify-between pt-4">
                <div>
                  <p className="font-heading text-sm font-semibold uppercase">Deletion feedback</p>
                  <p className="mt-1 text-xs text-muted-foreground">Why people deleted their accounts</p>
                </div>
                <Badge variant="secondary" className="text-base">
                  {feedbackCount}
                </Badge>
              </CardContent>
            </Card>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Users — duplicate-account fair-play flag</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <form method="GET" className="flex gap-2">
              <Input name="q" defaultValue={q} placeholder="Search by email, name or username" className="max-w-sm" />
              <Button type="submit" variant="outline" size="sm">
                Search
              </Button>
              {q && (
                <Link href="/admin" className="self-center text-xs text-muted-foreground hover:underline">
                  Clear
                </Link>
              )}
            </form>
            <p className="text-xs text-muted-foreground">
              {q ? `Up to 30 users matching "${q}"` : "Newest 30 users"}
            </p>
            <DuplicateFlagList
              key={q}
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
