import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getAdminMetrics } from "@/lib/admin-metrics";
import { addMetricSheets } from "@/lib/exports/xlsx-export";
import { computeLeagueStandings } from "@/lib/rank";
import { seasonPredictionFilter, seasonStandings, type SeasonInfo } from "@/lib/seasons";
import { REAL_FIXTURES_ONLY } from "@/lib/real-fixture";
import { sendSeasonExportEmail } from "@/lib/notify";

const DAY_MS = 24 * 60 * 60 * 1000;
const DELETED_EMAIL_SUFFIX = "@deleted.matchday-xi.app";

const iso = (d: Date | null | undefined) => (d ? d.toISOString().replace("T", " ").slice(0, 16) : "");
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

function addTable(workbook: ExcelJS.Workbook, name: string, columns: { header: string; width?: number }[], rows: (string | number | null)[][]) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map((c) => ({ header: c.header, width: c.width ?? 16 }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  for (const row of rows) sheet.addRow(row.map((v) => v ?? ""));
  if (rows.length === 0) sheet.addRow(["(none)"]);
}

/**
 * Everything the app gathered during one season, as one Excel workbook (founder's request,
 * 2026-09-23): an overview, every traction metric for the season's dates, and the raw data —
 * final leaderboard, every prediction with its picks and score, fixtures with scores and official
 * lineups, private leagues and their standings, prize winners, and the players list. Built on
 * demand (never stored), so a download always reflects the latest data.
 */
export async function buildSeasonExport(season: SeasonInfo): Promise<Buffer> {
  const seasonEndExclusive = new Date(season.endDate.getTime() + DAY_MS);
  const range = { from: season.startDate, to: new Date(seasonEndExclusive.getTime() - 1) };

  const [metrics, standings, teams, fixtures, predictions, leagues, draws, seasonPrizes, users] = await Promise.all([
    getAdminMetrics(range),
    seasonStandings(season),
    prisma.team.findMany({ select: { id: true, name: true } }),
    prisma.fixture.findMany({
      where: { ...REAL_FIXTURES_ONLY, kickoffAt: { gte: season.startDate, lt: seasonEndExclusive } },
      orderBy: { kickoffAt: "asc" },
      include: {
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
        officialLineups: { include: { players: { include: { squadPlayer: { select: { name: true } } } } } },
      },
    }),
    prisma.prediction.findMany({
      where: { ...seasonPredictionFilter(season), privateLeagueId: undefined },
      orderBy: [{ fixture: { kickoffAt: "asc" } }, { submittedAt: "asc" }],
      include: {
        user: { select: { displayName: true, username: true } },
        fixture: { select: { kickoffAt: true, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } } },
        privateLeague: { select: { name: true } },
        slots: { orderBy: { slotIndex: "asc" }, include: { squadPlayer: { select: { name: true } } } },
      },
    }),
    prisma.privateLeague.findMany({
      where: { startDate: { lt: seasonEndExclusive }, endDate: { gte: season.startDate } },
      orderBy: { createdAt: "asc" },
      include: { creator: { select: { displayName: true, username: true } }, restrictedTeam: { select: { name: true } } },
    }),
    prisma.monthlyPrizeDraw.findMany({
      where: { drawnAt: { not: null }, month: { gte: season.startDate.toISOString().slice(0, 7), lte: season.endDate.toISOString().slice(0, 7) } },
      orderBy: { month: "asc" },
      include: { winner: { select: { displayName: true, username: true, email: true } } },
    }),
    prisma.seasonPrize.findMany({
      where: { competitionId: season.competitionId, season: season.label },
      orderBy: { place: "asc" },
      include: { user: { select: { displayName: true, username: true, email: true } } },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      include: { favoriteTeam: { select: { name: true } } },
    }),
  ]);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Matchday XI";
  workbook.created = new Date();

  // ---- Overview ----
  const overview = workbook.addWorksheet("Overview");
  overview.getColumn(1).width = 34;
  overview.getColumn(2).width = 40;
  const overviewRows: [string, string | number][] = [
    ["Matchday XI — season export", ""],
    ["Season", season.label],
    ["Dates", `${day(season.startDate)} to ${day(season.endDate)}`],
    ["Generated", iso(new Date()) + " UTC"],
    ["", ""],
    ["Players on the final leaderboard", standings.length],
    ["Fixtures", fixtures.length],
    ["Predictions (global + private league)", predictions.length],
    ["Private leagues", leagues.length],
    ["Monthly prize draws", draws.length],
    ["", ""],
    ["Season winners", seasonPrizes.length > 0 ? "" : "Not confirmed yet"],
    ...seasonPrizes.map((p): [string, string] => [`${["1st", "2nd", "3rd"][p.place - 1] ?? `${p.place}th`}`, `${p.user.displayName} (@${p.user.username}) — ${p.totalPoints} pts`]),
  ];
  overviewRows.forEach(([a, b], i) => {
    overview.getCell(i + 1, 1).value = a;
    overview.getCell(i + 1, 2).value = b;
  });
  overview.getCell(1, 1).font = { bold: true, size: 16 };

  // ---- Metrics (same sheets as the traction-metrics Excel export, for the season's dates) ----
  await addMetricSheets(workbook, metrics);

  // ---- Raw data ----
  addTable(
    workbook,
    "Final leaderboard",
    [{ header: "Rank", width: 8 }, { header: "Name", width: 24 }, { header: "Username", width: 20 }, { header: "Email", width: 32 }, { header: "Club" , width: 24 }, { header: "Points", width: 10 }, { header: "Perfect XIs", width: 12 }, { header: "Flagged duplicate", width: 16 }, { header: "Deleted account", width: 16 }],
    standings.map((s, i) => [i + 1, s.displayName, s.username, s.isDeleted ? "" : s.email, teamName.get(s.teamId) ?? "", s.totalPoints, s.perfectXiCount, s.isFlaggedDuplicate ? "Yes" : "", s.isDeleted ? "Yes" : ""]),
  );

  addTable(
    workbook,
    "Predictions",
    [{ header: "Kickoff (UTC)", width: 18 }, { header: "Fixture", width: 36 }, { header: "Player", width: 24 }, { header: "Username", width: 20 }, { header: "Predicted for", width: 22 }, { header: "Scope", width: 22 }, { header: "Formation", width: 10 }, { header: "Submitted (UTC)", width: 18 }, { header: "Points", width: 8 }, { header: "Correct picks", width: 12 }, { header: "Perfect XI", width: 10 }, { header: "Picks", width: 90 }],
    predictions.map((p) => [
      iso(p.fixture.kickoffAt),
      `${p.fixture.homeTeam.name} v ${p.fixture.awayTeam.name}`,
      p.user.displayName,
      p.user.username,
      teamName.get(p.teamId) ?? "",
      p.privateLeague ? `League: ${p.privateLeague.name}` : "Global",
      p.formation,
      iso(p.submittedAt),
      p.pointsAwarded,
      p.pointsAwarded === null ? null : p.slots.filter((s) => s.isCorrect).length,
      p.isPerfectXi ? "Yes" : "",
      p.slots.map((s) => s.squadPlayer.name).join(", "),
    ]),
  );

  addTable(
    workbook,
    "Fixtures & lineups",
    [{ header: "Kickoff (UTC)", width: 18 }, { header: "Home", width: 24 }, { header: "Away", width: 24 }, { header: "Score", width: 8 }, { header: "Status", width: 18 }, { header: "Home XI", width: 90 }, { header: "Away XI", width: 90 }, { header: "Lineup source", width: 14 }],
    fixtures.map((f) => {
      const xi = (teamId: string) =>
        f.officialLineups.find((l) => l.teamId === teamId)?.players.map((p) => p.squadPlayer?.name ?? p.rawName).join(", ") ?? "";
      return [
        iso(f.kickoffAt),
        f.homeTeam.name,
        f.awayTeam.name,
        f.homeScore !== null && f.awayScore !== null ? `${f.homeScore}-${f.awayScore}` : "",
        f.status,
        xi(f.homeTeamId),
        xi(f.awayTeamId),
        [...new Set(f.officialLineups.map((l) => l.source))].join(" / "),
      ];
    }),
  );

  addTable(
    workbook,
    "Private leagues",
    [{ header: "League", width: 28 }, { header: "Creator", width: 24 }, { header: "Team rule", width: 26 }, { header: "Start", width: 12 }, { header: "End", width: 12 }, { header: "Created (UTC)", width: 18 }],
    leagues.map((l) => [l.name, `${l.creator.displayName} (@${l.creator.username})`, l.teamRule === "SINGLE_TEAM" ? `Only ${l.restrictedTeam?.name ?? "one club"}` : "Any club", day(l.startDate), day(l.endDate), iso(l.createdAt)]),
  );

  const userById = new Map(users.map((u) => [u.id, u]));
  const leagueRows: (string | number)[][] = [];
  for (const league of leagues) {
    const table = await computeLeagueStandings(league.id);
    table.forEach((row, i) => {
      const u = userById.get(row.userId);
      leagueRows.push([league.name, i + 1, u?.displayName ?? "", u?.username ?? "", row.points, row.perfectXiCount]);
    });
  }
  addTable(
    workbook,
    "League standings",
    [{ header: "League", width: 28 }, { header: "Rank", width: 8 }, { header: "Player", width: 24 }, { header: "Username", width: 20 }, { header: "Points", width: 10 }, { header: "Perfect XIs", width: 12 }],
    leagueRows,
  );

  addTable(
    workbook,
    "Prize winners",
    [{ header: "Prize", width: 22 }, { header: "Winner", width: 24 }, { header: "Username", width: 20 }, { header: "Email", width: 32 }, { header: "Details", width: 30 }],
    [
      ...draws.map((d) => [`Monthly draw ${d.month}`, d.winner?.displayName ?? "No eligible players", d.winner?.username ?? "", d.winner?.email ?? "", `${d.eligibleCount} eligible`]),
      ...seasonPrizes.map((p) => [`Season ${["1st", "2nd", "3rd"][p.place - 1] ?? `${p.place}th`}`, p.user.displayName, p.user.username, p.user.email, `${p.totalPoints} pts · ${p.perfectXiCount} Perfect XI`]),
    ],
  );

  addTable(
    workbook,
    "Players",
    [{ header: "Name", width: 24 }, { header: "Username", width: 20 }, { header: "Email", width: 32 }, { header: "Club", width: 24 }, { header: "Joined (UTC)", width: 18 }, { header: "Last login", width: 12 }, { header: "Current streak", width: 14 }, { header: "Longest streak", width: 14 }, { header: "Flagged duplicate", width: 16 }, { header: "Account status", width: 22 }],
    users.map((u) => {
      const deleted = u.email.endsWith(DELETED_EMAIL_SUFFIX);
      return [
        u.displayName,
        u.username,
        deleted ? "" : u.email,
        u.favoriteTeam?.name ?? "(not picked)",
        iso(u.createdAt),
        day(u.lastLoginDate),
        u.currentStreak,
        u.longestStreak,
        u.isFlaggedDuplicate ? "Yes" : "",
        deleted ? "Deleted" : u.deletionScheduledAt ? `Deletion pending (${day(u.deletionScheduledAt)})` : "Active",
      ];
    }),
  );

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export function seasonExportFilename(season: SeasonInfo) {
  return `matchday-xi-season-${season.label}.xlsx`;
}

/** An export-email claim older than this that never finished (function killed mid-build) can be retaken. */
const STALE_EXPORT_CLAIM_MS = 10 * 60 * 1000;

/**
 * Emails the season export to the founder: automatically once per season after its prizes are
 * confirmed, or on demand from /admin/prizes (`resend`). Claimed atomically on
 * Season.exportEmailClaimedAt, and exportEmailedAt is only set once the send has actually gone —
 * so /admin/prizes never shows "Emailed" for an email that died with its function, and a stale
 * claim (a killed run) can be retaken. A failed send releases the claim. Never blocks or undoes
 * the prize confirmation itself.
 */
export async function emailSeasonExportIfNeeded(season: SeasonInfo, opts: { resend?: boolean } = {}): Promise<boolean> {
  const { count } = await prisma.season.updateMany({
    where: {
      id: season.id,
      ...(opts.resend ? {} : { exportEmailedAt: null }),
      OR: [
        { exportEmailClaimedAt: null },
        { exportEmailClaimedAt: { lt: new Date(Date.now() - STALE_EXPORT_CLAIM_MS) } },
      ],
    },
    data: { exportEmailClaimedAt: new Date() },
  });
  if (count === 0) return false;
  try {
    const file = await buildSeasonExport(season);
    const sent = await sendSeasonExportEmail({ seasonLabel: season.label, filename: seasonExportFilename(season), file });
    if (!sent) throw new Error("send failed");
    await prisma.season.update({
      where: { id: season.id },
      data: { exportEmailedAt: new Date(), exportEmailClaimedAt: null },
    });
    return true;
  } catch (error) {
    console.error(`[season-export] ${season.label} export email failed:`, error);
    await prisma.season.update({ where: { id: season.id }, data: { exportEmailClaimedAt: null } });
    return false;
  }
}
