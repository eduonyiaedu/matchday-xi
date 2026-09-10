import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ComingSoonCard } from "@/components/prizes/coming-soon-card";

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function PrizesPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) return null;

  const month = currentMonthKey();
  const eligibility = await prisma.monthlyPrizeEligibility.findUnique({
    where: { userId_month: { userId: user.id, month } },
  });
  const lastDraw = await prisma.monthlyPrizeDraw.findFirst({
    where: { drawnAt: { not: null } },
    orderBy: { month: "desc" },
    include: { winner: { select: { displayName: true } } },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Prizes</h1>
        <p className="text-sm text-muted-foreground">
          Free to enter — no purchase required for anything below.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your streak</CardTitle>
          <CardDescription>Log in every day this month to stay eligible for the draw.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-4">
          <Badge className="text-base">🔥 {user.currentStreak} day streak</Badge>
          <Badge variant="secondary">Best: {user.longestStreak}</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monthly prize draw</CardTitle>
          <CardDescription>
            A random draw among everyone who predicted every matchday their team played this
            month AND logged in every day.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {eligibility ? (
            <>
              <p>Predicted every matchday so far: {eligibility.predictedEveryMatchday ? "✅" : "❌"}</p>
              <p>Logged in every day so far: {eligibility.loggedInEveryDay ? "✅" : "❌"}</p>
            </>
          ) : (
            <p className="text-muted-foreground">
              Eligibility for {month} is calculated at month-end.
            </p>
          )}
          {lastDraw?.winner && (
            <p className="mt-2 text-muted-foreground">
              Last month&apos;s winner: <span className="font-medium">{lastDraw.winner.displayName}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>End-of-season prizes</CardTitle>
          <CardDescription>
            Grand prize for #1 on the season-long global leaderboard, plus separate 2nd and 3rd
            place prizes. Ties broken by Perfect XI count, then earliest account creation date.
          </CardDescription>
        </CardHeader>
      </Card>

      <div>
        <h2 className="mb-2 text-lg font-semibold text-muted-foreground">Coming soon</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <ComingSoonCard
            title="Tiered global prize pools"
            description="Paid entry tiers (₦1,000 / ₦10,000 / ₦100,000) with their own prize pools and leaderboards."
          />
          <ComingSoonCard
            title="Paid private leagues"
            description="Entry fees and prize pools for private leagues, once licensing is confirmed."
          />
        </div>
      </div>
    </div>
  );
}
