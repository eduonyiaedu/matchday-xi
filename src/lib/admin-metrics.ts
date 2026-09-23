import { prisma } from "@/lib/prisma";

export interface DateRange {
  from: Date;
  to: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Turns the analytics page's `?from=YYYY-MM-DD&to=YYYY-MM-DD` into a range where BOTH chosen
 * days are fully included — `to` is the last millisecond of its day, not its midnight (which
 * silently dropped the whole end day from every `lte: range.to` query). A malformed value falls
 * back to the default instead of producing an Invalid Date that crashes Prisma. Shared by the
 * page and the export route so a downloaded report always matches what's on screen.
 */
export function parseMetricsRange(fromParam: string | null | undefined, toParam: string | null | undefined, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const fromDay = parseDay(fromParam) ?? new Date(today.getTime() - 90 * DAY_MS);
  const toDay = parseDay(toParam) ?? today;
  const range: DateRange = { from: fromDay, to: new Date(toDay.getTime() + DAY_MS - 1) };
  return {
    range,
    fromInput: fromDay.toISOString().slice(0, 10),
    toInput: toDay.toISOString().slice(0, 10),
  };
}

export type MetricKind = "number" | "percent" | "duration" | "timeseries" | "table";

/**
 * One unified shape for every metric on the investor-metrics dashboard, so the UI, and the
 * Excel/Word/PowerPoint exporters can all walk the same data generically instead of needing
 * bespoke rendering code per metric. `description` is shown directly under each metric's heading
 * in the UI and included in every export — write it as a plain-English explanation of exactly
 * what's being counted and over what window, since these numbers get quoted to investors.
 */
export interface Metric {
  key: string;
  label: string;
  description: string;
  kind: MetricKind;
  value?: number | string;
  unit?: string;
  /** For "timeseries" and "table" kinds — one point/row per label. */
  series?: { label: string; value: number }[];
  /** For "table" kind — series is ignored, these render as columns/rows instead. */
  columns?: string[];
  rows?: (string | number)[][];
}

export interface MetricSection {
  key: string;
  title: string;
  metrics: Metric[];
}

/** A single-value metric as display text, shared by the admin page and all three exports. */
export function formatMetricValue(metric: Metric): string {
  if (metric.kind === "percent") return `${metric.value}%`;
  if (metric.kind === "duration" && typeof metric.value === "number") {
    // Seconds as "12m 34s" rather than "754 seconds".
    const m = Math.floor(metric.value / 60);
    const s = metric.value % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }
  return `${metric.value}${metric.unit ? ` ${metric.unit}` : ""}`;
}

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10; // one decimal place
}

