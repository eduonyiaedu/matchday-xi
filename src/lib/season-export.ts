import { PassThrough } from "node:stream";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getAdminMetricsCached } from "@/lib/admin-metrics";
import { addMetricSheets } from "@/lib/exports/xlsx-export";
import { computeLeagueStandings } from "@/lib/rank";
import { listSeasons, seasonStandings, type SeasonInfo } from "@/lib/seasons";
import { REAL_FIXTURES_ONLY } from "@/lib/real-fixture";
import { sendSeasonExportEmail } from "@/lib/notify";
import { listFolders, removeFolder, signedDownloadUrl, uploadFile } from "@/lib/storage";

const DAY_MS = 24 * 60 * 60 * 1000;
const DELETED_EMAIL_SUFFIX = "@deleted.matchday-xi.app";
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Rows per Predictions file. Well under Excel's hard limit of 1,048,576 rows a sheet, and small
 * enough for one file to be written within a single run.
 */
const PREDICTIONS_PER_FILE = 200_000;
/** Predictions read from the database at a time while writing a file. */
const PAGE_SIZE = 2_000;
/** A build run's claim older than this (the run was killed) can be retaken. */
const STALE_CLAIM_MS = 5 * 60 * 1000;
/** Runs in a row that may take a build and get killed without progress before it's marked FAILED. */
const MAX_ATTEMPTS_WITHOUT_PROGRESS = 3;
/** An email claim older than this that never finished can be retaken. */
const STALE_EMAIL_CLAIM_MS = 10 * 60 * 1000;

export interface ExportFile {
  path: string;
  label: string;
}

interface ExportCursor {
  requestId: string;
  step: "main" | "predictions";
  part: number;
  afterKickoff: string | null;
  afterId: string | null;
  files: ExportFile[];
}

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

function seasonFixtureWindow(season: SeasonInfo) {
  return { ...REAL_FIXTURES_ONLY, kickoffAt: { gte: season.startDate, lt: new Date(season.endDate.getTime() + DAY_MS) } };
}

/**
 * The season's main workbook (founder's request, 2026-09-23): an overview, every traction metric
 * for the season's dates, the final leaderboard, fixtures with scores and official lineups,
 * private leagues and their standings, prize winners, and the players list. Every prediction is in
 * the separate Predictions file(s) — at scale they're far too many rows for one workbook.
 */
