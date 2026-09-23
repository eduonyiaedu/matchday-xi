import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Footer } from "@/components/layout/footer";
import { LocalTime } from "@/components/ui/local-time";
import { ConfirmSeasonPrizesButton } from "@/components/admin/confirm-season-prizes-button";
import { EmailSeasonExportButton } from "@/components/admin/email-season-export-button";
import { getPrizeSeason, provisionalPodium } from "@/lib/season-prizes";
import { monthLabel, ordinal } from "@/lib/prize-notify";

function calendarDay(d: Date) {
  return d.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
}

/** Who won what, with contact details, so the founder can arrange prizes — and where the season's
 * 1st/2nd/3rd get confirmed once the season is over. */
export default async function AdminPrizesPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/fixtures");

  const [draws, season, allSeasons] = await Promise.all([
    prisma.monthlyPrizeDraw.findMany({
      where: { drawnAt: { not: null } },
      orderBy: { month: "desc" },
      include: { winner: { select: { displayName: true, username: true, email: true } } },
    }),
    getPrizeSeason(),
    prisma.season.findMany({ orderBy: { startDate: "desc" }, select: { label: true, endDate: true, exportEmailedAt: true } }),
  ]);
  const confirmed = season
    ? await prisma.seasonPrize.findMany({
        where: { competitionId: season.competitionId, season: season.label },
        orderBy: { place: "asc" },
        include: { user: { select: { displayName: true, username: true, email: true } } },
      })
    : [];
  const provisional = season && confirmed.length === 0 ? await provisionalPodium(season) : [];

  return (
    <div className="flex min-h-svh flex-col">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4">
        <div>
          <Link href="/admin" className="text-sm text-muted-foreground hover:underline">
            ← Back to admin
          </Link>
          <h1 className="text-2xl font-bold">Prizes</h1>
          <p className="text-sm text-muted-foreground">
            Winners and their contact details, for arranging prizes. Winners are notified
            automatically (push + a banner on their Home screen), and every player is told who won.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {season ? `${season.label} season — 1st, 2nd and 3rd` : "Season prizes"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {!season && <p className="text-muted-foreground">Season dates aren&apos;t known yet — the standings sync records them.</p>}

            {confirmed.length > 0 && (
              <>
                <p className="text-muted-foreground">
                  Confirmed <LocalTime iso={confirmed[0].confirmedAt.toISOString()} dateOnly /> ·{" "}
                  {confirmed[0].notifiedAt ? "winners and players notified" : "not notified yet"}
                </p>
                {confirmed.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0">
                    <div>
                      <p className="font-medium">
                        {ordinal(p.place)} · {p.user.displayName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        @{p.user.username} · {p.user.email}
                      </p>
                    </div>
                    <Badge variant="secondary">
                      {p.totalPoints} pts · {p.perfectXiCount} Perfect XI
                    </Badge>
                  </div>
                ))}
              </>
            )}

            {season && confirmed.length === 0 && (
              <>
                <p className="text-muted-foreground">
                  {season.ended
                    ? "The season is over. Check the top 3 below, then confirm to lock them in and announce them."
                    : `Live standings — these can change until the season ends on ${calendarDay(season.endDate)}. You can confirm the winners from the next day.`}{" "}
                  Ranked on points scored in this season only. Duplicate-flagged and deleted
                  accounts are left out automatically.
                </p>
                {provisional.length === 0 && <p className="text-muted-foreground">Nobody has scored any points yet.</p>}
                {provisional.map((u, i) => (
                  <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0">
                    <div>
                      <p className="font-medium">
                        {ordinal(i + 1)} · {u.displayName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        @{u.username} · {u.email}
                      </p>
                    </div>
                    <Badge variant="secondary">
                      {u.totalPoints} pts · {u.perfectXiCount} Perfect XI
                    </Badge>
                  </div>
                ))}
                {season.ended && provisional.length > 0 && <ConfirmSeasonPrizesButton season={season.label} />}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Season data exports</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              Everything gathered in a season, in one Excel workbook: traction metrics, the final
              leaderboard, every prediction and score, fixtures and lineups, private leagues,
              prize winners and the players list. Emailed to you automatically when you confirm a
              season&apos;s winners; download it any time here (always built from the latest data).
            </p>
            {allSeasons.length === 0 && <p className="text-muted-foreground">No seasons recorded yet.</p>}
            {allSeasons.map((s, i) => (
              <div key={s.label} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0">
                <div>
                  <p className="font-medium">
                    {s.label} season{i === 0 ? " (current — data so far)" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.exportEmailedAt ? (
                      <>
                        Emailed to you <LocalTime iso={s.exportEmailedAt.toISOString()} dateOnly />
                      </>
                    ) : (
                      "Not emailed yet — sent automatically when this season's winners are confirmed"
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <EmailSeasonExportButton season={s.label} />
                  <a
                    href={`/api/admin/season-export?season=${encodeURIComponent(s.label)}`}
                    className="rounded-lg px-3 py-1.5 font-heading text-xs tracking-[0.1em] uppercase ring-1 ring-white/12 hover:bg-white/5"
                  >
                    Download Excel
                  </a>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly prize draws</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {draws.length === 0 && (
              <p className="text-muted-foreground">
                No draws yet. Each month&apos;s draw runs automatically on the 1st of the next month.
              </p>
            )}
            {draws.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0">
                <div>
                  <p className="font-medium">{monthLabel(d.month)}</p>
                  {d.winner ? (
                    <p className="text-xs text-muted-foreground">
                      {d.winner.displayName} · @{d.winner.username} · {d.winner.email}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">No eligible players that month — no winner.</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{d.eligibleCount} eligible</Badge>
                  {d.winner && (
                    <Badge variant={d.winnerNotifiedAt ? "secondary" : "destructive"}>
                      {d.winnerNotifiedAt ? "Notified" : "Not notified"}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Footer />
    </div>
  );
}