function startOfWeekUtc(d: Date): Date {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0 = Sunday
  date.setUTCDate(date.getUTCDate() - day);
  return date;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function truncateToDateUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function weekLabel(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Bucketed counts over EVERY day/week in the range, including empty ones. Building series only
 * from the dates that had data silently dropped zero periods — a week with no signups vanished
 * from the chart instead of showing as a dip, making growth look smoother than it was.
 */
function filledSeries(
  dates: Date[],
  range: DateRange,
  bucket: "day" | "week",
): { label: string; value: number }[] {
  const startOf = (d: Date) => (bucket === "week" ? startOfWeekUtc(d) : truncateToDateUtc(d));
  const step = bucket === "week" ? 7 : 1;
  const counts = new Map<string, number>();
  for (let d = startOf(range.from); d <= range.to; d = addDays(d, step)) counts.set(weekLabel(d), 0);
  for (const date of dates) {
    const label = weekLabel(startOf(date));
    if (counts.has(label)) counts.set(label, counts.get(label)! + 1);
  }
  return [...counts.entries()].map(([label, value]) => ({ label, value }));
}

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------

async function growthSection(range: DateRange): Promise<MetricSection> {
  const [totalUsers, usersInRange, activatedUsers] = await Promise.all([
    prisma.user.count(),
    prisma.user.findMany({ where: { createdAt: { gte: range.from, lte: range.to } }, select: { createdAt: true } }),
    prisma.user.count({ where: { favoriteTeamId: { not: null } } }),
  ]);

  const series = filledSeries(usersInRange.map((u) => u.createdAt), range, "week");

  return {
    key: "growth",
    title: "Growth",
    metrics: [
      {
        key: "total-users",
        label: "Total registered users",
        description: "Every account ever created, all-time — the top-line scale number.",
        kind: "number",
        value: totalUsers,
      },
      {
        key: "new-signups",
        label: "New signups in range",
        description: `Accounts created between ${range.from.toDateString()} and ${range.to.toDateString()}.`,
        kind: "number",
        value: usersInRange.length,
      },
      {
        key: "signups-per-week",
        label: "New signups per week",
        description: "Weekly signup counts (Sunday-starting weeks, UTC) within the selected range — the growth trend line. Weeks with no signups show as zero; the first and last weeks may be partial if the range starts or ends mid-week.",
        kind: "timeseries",
        series,
      },
      {
        key: "activation-rate",
        label: "Activation rate",
        description: "% of all-time signups who completed onboarding by picking a favorite club (favoriteTeamId set). A signup who never activates never enters a single leaderboard or prediction.",
        kind: "percent",
        value: pct(activatedUsers, totalUsers),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------------

async function engagementSection(range: DateRange): Promise<MetricSection> {
  const dayStart = new Date(Date.UTC(range.to.getUTCFullYear(), range.to.getUTCMonth(), range.to.getUTCDate()));
  const weekStart = addDays(dayStart, -6);
  const monthStart = addDays(dayStart, -29);

  const [dau, wau, mau, totalUsers, predictors, eligiblePredictors, loginDaysInMonth, firstLogin] = await Promise.all([
    prisma.dailyLoginLog.findMany({ where: { loginDate: dayStart }, select: { userId: true }, distinct: ["userId"] }),
    prisma.dailyLoginLog.findMany({ where: { loginDate: { gte: weekStart, lte: dayStart } }, select: { userId: true }, distinct: ["userId"] }),
    prisma.dailyLoginLog.findMany({ where: { loginDate: { gte: monthStart, lte: dayStart } }, select: { userId: true }, distinct: ["userId"] }),
    prisma.user.count({ where: { favoriteTeamId: { not: null } } }),
    prisma.prediction.findMany({
      where: { privateLeagueId: null, submittedAt: { gte: range.from, lte: range.to } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.dailyLoginLog.findMany({ where: { loginDate: { gte: range.from, lte: range.to } }, select: { userId: true }, distinct: ["userId"] }),
    // One DailyLoginLog row = one user active on one day, so the row count over the 30-day window
    // is the total of each day's DAU.
    prisma.dailyLoginLog.count({ where: { loginDate: { gte: monthStart, lte: dayStart } } }),
    prisma.dailyLoginLog.aggregate({ _min: { loginDate: true } }),
  ]);

  const dauCount = dau.length;
  const mauCount = mau.length;
  // Stickiness is conventionally AVERAGE DAU over the month divided by MAU. It used to divide a
  // single day's DAU by MAU — noisy day to day, and badly understated whenever the range ends
  // today (a partial day). Averaged over the days the app has actually existed within the window,
  // so a young app isn't penalised for days before launch.
  const windowStart = firstLogin._min.loginDate && firstLogin._min.loginDate > monthStart ? firstLogin._min.loginDate : monthStart;
  const daysInWindow = Math.max(1, Math.round((dayStart.getTime() - windowStart.getTime()) / (24 * 60 * 60 * 1000)) + 1);
  const avgDau = Math.round((loginDaysInMonth / daysInWindow) * 10) / 10;

  return {
    key: "engagement",
    title: "Engagement",
    metrics: [
      {
        key: "dau",
        label: "Daily Active Users (DAU)",
        description: `Distinct users who logged in on ${dayStart.toDateString()} (the end of the selected range) — a snapshot of one day's activity, so far if that day is today.`,
        kind: "number",
        value: dauCount,
      },
      {
        key: "wau",
        label: "Weekly Active Users (WAU)",
        description: "Distinct users who logged in at least once in the 7 days ending on the range's end date.",
        kind: "number",
        value: wau.length,
      },
      {
        key: "mau",
        label: "Monthly Active Users (MAU)",
        description: "Distinct users who logged in at least once in the 30 days ending on the range's end date.",
        kind: "number",
        value: mauCount,
      },
      {
        key: "avg-dau",
        label: "Average DAU (last 30 days)",
        description: "Average number of distinct users active per day over the 30 days ending on the range's end date (or since launch, if that's more recent).",
        kind: "number",
        value: avgDau,
      },
      {
        key: "stickiness",
        label: "Stickiness (DAU/MAU)",
        description: "Average DAU over the last 30 days divided by MAU — the classic engagement-depth metric investors look for. Higher means active users come back more often, not just once a month.",
        kind: "percent",
        value: pct(avgDau, mauCount),
      },
      {
        key: "prediction-participation",
        label: "Prediction participation rate",
        description: "% of onboarded (activated) users who submitted at least one global/team prediction within the selected range.",
        kind: "percent",
        value: pct(predictors.length, totalUsers),
      },
      {
        key: "login-participation",
        label: "Login participation rate",
        description: "% of onboarded users who logged in at least once within the selected range.",
        kind: "percent",
        value: pct(eligiblePredictors.length, totalUsers),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Retention cohorts
// ---------------------------------------------------------------------------

async function retentionSection(range: DateRange): Promise<MetricSection> {
  const cohortUsers = await prisma.user.findMany({
    where: { createdAt: { gte: range.from, lte: range.to } },
    select: { id: true, createdAt: true },
  });

  if (cohortUsers.length === 0) {
    return {
      key: "retention",
      title: "Retention cohorts",
      metrics: [
        {
          key: "retention-cohorts",
          label: "Weekly signup cohorts — D1 / D7 / D30 retention",
          description: "No signups fell inside the selected range, so there's no cohort to compute.",
          kind: "table",
          columns: ["Cohort week", "Signups", "D1 retained", "D7 retained", "D30 retained"],
          rows: [],
        },
      ],
    };
  }

  const cohortByWeek = new Map<string, { id: string; createdAt: Date }[]>();
  for (const u of cohortUsers) {
    const label = weekLabel(startOfWeekUtc(u.createdAt));
    if (!cohortByWeek.has(label)) cohortByWeek.set(label, []);
    cohortByWeek.get(label)!.push(u);
  }

  const allLogins = await prisma.dailyLoginLog.findMany({
    where: { userId: { in: cohortUsers.map((u) => u.id) } },
    select: { userId: true, loginDate: true },
  });
  const loginsByUser = new Map<string, Date[]>();
  for (const l of allLogins) {
    if (!loginsByUser.has(l.userId)) loginsByUser.set(l.userId, []);
    loginsByUser.get(l.userId)!.push(l.loginDate);
  }

  function retainedAt(user: { id: string; createdAt: Date }, dayOffset: number, windowDays: number): boolean {
    const logins = loginsByUser.get(user.id);
    if (!logins) return false;
    // DailyLoginLog.loginDate is stored as a @db.Date (midnight UTC), so the window must be
    // anchored to the signup's calendar date rather than its exact timestamp — comparing against
    // the raw createdAt instant made a 0-day window (D1) match nothing but a signup that happened
    // to land exactly at midnight.
    const signupDate = truncateToDateUtc(user.createdAt);
    const windowStart = addDays(signupDate, dayOffset - windowDays);
    const windowEnd = addDays(signupDate, dayOffset + windowDays);
    return logins.some((d) => d >= windowStart && d <= windowEnd);
  }

  // Only users whose D-n window has fully passed can be judged. Counting everyone used to show a
  // cohort from last week as "D7 retained: 0%" / "D30 retained: 0%" — not a retention failure, just
  // not old enough yet — which made every recent cohort look catastrophic.
  const today = truncateToDateUtc(new Date());
  function retention(users: { id: string; createdAt: Date }[], dayOffset: number, windowDays: number): string {
    const measurable = users.filter((u) => addDays(truncateToDateUtc(u.createdAt), dayOffset + windowDays) < today);
    if (measurable.length === 0) return "—";
    const retained = measurable.filter((u) => retainedAt(u, dayOffset, windowDays)).length;
    return `${pct(retained, measurable.length)}%${measurable.length < users.length ? ` (${measurable.length} of ${users.length})` : ""}`;
  }

  const rows: (string | number)[][] = [...cohortByWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, users]) => [week, users.length, retention(users, 1, 0), retention(users, 7, 1), retention(users, 30, 2)]);

  return {
    key: "retention",
    title: "Retention cohorts",
    metrics: [
      {
        key: "retention-cohorts",
        label: "Weekly signup cohorts — D1 / D7 / D30 retention",
        description:
          "Users grouped by the Sunday-starting week they signed up in. D1/D7/D30 = % of that cohort with at least one login within a day of that many days after their own signup date (D1: the next day; D7: day 6-8; D30: day 28-32). Only users old enough to have reached that day are counted — \"—\" means nobody in the cohort has yet, and \"(x of y)\" means only x of the y signups could be measured so far. Uses all available login history, not just the selected range, since retention looks forward from signup.",
        kind: "table",
        columns: ["Cohort week", "Signups", "D1 retained", "D7 retained", "D30 retained"],
        rows,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Streak distribution (snapshot, not range-scoped)
// ---------------------------------------------------------------------------

async function streaksSection(): Promise<MetricSection> {
  const users = await prisma.user.findMany({
    where: { favoriteTeamId: { not: null } },
    select: { currentStreak: true, longestStreak: true, lastLoginDate: true },
  });
  // currentStreak is only rewritten when a user logs in, so the stored value of someone who
  // stopped coming back is frozen at whatever it was — it used to be counted as a live streak
  // (a user gone for a month still showed as "a 10-day streak"). A streak is only still alive if
  // their last login was today or yesterday (UTC).
  const yesterday = addDays(truncateToDateUtc(new Date()), -1);
  const liveStreak = (u: { currentStreak: number; lastLoginDate: Date | null }) =>
    u.lastLoginDate && u.lastLoginDate >= yesterday ? u.currentStreak : 0;

  const buckets = [
    { label: "0 days", test: (n: number) => n === 0 },
    { label: "1-2 days", test: (n: number) => n >= 1 && n <= 2 },
    { label: "3-6 days", test: (n: number) => n >= 3 && n <= 6 },
    { label: "7-13 days", test: (n: number) => n >= 7 && n <= 13 },
    { label: "14-29 days", test: (n: number) => n >= 14 && n <= 29 },
    { label: "30+ days", test: (n: number) => n >= 30 },
  ];
  const series = buckets.map((b) => ({ label: b.label, value: users.filter((u) => b.test(liveStreak(u))).length }));
  const longest = users.reduce((max, u) => Math.max(max, u.longestStreak), 0);

  return {
    key: "streaks",
    title: "Streak distribution",
    metrics: [
      {
        key: "streak-distribution",
        label: "Current login-streak distribution",
        description: "Snapshot (not range-scoped) of every activated user's current consecutive-day login streak, bucketed. A streak counts only if the user last logged in today or yesterday (UTC) — anyone who has since stopped is in \"0 days\". Shows how many users are in a deep habitual-use groove right now.",
        kind: "timeseries",
        series,
      },
      {
        key: "longest-streak",
        label: "Longest streak ever recorded",
        description: "The single longest consecutive-day login streak any user has ever achieved — a proof point for how sticky the daily-login mechanic can be.",
        kind: "number",
        value: longest,
        unit: "days",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Virality / private leagues
// ---------------------------------------------------------------------------

async function viralitySection(range: DateRange): Promise<MetricSection> {
  const [leaguesInRange, allLeagues, totalUsers, membershipCounts] = await Promise.all([
    prisma.privateLeague.count({ where: { createdAt: { gte: range.from, lte: range.to } } }),
    prisma.privateLeague.findMany({ select: { id: true } }),
    prisma.user.count({ where: { favoriteTeamId: { not: null } } }),
    prisma.privateLeagueMembership.groupBy({ by: ["leagueId"], where: { status: "APPROVED" }, _count: { _all: true } }),
  ]);

  const usersInALeague = await prisma.privateLeagueMembership.findMany({
    where: { status: "APPROVED" },
    select: { userId: true },
    distinct: ["userId"],
  });

  const totalMembers = membershipCounts.reduce((sum, m) => sum + m._count._all, 0);
  const avgMembers = allLeagues.length > 0 ? Math.round((totalMembers / allLeagues.length) * 10) / 10 : 0;

  return {
    key: "virality",
    title: "Virality — private leagues",
    metrics: [
      {
        key: "leagues-created",
        label: "Private leagues created in range",
        description: "New private leagues created within the selected date range — each one is a user inviting friends, an organic distribution signal.",
        kind: "number",
        value: leaguesInRange,
      },
      {
        key: "avg-league-members",
        label: "Average members per league",
        description: "Total approved private-league memberships divided by total leagues that exist (all-time, not range-scoped) — how much a league tends to grow once created.",
        kind: "number",
        value: avgMembers,
      },
      {
        key: "pct-users-in-league",
        label: "% of users in at least one league",
        description: "% of activated users who are an approved member of at least one private league (all-time snapshot) — a network-effect indicator.",
        kind: "percent",
        value: pct(usersInALeague.length, totalUsers),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Trust (snapshot)
// ---------------------------------------------------------------------------

async function trustSection(): Promise<MetricSection> {
  const [total, flagged] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isFlaggedDuplicate: true } }),
  ]);

  return {
    key: "trust",
    title: "Trust & integrity",
    metrics: [
      {
        key: "duplicate-flag-rate",
        label: "Duplicate-account flag rate",
        description: "% of all-time accounts manually flagged by an admin as a suspected duplicate (disqualified from prize eligibility). Shows fair-play controls are in place and actively used.",
        kind: "percent",
        value: pct(flagged, total),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Sessions (first-party tracker)
// ---------------------------------------------------------------------------

async function sessionsSection(range: DateRange): Promise<MetricSection> {
  const sessions = await prisma.sessionLog.findMany({
    where: { startedAt: { gte: range.from, lte: range.to } },
    select: { userId: true, startedAt: true, lastSeenAt: true },
  });

  const activeUserCount = new Set(sessions.map((s) => s.userId)).size;
  const durationsMs = sessions.map((s) => s.lastSeenAt.getTime() - s.startedAt.getTime());
  const avgDurationSec = durationsMs.length > 0 ? Math.round(durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length / 1000) : 0;
  const sessionsPerUser = activeUserCount > 0 ? Math.round((sessions.length / activeUserCount) * 10) / 10 : 0;

  const series = filledSeries(sessions.map((s) => s.startedAt), range, "day");

  return {
    key: "sessions",
    title: "Session analytics",
    metrics: [
      {
        key: "session-count",
        label: "Total sessions in range",
        description:
          "A first-party session tracker (added to the app itself, not a third-party service): a visit becomes a new session after 30+ minutes of inactivity from the same user's last recorded activity, otherwise it extends the existing one. Counts every session started within the selected range.",
        kind: "number",
        value: sessions.length,
      },
      {
        key: "sessions-per-day",
        label: "Sessions per day",
        description: "Daily session-start counts within the selected range, including days with none.",
        kind: "timeseries",
        series,
      },
      {
        key: "avg-session-duration",
        label: "Average session duration",
        description: "Average time between a session's first and last recorded activity. A single-page visit correctly counts as 0 seconds.",
        kind: "duration",
        value: avgDurationSec,
        unit: "seconds",
      },
      {
        key: "sessions-per-active-user",
        label: "Sessions per active user",
        description: "Total sessions divided by the number of distinct users who had at least one session in range — how many times a typical active user opens the app.",
        kind: "number",
        value: sessionsPerUser,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Shared filters for the sections below
// ---------------------------------------------------------------------------

const DELETED_EMAIL_SUFFIX = "@deleted.matchday-xi.app";
/** Activated players who still exist — excludes accounts anonymized by the 30-day purge. */
const LIVE_PLAYERS = { favoriteTeamId: { not: null }, NOT: { email: { endsWith: DELETED_EMAIL_SUFFIX } } };
const MONTH_NAMES = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const monthName = (key: string) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

// ---------------------------------------------------------------------------
// Matchday engagement — participation and accuracy
// ---------------------------------------------------------------------------

async function matchdaySection(range: DateRange): Promise<MetricSection> {
  // Only fixtures whose prediction window has closed (and real ones — test fixtures use negative
  // externalIds), so a fixture still open for picks doesn't drag participation down.
  const fixtures = await prisma.fixture.findMany({
    where: { externalId: { gt: 0 }, status: { not: "VOIDED" }, lockAt: { lte: new Date() }, kickoffAt: { gte: range.from, lte: range.to } },
    include: { homeTeam: { select: { name: true, shortName: true } }, awayTeam: { select: { name: true, shortName: true } } },
    orderBy: { kickoffAt: "desc" },
  });
  const [fans, predictions] = await Promise.all([
    prisma.user.findMany({ where: LIVE_PLAYERS, select: { id: true, favoriteTeamId: true, createdAt: true } }),
    prisma.prediction.findMany({
      where: { privateLeagueId: null, fixtureId: { in: fixtures.map((f) => f.id) } },
      select: { fixtureId: true, teamId: true, userId: true, pointsAwarded: true, isPerfectXi: true },
    }),
  ]);

  // Indexed once, rather than re-filtering every fan and prediction for each fixture.
  const fansByTeam = new Map<string, { id: string; createdAt: Date }[]>();
  for (const u of fans) {
    const list = fansByTeam.get(u.favoriteTeamId!) ?? [];
    list.push(u);
    fansByTeam.set(u.favoriteTeamId!, list);
  }
  const predictorsBySide = new Map<string, Set<string>>();
  for (const p of predictions) {
    const key = `${p.fixtureId}|${p.teamId}`;
    const set = predictorsBySide.get(key) ?? new Set<string>();
    set.add(p.userId);
    predictorsBySide.set(key, set);
  }

  // One row per (fixture, side): that club's fans who had already signed up before lock, and how
  // many OF THOSE SAME FANS predicted. The numerator must come from the denominator's own set — it
  // used to count every prediction for the side, including deleted accounts and anyone who has
  // since switched club, which could push participation over 100%.
  let eligibleTotal = 0;
  let predictedTotal = 0;
  const rows: (string | number)[][] = [];
  for (const f of fixtures) {
    for (const side of [
      { teamId: f.homeTeamId, team: f.homeTeam, opponent: f.awayTeam },
      { teamId: f.awayTeamId, team: f.awayTeam, opponent: f.homeTeam },
    ]) {
      const eligibleFans = (fansByTeam.get(side.teamId) ?? []).filter((u) => u.createdAt < f.lockAt);
      const eligible = eligibleFans.length;
      if (eligible === 0) continue;
      const predictors = predictorsBySide.get(`${f.id}|${side.teamId}`) ?? new Set<string>();
      const predicted = eligibleFans.filter((u) => predictors.has(u.id)).length;
      eligibleTotal += eligible;
      predictedTotal += predicted;
      rows.push([
        `${side.team.shortName ?? side.team.name} v ${side.opponent.shortName ?? side.opponent.name} · ${f.kickoffAt.toISOString().slice(0, 10)}`,
        eligible,
        predicted,
        `${pct(predicted, eligible)}%`,
      ]);
    }
  }

  const scored = predictions.filter((p) => p.pointsAwarded !== null);
  // +10 per correct player, +25 bonus for all 11 — so correct picks = points / 10, minus the bonus.
  const correctPicks = scored.map((p) => (p.isPerfectXi ? 11 : Math.floor(p.pointsAwarded! / 10)));
  const avgCorrect = scored.length > 0 ? Math.round((correctPicks.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10 : 0;

  return {
    key: "matchday",
    title: "Matchday engagement",
    metrics: [
      {
        key: "matchday-participation",
        label: "Matchday participation",
        description:
          "Of each club's fans (players who'd already signed up before the fixture locked), the % who submitted a prediction for that club's fixture — across all fixtures in the range whose prediction window has closed. The core engagement number: are fans actually playing each matchday?",
        kind: "percent",
        value: pct(predictedTotal, eligibleTotal),
      },
      {
        key: "matchday-participation-by-fixture",
        label: "Participation by fixture",
        description: "The same, broken down per club per fixture (most recent first, up to 20).",
        kind: "table",
        columns: ["Club · fixture", "Fans", "Predicted", "Participation"],
        rows: rows.slice(0, 20),
      },
      {
        key: "prediction-accuracy",
        label: "Average correct players",
        description: "Average number of correctly predicted starters (out of 11) across scored global predictions for fixtures in the range — whether the game feels winnable.",
        kind: "number",
        value: avgCorrect,
        unit: "of 11",
      },
      {
        key: "perfect-xi-rate",
        label: "Perfect XI rate",
        description: "% of scored global predictions in the range that got all 11 starters right.",
        kind: "percent",
        value: pct(scored.filter((p) => p.isPerfectXi).length, scored.length),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Audience & reach (snapshots)
// ---------------------------------------------------------------------------

async function audienceSection(): Promise<MetricSection> {
  const fourteenDaysAgo = addDays(truncateToDateUtc(new Date()), -14);
  const [players, pushUsers, byClub, teams] = await Promise.all([
    prisma.user.findMany({ where: LIVE_PLAYERS, select: { id: true, lastLoginDate: true } }),
    prisma.pushSubscription.findMany({ where: { user: LIVE_PLAYERS }, select: { userId: true }, distinct: ["userId"] }),
    prisma.user.groupBy({ by: ["favoriteTeamId"], where: LIVE_PLAYERS, _count: { _all: true } }),
    prisma.team.findMany({ where: { isPremierLeagueClub: true }, select: { id: true, name: true } }),
  ]);
  const inactive = players.filter((u) => !u.lastLoginDate || u.lastLoginDate < fourteenDaysAgo).length;
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const clubRows = byClub
    .sort((a, b) => b._count._all - a._count._all)
    .map((c) => [teamName.get(c.favoriteTeamId!) ?? "Other", c._count._all, `${pct(c._count._all, players.length)}%`]);

  return {
    key: "audience",
    title: "Audience & reach",
    metrics: [
      {
        key: "push-opt-in",
        label: "Push notification opt-in rate",
        description: "% of current players with push notifications switched on for at least one device (snapshot). This is how many people matchday reminders and prize announcements can actually reach.",
        kind: "percent",
        value: pct(pushUsers.length, players.length),
      },
      {
        key: "inactive-players",
        label: "Inactive players (14+ days)",
        description: `% of current players who haven't logged in for 14 days or more (snapshot) — ${inactive} of ${players.length}. A rising number is an early churn warning.`,
        kind: "percent",
        value: pct(inactive, players.length),
      },
      {
        key: "fans-per-club",
        label: "Fans per club",
        description: "How many current players support each club (snapshot) — for marketing and club partnership conversations.",
        kind: "table",
        columns: ["Club", "Fans", "Share"],
        rows: clubRows,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Prize-draw eligibility (per completed month, not range-scoped)
// ---------------------------------------------------------------------------

async function prizesSection(): Promise<MetricSection> {
  const grouped = await prisma.monthlyPrizeEligibility.groupBy({ by: ["month", "isEligible"], _count: { _all: true } });
  const byMonth = new Map<string, { checked: number; eligible: number }>();
  for (const g of grouped) {
    const m = byMonth.get(g.month) ?? { checked: 0, eligible: 0 };
    m.checked += g._count._all;
    if (g.isEligible) m.eligible += g._count._all;
    byMonth.set(g.month, m);
  }
  const months = [...byMonth.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 12);
  const latest = months[0];

  return {
    key: "prizes",
    title: "Prize-draw eligibility",
    metrics: [
      {
        key: "prize-eligibility-latest",
        label: latest ? `Eligible for the ${monthName(latest[0])} draw` : "Eligible for the latest monthly draw",
        description: "% of players who qualified for the most recent monthly prize draw — predicted every one of their club's fixtures that month AND logged in every day. Your most committed players. Calculated when each month's draw runs, so none until the first draw.",
        kind: "percent",
        value: latest ? pct(latest[1].eligible, latest[1].checked) : 0,
      },
      {
        key: "prize-eligibility-by-month",
        label: "Eligibility by month",
        description: "Players checked and qualified for each completed month's draw (most recent first, up to 12 months).",
        kind: "table",
        columns: ["Month", "Players", "Eligible", "Share"],
        rows: months.map(([month, m]) => [monthName(month), m.checked, m.eligible, `${pct(m.eligible, m.checked)}%`]),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Sharing & account deletions
// ---------------------------------------------------------------------------

async function sharingSection(range: DateRange): Promise<MetricSection> {
  const [events, predictors] = await Promise.all([
    prisma.shareEvent.findMany({ where: { createdAt: { gte: range.from, lte: range.to } }, select: { userId: true, method: true } }),
    prisma.prediction.findMany({ where: { submittedAt: { gte: range.from, lte: range.to } }, select: { userId: true }, distinct: ["userId"] }),
  ]);
  const sharers = new Set(events.map((e) => e.userId)).size;
  const viaShareSheet = events.filter((e) => e.method === "share").length;

  return {
    key: "sharing",
    title: "Virality — share cards",
    metrics: [
      {
        key: "cards-shared",
        label: "Share cards shared in range",
        description: `Times a player sent their share card via their phone's share sheet (${viaShareSheet}) or saved it to their device (${events.length - viaShareSheet}) within the range. Counts real shares from the Share button only — not link previews. Tracking started 23 Sep 2026.`,
        kind: "number",
        value: events.length,
      },
      {
        key: "sharer-rate",
        label: "% of predictors who shared",
        description: "Distinct players who shared at least one card, as a % of distinct players who submitted any prediction in the range — how often playing turns into word of mouth.",
        kind: "percent",
        value: pct(sharers, predictors.length),
      },
    ],
  };
}

async function deletionsSection(range: DateRange): Promise<MetricSection> {
  const [requestsInRange, pending, completed] = await Promise.all([
    prisma.accountDeletionFeedback.count({ where: { createdAt: { gte: range.from, lte: range.to } } }),
    prisma.user.count({ where: { deletionScheduledAt: { not: null }, NOT: { email: { endsWith: DELETED_EMAIL_SUFFIX } } } }),
    prisma.user.count({ where: { email: { endsWith: DELETED_EMAIL_SUFFIX } } }),
  ]);
  return {
    key: "deletions",
    title: "Account deletions",
    metrics: [
      {
        key: "deletion-requests",
        label: "Deletion requests in range",
        description: "Players who asked to delete their account within the range (the reasons they gave are on Admin → Deletion feedback).",
        kind: "number",
        value: requestsInRange,
      },
      {
        key: "deletion-status",
        label: "Deletion status (all-time)",
        description: "Accounts currently in their 30-day grace period (they can still cancel by logging back in), and accounts permanently deleted.",
        kind: "table",
        columns: ["Status", "Accounts"],
        rows: [
          ["Pending (in grace period)", pending],
          ["Permanently deleted", completed],
        ],
      },
    ],
  };
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * The metrics for a date range, reusing a recently saved result (MetricsSnapshot) instead of
 * recounting whole tables on every view of the page or its exports — the counting itself only
 * gets heavier as the app grows. A saved result is reused for up to an hour when the range
 * includes today (still changing), a day otherwise; `refresh` forces a recount.
 */
export async function getAdminMetricsCached(
  range: DateRange,
  opts: { refresh?: boolean } = {},
): Promise<{ sections: MetricSection[]; computedAt: Date }> {
  const key = `${range.from.toISOString().slice(0, 10)}_${range.to.toISOString().slice(0, 10)}`;
  const now = new Date();
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const maxAgeMs = range.to.getTime() >= todayStart ? HOUR_MS : 24 * HOUR_MS;

  if (!opts.refresh) {
    const saved = await prisma.metricsSnapshot.findUnique({ where: { key } });
    if (saved && now.getTime() - saved.computedAt.getTime() < maxAgeMs) {
      return { sections: saved.sections as unknown as MetricSection[], computedAt: saved.computedAt };
    }
  }
  const sections = await getAdminMetrics(range);
  const json = JSON.parse(JSON.stringify(sections));
  await prisma.metricsSnapshot.upsert({
    where: { key },
    create: { key, sections: json, computedAt: now },
    update: { sections: json, computedAt: now },
  });
  return { sections, computedAt: now };
}

export async function getAdminMetrics(range: DateRange): Promise<MetricSection[]> {
  const sections = await Promise.all([
    growthSection(range),
    engagementSection(range),
    matchdaySection(range),
    retentionSection(range),
    streaksSection(),
    audienceSection(),
    prizesSection(),
    viralitySection(range),
    sharingSection(range),
    trustSection(),
    deletionsSection(range),
    sessionsSection(range),
  ]);
  return sections;
}
