import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeLiveMonthlyProgress } from "@/lib/prizes";
import { recordDailyLoginIfNeeded } from "@/lib/streaks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ComingSoonCard } from "@/components/prizes/coming-soon-card";
import { RanksTabs } from "@/components/leaderboard/ranks-tabs";

export default async function PrizesPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) return null;

  // On the first request of a new UTC day, `user` (cached for this request) still holds
  // yesterday's streak — same staleness the nav badge had. recordDailyLoginIfNeeded returns the
  // up-to-date value, and repeating the layout's own call within one request is harmless: both
  // work from the same snapshot and write the same values.
  const currentStreak = await recordDailyLoginIfNeeded(user);
  const longestStreak = Math.max(user.longestStreak, currentStreak);

  const progress = user.favoriteTeamId
    ? await computeLiveMonthlyProgress(user.id, user.favoriteTeamId)
    : null;
  const lastDraw = await prisma.monthlyPrizeDraw.findFirst({
    where: { drawnAt: { not: null } },
    orderBy: { month: "desc" },
    include: { winner: { select: { displayName: true } } },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold uppercase">Ranks</h1>
        <RanksTabs active="prizes" />
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
          <Badge className="text-base">🔥 {currentStreak} day streak</Badge>
          <Badge variant="secondary">Best: {longestStreak}</Badge>
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
          {progress ? (
            <>
              <p>Predicted every matchday so far: {progress.predictedEveryMatchdaySoFar ? "✅" : "❌"}</p>
              <p>Logged in every day so far: {progress.loggedInEveryDaySoFar ? "✅" : "❌"}</p>
            </>
          ) : (
            <p className="text-muted-foreground">Pick a favorite team to track your eligibility.</p>
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
