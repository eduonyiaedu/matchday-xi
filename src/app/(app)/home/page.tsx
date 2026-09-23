import Link from "next/link";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import { TierDisc, tierFromPerfectXiCount } from "@/components/leaderboard/tier-disc";
import { HomeAvatar } from "@/components/home/home-avatar";
import { NewSeasonClubPrompt } from "@/components/home/new-season-club-prompt";
import { listSeasons } from "@/lib/seasons";
import { HeroPitchLines } from "@/components/home/hero-pitch-lines";
import { LogoutButton } from "@/components/layout/logout-button";
import { PushOptIn } from "@/components/push/push-opt-in";
import { PrizeWinBanner, type PrizeWin } from "@/components/prizes/prize-win-banner";
import { monthLabel, ordinal } from "@/lib/prize-notify";
import { computeGlobalRank, computeLeagueStandings } from "@/lib/rank";
import { getNextEligibleFixture, isPredictionWindowOpen, predictionOpensAt } from "@/lib/next-fixture";
import { getTeamColors } from "@/lib/team-colors";
import { scopeKeyFor } from "@/lib/prediction-scope";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

export default async function HomePage() {
  const authedUser = await getOrCreateCurrentUser();
  if (!authedUser?.favoriteTeamId) return null; // (app) layout already redirects, this satisfies TS
  const favoriteTeamId = authedUser.favoriteTeamId;

  const [user, predictionCount, seasons] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: authedUser.id }, include: { favoriteTeam: true } }),
    prisma.prediction.count({ where: { userId: authedUser.id, privateLeagueId: null } }),
    listSeasons(),
  ]);
  const isNewUser = user.totalPoints === 0 && predictionCount === 0;
  const colors = getTeamColors(user.favoriteTeam!.externalId);

  // New-season club question (lib/new-season.ts): only after a real rollover (a season before this
  // one exists), only for players who joined before it began, until they answer or predict.
  const currentSeason = seasons[0];
  const askSeasonClub =
    seasons.length > 1 &&
    !!currentSeason &&
    user.createdAt < currentSeason.startDate &&
    !user.favoriteTeamLockedAt &&
    user.seasonClubConfirmedFor !== currentSeason.label;

  const switchableTeams = user.favoriteTeamLockedAt
    ? []
    : await prisma.team.findMany({
        where: { isPremierLeagueClub: true, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, shortName: true, crestUrl: true, externalId: true },
      });

  const [globalRank, teamRank, memberships, nextFixture] = await Promise.all([
    computeGlobalRank(user),
    computeGlobalRank(user, favoriteTeamId),
    prisma.privateLeagueMembership.findMany({
      where: { userId: user.id, status: "APPROVED" },
      include: { league: true, team: true },
    }),
    getNextEligibleFixture(favoriteTeamId),
  ]);

  const leagueStandings = await Promise.all(
    memberships.map(async (m) => {
      const standings = await computeLeagueStandings(m.leagueId);
      const myIndex = standings.findIndex((s) => s.userId === user.id);
      return {
        leagueId: m.leagueId,
        leagueName: m.league.name,
        teamName: m.team?.name ?? "—",
        rank: myIndex === -1 ? standings.length + 1 : myIndex + 1,
        points: myIndex === -1 ? 0 : standings[myIndex].points,
      };
    }),
  );

  const nextFixturePrediction = nextFixture
    ? await prisma.prediction.findUnique({
        where: {
          userId_fixtureId_scopeKey: { userId: user.id, fixtureId: nextFixture.id, scopeKey: scopeKeyFor(null) },
        },
        select: { id: true },
      })
    : null;
  const nextFixtureWindowOpen = nextFixture ? isPredictionWindowOpen(nextFixture) : false;

  // Prizes this user has won but not yet acknowledged — shown until they tap "Got it".
  const [unseenDraws, unseenSeasonPrizes] = await Promise.all([
    prisma.monthlyPrizeDraw.findMany({
      where: { winnerUserId: user.id, drawnAt: { not: null }, winnerSeenAt: null },
      orderBy: { month: "asc" },
      select: { id: true, month: true },
    }),
    prisma.seasonPrize.findMany({
      where: { userId: user.id, seenAt: null },
      orderBy: { confirmedAt: "asc" },
      select: { id: true, season: true, place: true },
    }),
  ]);
  const prizeWins: PrizeWin[] = [
    ...unseenSeasonPrizes.map((p) => ({
      kind: "season" as const,
      id: p.id,
      title: `You finished ${ordinal(p.place)} in the ${p.season} season!`,
    })),
    ...unseenDraws.map((d) => ({ kind: "monthly" as const, id: d.id, title: `You won the ${monthLabel(d.month)} prize draw!` })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-semibold uppercase">
            {greeting()},<br />
            {user.displayName.split(" ")[0]}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            @{user.username} · {user.favoriteTeam?.name}
          </p>
        </div>
        <HomeAvatar
          initials={(user.favoriteTeam?.shortName ?? user.favoriteTeam?.name ?? "").slice(0, 3).toUpperCase()}
          teamName={user.favoriteTeam?.name ?? ""}
          teamId={user.favoriteTeamId}
          lockedAt={user.favoriteTeamLockedAt?.toISOString() ?? null}
          teams={switchableTeams}
        />
      </div>

      <PrizeWinBanner wins={prizeWins} />

      {askSeasonClub && (
        <NewSeasonClubPrompt
          seasonLabel={currentSeason.label}
          teamName={user.favoriteTeam?.name ?? "your club"}
          teamId={favoriteTeamId}
          teams={switchableTeams}
        />
      )}

      <PushOptIn />

      {/* Next-fixture hero */}
      <div>
        {nextFixture && (
          <p className="mb-2 font-heading text-[13px] font-semibold tracking-[0.16em] text-gold uppercase">Next match</p>
        )}
        <Card className="overflow-hidden p-0" style={{ boxShadow: `0 10px 30px rgba(0,0,0,0.45), 0 0 0 1px ${colors.primary}45` }}>
        {nextFixture ? (
          <>
            <div className="relative h-37 turf">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(245,243,236,0.16),rgba(11,31,23,0)_62%)]" />
              <HeroPitchLines />
              <span className="absolute top-3 right-3.5 rounded-full bg-pitch/72 px-2 py-1 font-mono text-[10px] tracking-[0.08em] text-gold">
                {nextFixtureWindowOpen ? (
                  <LocalTime iso={nextFixture.lockAt.toISOString()} />
                ) : (
                  <>
                    Opens <LocalTime iso={predictionOpensAt(nextFixture).toISOString()} />
                  </>
                )}
              </span>
            </div>
            <CardContent className="pt-4 pb-4.5">
              <p className="font-heading text-lg leading-tight font-semibold uppercase">
                {nextFixture.homeTeam.name} <span className="font-normal text-muted-foreground">vs</span>{" "}
                {nextFixture.awayTeam.name}
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {nextFixture.competition.name} · <LocalTime iso={nextFixture.kickoffAt.toISOString()} />
              </p>
              <div className="mt-3.5 flex items-center gap-2.5">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: nextFixturePrediction ? "100%" : "0%",
                      background: `linear-gradient(90deg, var(--club), ${colors.primary})`,
                    }}
                  />
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">{nextFixturePrediction ? "11/11" : "0/11"}</span>
              </div>
              {nextFixtureWindowOpen && (
                <Button asChild size="lg" className="mt-3.5 w-full">
                  <Link href={`/predict/${nextFixture.id}`}>
                    {nextFixturePrediction ? "Edit your lineup" : isNewUser ? "Build your first lineup" : "Build your lineup"}
                  </Link>
                </Button>
              )}
            </CardContent>
          </>
        ) : (
          <CardContent className="py-6 text-center">
            <p className="text-sm text-muted-foreground">No upcoming fixtures synced yet.</p>
          </CardContent>
        )}
        </Card>
      </div>

      {isNewUser ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-xs tracking-[0.16em] text-muted-foreground">How you score</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              <div className="flex items-center gap-3">
                <span className="w-9 font-mono text-[15px] font-bold text-gold">+10</span>
                <span className="text-sm">for every player who actually starts</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-9 font-mono text-[15px] font-bold text-gold">+25</span>
                <span className="text-sm">bonus if you call all eleven</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between pt-4">
              <div>
                <p className="font-heading text-[15px] font-semibold uppercase">Nothing on the shelf yet</p>
                <p className="mt-1 text-[11.5px] text-muted-foreground">One Perfect XI earns Bronze. Five earns Silver.</p>
              </div>
              <TierDisc tier={null} size={30} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">What you&apos;re playing for</CardTitle>
              <p className="text-[11.5px] text-muted-foreground">
                A monthly draw for everyone who predicts every matchday and logs in daily — plus season prizes for the
                top three. Free to enter.
              </p>
            </CardHeader>
          </Card>
        </>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-xs tracking-[0.16em] text-muted-foreground">Global</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <div>
                <p className="font-heading text-3xl leading-none font-semibold text-gold">#{globalRank}</p>
                <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                  {user.totalPoints} PTS · {user.perfectXiCount} PERFECT XI
                </p>
              </div>
              <TierDisc tier={tierFromPerfectXiCount(user.perfectXiCount)} size={26} />
            </CardContent>
          </Card>

          <Card style={{ boxShadow: `inset 0 0 0 1px ${colors.primary}40` }}>
            <CardHeader>
              <CardTitle className="text-xs tracking-[0.16em] text-muted-foreground">{user.favoriteTeam?.name} fans</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-heading text-3xl leading-none font-semibold" style={{ color: colors.primary }}>
                #{teamRank}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center justify-between pt-4">
              <div className="flex items-center gap-3">
                <div className="flex size-9.5 items-center justify-center rounded-full bg-gold/12">🔥</div>
                <div>
                  <p className="font-heading text-base font-medium uppercase">{user.currentStreak} day streak</p>
                  <p className="text-[11px] text-muted-foreground">Log in daily to keep it eligible for the monthly draw</p>
                </div>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">{user.longestStreak} BEST</span>
            </CardContent>
          </Card>
        </>
      )}

      {leagueStandings.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-heading text-[13px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Your leagues
            </span>
            <Link href="/leagues" className="text-[11px] text-gold">
              See all
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {leagueStandings.map((l) => (
              <Link key={l.leagueId} href={`/leagues/${l.leagueId}`}>
                <Card>
                  <CardContent className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-heading text-[15px] font-medium uppercase">{l.leagueName}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">Predicting for {l.teamName}</p>
                    </div>
                    <span className="font-heading text-lg font-semibold text-gold">#{l.rank}</span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      <Button asChild variant="outline" className="w-full">
        <Link href="/profile">Profile</Link>
      </Button>
      <LogoutButton className="w-full" />
    </div>
  );
}
