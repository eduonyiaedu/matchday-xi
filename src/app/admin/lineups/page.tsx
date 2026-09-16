import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Footer } from "@/components/layout/footer";
import { LocalTime } from "@/components/ui/local-time";

export default async function AdminLineupsPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/fixtures");

  // Anything not yet fully scored — lets the founder jump into manual entry early (e.g. a
  // known API outage) rather than only after the automated retries have given up.
  const unresolvedLineups = await prisma.fixture.findMany({
    where: { status: { in: ["LOCKED", "LINEUPS_FETCHED", "NEEDS_MANUAL_REVIEW"] } },
    include: { homeTeam: true, awayTeam: true, officialLineups: true },
    orderBy: { kickoffAt: "asc" },
  });

  return (
    <div className="flex min-h-svh flex-col">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4">
        <div>
          <Link href="/admin" className="text-sm text-muted-foreground hover:underline">
            ← Back to admin
          </Link>
          <h1 className="text-2xl font-bold">Lineups not yet fully resolved</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{unresolvedLineups.length} fixture(s)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {unresolvedLineups.map((f) => {
              const sidesFound = f.officialLineups.length;
              return (
                <Link
                  key={f.id}
                  href={`/admin/lineups/${f.id}`}
                  className="flex items-center justify-between border-b py-1 last:border-0 hover:underline"
                >
                  <span>
                    {f.homeTeam.name} vs {f.awayTeam.name} — <LocalTime iso={f.kickoffAt.toISOString()} />
                  </span>
                  <Badge variant={f.status === "NEEDS_MANUAL_REVIEW" ? "destructive" : "secondary"}>
                    {sidesFound}/2 sides · {f.status}
                  </Badge>
                </Link>
              );
            })}
            {unresolvedLineups.length === 0 && (
              <p className="text-muted-foreground">Nothing outstanding — every fixture is fully resolved.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Footer />
    </div>
  );
}