async function buildMainWorkbook(season: SeasonInfo): Promise<Buffer> {
  const seasonEndExclusive = new Date(season.endDate.getTime() + DAY_MS);
  const range = { from: season.startDate, to: new Date(seasonEndExclusive.getTime() - 1) };

  const [{ sections: metrics }, standings, teams, fixtures, predictionCount, leagues, draws, seasonPrizes, users] = await Promise.all([
    getAdminMetricsCached(range),
    seasonStandings(season),
    prisma.team.findMany({ select: { id: true, name: true } }),
    prisma.fixture.findMany({
      where: seasonFixtureWindow(season),
      orderBy: { kickoffAt: "asc" },
      include: {
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
        officialLineups: { include: { players: { include: { squadPlayer: { select: { name: true } } } } } },
      },
    }),
    prisma.prediction.count({ where: { fixture: seasonFixtureWindow(season) } }),
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
  overview.getColumn(2).width = 44;
  const overviewRows: [string, string | number][] = [
    ["Matchday XI — season export", ""],
    ["Season", season.label],
    ["Dates", `${day(season.startDate)} to ${day(season.endDate)}`],
    ["Generated", iso(new Date()) + " UTC"],
    ["", ""],
    ["Players on the final leaderboard", standings.length],
    ["Fixtures", fixtures.length],
    ["Predictions (global + private league)", predictionCount],
    ["", "Every prediction is in the separate Predictions file(s)"],
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

const PREDICTION_COLUMNS = [
  { header: "Kickoff (UTC)", width: 18 },
  { header: "Fixture", width: 36 },
  { header: "Player", width: 24 },
  { header: "Username", width: 20 },
  { header: "Predicted for", width: 22 },
  { header: "Scope", width: 22 },
  { header: "Formation", width: 10 },
  { header: "Submitted (UTC)", width: 18 },
  { header: "Points", width: 8 },
  { header: "Correct picks", width: 12 },
  { header: "Perfect XI", width: 10 },
  { header: "Picks", width: 90 },
];

/**
 * Writes one Predictions file, streaming rows out as they're read (a page at a time, in kickoff
 * order) so memory stays flat however many predictions there are. Stops at `rowsPerFile` rows
 * or at `deadline`, whichever comes first, and says where the next file should carry on.
 */
async function writePredictionsFile(season: SeasonInfo, cursor: ExportCursor, deadline: number, rowsPerFile: number) {
  const teams = await prisma.team.findMany({ select: { id: true, name: true } });
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  const ended = new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true });
  const sheet = workbook.addWorksheet("Predictions", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = PREDICTION_COLUMNS.map((c) => ({ header: c.header, width: c.width }));

  let afterKickoff = cursor.afterKickoff ? new Date(cursor.afterKickoff) : null;
  let afterId = cursor.afterId;
  let rows = 0;
  let finished = false;
  while (rows < rowsPerFile && Date.now() < deadline) {
    const take = Math.min(PAGE_SIZE, rowsPerFile - rows);
    const seasonWhere = { fixture: seasonFixtureWindow(season) };
    const page = await prisma.prediction.findMany({
      where:
        afterKickoff && afterId
          ? {
              AND: [
                seasonWhere,
                { OR: [{ fixture: { kickoffAt: { gt: afterKickoff } } }, { fixture: { kickoffAt: afterKickoff }, id: { gt: afterId } }] },
              ],
            }
          : seasonWhere,
      orderBy: [{ fixture: { kickoffAt: "asc" } }, { id: "asc" }],
      take,
      include: {
        user: { select: { displayName: true, username: true } },
        fixture: { select: { kickoffAt: true, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } } },
        privateLeague: { select: { name: true } },
        slots: { orderBy: { slotIndex: "asc" }, include: { squadPlayer: { select: { name: true } } } },
      },
    });
    for (const p of page) {
      sheet
        .addRow([
          iso(p.fixture.kickoffAt),
          `${p.fixture.homeTeam.name} v ${p.fixture.awayTeam.name}`,
          p.user.displayName,
          p.user.username,
          teamName.get(p.teamId) ?? "",
          p.privateLeague ? `League: ${p.privateLeague.name}` : "Global",
          p.formation,
          iso(p.submittedAt),
          p.pointsAwarded ?? "",
          p.pointsAwarded === null ? "" : p.slots.filter((s) => s.isCorrect).length,
          p.isPerfectXi ? "Yes" : "",
          p.slots.map((s) => s.squadPlayer.name).join(", "),
        ])
        .commit();
    }
    rows += page.length;
    if (page.length > 0) {
      afterKickoff = page[page.length - 1].fixture.kickoffAt;
      afterId = page[page.length - 1].id;
    }
    if (page.length < take) {
      finished = true;
      break;
    }
  }
  if (rows === 0 && cursor.part === 1) sheet.addRow(["(none)"]).commit();
  sheet.commit();
  await workbook.commit();
  await ended;

  return {
    file: Buffer.concat(chunks),
    rows,
    finished,
    next: { afterKickoff: afterKickoff?.toISOString() ?? null, afterId },
  };
}

async function seasonInfoById(seasonId: string): Promise<SeasonInfo> {
  const season = (await listSeasons()).find((s) => s.id === seasonId);
  if (!season) throw new Error(`Season ${seasonId} not found`);
  return season;
}

/**
 * Starts (or restarts) building a season's export. The build itself runs in the background, in
 * pieces (advanceSeasonExports). Returns false if a build is already under way — `email` is then
 * just added to it. The previous build's files stay downloadable until the new one finishes.
 */
export async function requestSeasonExport(season: SeasonInfo, opts: { email: boolean }): Promise<boolean> {
  const cursor: ExportCursor = {
    requestId: new Date().toISOString().replace(/[:.]/g, "-"),
    step: "main",
    part: 1,
    afterKickoff: null,
    afterId: null,
    files: [],
  };
  const { count } = await prisma.season.updateMany({
    where: { id: season.id, OR: [{ exportStatus: null }, { exportStatus: { notIn: ["QUEUED", "RUNNING"] } }] },
    data: {
      exportStatus: "QUEUED",
      exportRequestedAt: new Date(),
      exportError: null,
      exportCursor: JSON.parse(JSON.stringify(cursor)),
      exportClaimedAt: null,
      exportAttempts: 0,
      exportEmailWanted: opts.email,
    },
  });
  if (count === 0 && opts.email) {
    await prisma.season.update({ where: { id: season.id }, data: { exportEmailWanted: true } });
  }
  return count > 0;
}

/**
 * Works on any queued/running export builds for up to `budgetMs`, a piece at a time: first the
 * main workbook, then the Predictions files, each uploaded to storage as soon as it's written and
 * the progress saved — so a build of any size finishes across several runs (the 5-minute sweep
 * always runs one) rather than having to fit in one. Claimed per season, so two runs never work
 * on the same build. When a build finishes, the previous build's files are deleted and, if asked,
 * the download links are emailed.
 */
/** Seasons with export work outstanding: a build in progress, or finished links still to email. */
export const SEASON_EXPORT_PENDING = {
  OR: [{ exportStatus: { in: ["QUEUED", "RUNNING"] } }, { exportStatus: "READY", exportEmailWanted: true }],
};

export async function advanceSeasonExports(budgetMs = 40_000, opts: { rowsPerFile?: number } = {}) {
  const rowsPerFile = opts.rowsPerFile ?? PREDICTIONS_PER_FILE;
  const runStart = Date.now();
  const deadline = runStart + budgetMs;
  const pending = await prisma.season.findMany({ where: SEASON_EXPORT_PENDING, select: { id: true, exportStatus: true } });
  const results: { season: string; status: string; files: number }[] = [];

  for (const { id, exportStatus } of pending) {
    if (Date.now() > deadline - 10_000) break;

    // A finished build whose links email didn't go out (e.g. a brief Resend outage) — retry it
    // here rather than leaving the founder waiting on an email that will never come.
    if (exportStatus === "READY") {
      const season = await seasonInfoById(id);
      const sent = await emailSeasonExportLinks(season);
      results.push({ season: season.label, status: sent ? "links emailed" : "failed: links email not sent", files: 0 });
      continue;
    }

    const { count } = await prisma.season.updateMany({
      where: {
        id,
        exportStatus: { in: ["QUEUED", "RUNNING"] },
        OR: [{ exportClaimedAt: null }, { exportClaimedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } }],
      },
      data: { exportClaimedAt: new Date(), exportStatus: "RUNNING", exportAttempts: { increment: 1 } },
    });
    if (count === 0) continue;

    const season = await seasonInfoById(id);
    try {
      let row = await prisma.season.findUniqueOrThrow({ where: { id } });
      // Each run that takes the build and gets killed before saving any progress counts once
      // (saving progress resets it) — so a build that can never fit in a run fails visibly and
      // can be rebuilt, instead of being retried every 5 minutes forever.
      if (row.exportAttempts > MAX_ATTEMPTS_WITHOUT_PROGRESS) {
        throw new Error(
          `Stopped after ${MAX_ATTEMPTS_WITHOUT_PROGRESS} runs in a row ran out of time without finishing a single file — the season's data may be too big to build on the current plan.`,
        );
      }
      let cursor = row.exportCursor as unknown as ExportCursor;
      let finished = false;
      const folder = `seasons/${season.label}/${cursor.requestId}`;

      while (!finished && Date.now() < deadline - 10_000) {
        if (cursor.step === "main") {
          // The main workbook is one piece that can't be split — only start it at the beginning
          // of a run, with the whole time budget ahead of it.
          if (Date.now() - runStart > 5_000) break;
          const path = `${folder}/1-main.xlsx`;
          await uploadFile(path, await buildMainWorkbook(season), XLSX_TYPE);
          cursor = { ...cursor, step: "predictions", files: [...cursor.files, { path, label: "Main workbook" }] };
        } else {
          const part = await writePredictionsFile(season, cursor, deadline - 8_000, rowsPerFile);
          const files = [...cursor.files];
          if (part.rows > 0 || cursor.part === 1) {
            const path = `${folder}/2-predictions-${String(cursor.part).padStart(3, "0")}.xlsx`;
            await uploadFile(path, part.file, XLSX_TYPE);
            files.push({ path, label: `Predictions, file ${cursor.part}` });
          }
          cursor = { ...cursor, part: cursor.part + 1, afterKickoff: part.next.afterKickoff, afterId: part.next.afterId, files };
          finished = part.finished;
        }
        await prisma.season.update({
          where: { id },
          data: { exportCursor: JSON.parse(JSON.stringify(cursor)), exportClaimedAt: new Date(), exportAttempts: 0 },
        });
      }

      if (!finished) {
        // Out of time for this run — release the claim; the next run carries on from the cursor.
        // (A run that stopped cleanly without progress, e.g. too late to start the main workbook,
        // didn't get killed — don't count it.)
        await prisma.season.update({ where: { id }, data: { exportClaimedAt: null, exportAttempts: 0 } });
        results.push({ season: season.label, status: "in progress", files: cursor.files.length });
        continue;
      }

      row = await prisma.season.update({
        where: { id },
        data: {
          exportStatus: "READY",
          exportFiles: JSON.parse(JSON.stringify(cursor.files)),
          exportFinishedAt: new Date(),
          exportCursor: Prisma.DbNull,
          exportClaimedAt: null,
          exportAttempts: 0,
        },
      });
      // Earlier builds' files are superseded — delete them from storage.
      for (const old of await listFolders(`seasons/${season.label}`)) {
        if (old !== cursor.requestId) await removeFolder(`seasons/${season.label}/${old}`);
      }
      // If this send fails, exportEmailWanted stays set and the next sweep retries it (above).
      const emailed = row.exportEmailWanted ? await emailSeasonExportLinks(season) : true;
      results.push({ season: season.label, status: emailed ? "ready" : "failed: ready, but the links email wasn't sent", files: cursor.files.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[season-export] ${season.label} build failed:`, error);
      await prisma.season.update({
        where: { id },
        data: { exportStatus: "FAILED", exportError: message.slice(0, 500), exportClaimedAt: null },
      });
      results.push({ season: season.label, status: `failed: ${message}`, files: 0 });
    }
  }
  if (results.some((r) => r.status.startsWith("failed"))) {
    throw new Error(`Season export failed: ${results.map((r) => `${r.season} ${r.status}`).join("; ")}`);
  }
  return results;
}

/** Fresh signed download links for a finished export's files. */
export async function seasonExportLinks(files: ExportFile[], seasonLabel: string) {
  return Promise.all(
    files.map(async (f) => ({
      label: f.label,
      url: await signedDownloadUrl(f.path, { downloadAs: `matchday-xi-${seasonLabel}-${f.path.split("/").pop()}` }),
    })),
  );
}

/**
 * Emails the founder download links to a finished export — automatically when a build requested
 * with `email` finishes, or on demand from /admin/prizes. Claimed atomically on
 * Season.exportEmailClaimedAt (a stale claim from a killed run is retaken); exportEmailedAt is set
 * only once the send has actually gone. A failed send releases the claim.
 */
export async function emailSeasonExportLinks(season: SeasonInfo): Promise<boolean> {
  const { count } = await prisma.season.updateMany({
    where: {
      id: season.id,
      exportStatus: "READY",
      OR: [{ exportEmailClaimedAt: null }, { exportEmailClaimedAt: { lt: new Date(Date.now() - STALE_EMAIL_CLAIM_MS) } }],
    },
    data: { exportEmailClaimedAt: new Date() },
  });
  if (count === 0) return false;
  try {
    const row = await prisma.season.findUniqueOrThrow({ where: { id: season.id } });
    const links = await seasonExportLinks((row.exportFiles as unknown as ExportFile[]) ?? [], season.label);
    const sent = await sendSeasonExportEmail({ seasonLabel: season.label, links });
    if (!sent) throw new Error("send failed");
    await prisma.season.update({
      where: { id: season.id },
      data: { exportEmailedAt: new Date(), exportEmailClaimedAt: null, exportEmailWanted: false },
    });
    return true;
  } catch (error) {
    console.error(`[season-export] ${season.label} export email failed:`, error);
    await prisma.season.update({ where: { id: season.id }, data: { exportEmailClaimedAt: null } });
    return false;
  }
}
