import { prisma } from "@/lib/prisma";

export interface DateRange {
  from: Date;
  to: Date;
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

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------

async function growthSection(range: DateRange): Promise<MetricSection> {
  const [totalUsers, usersInRange, activatedUsers] = await Promise.all([
    prisma.user.count(),
    prisma.user.findMany({ where: { createdAt: { gte: range.from, lte: range.to } }, select: { createdAt: true } }),
    prisma.user.count({ where: { favoriteTeamId: { not: null } } }),
  ]);

  const weekBuckets = new Map<string, number>();
  for (const u of usersInRange) {
    const label = weekLabel(startOfWeekUtc(u.createdAt));
    weekBuckets.set(label, (weekBuckets.get(label) ?? 0) + 1);
  }
  const series = [...weekBuckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label, value }));

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
        description: "Weekly signup counts (Sunday-starting weeks, UTC) within the selected range — the growth trend line.",
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

  const [dau, wau, mau, totalUsers, predictors, eligiblePredictors] = await Promise.all([
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
  ]);

  const dauCount = dau.length;
  const mauCount = mau.length;

  return {
    key: "engagement",
    title: "Engagement",
    metrics: [
      {
        key: "dau",
        label: "Daily Active Users (DAU)",
        description: `Distinct users who logged in on ${dayStart.toDateString()} (the end of the selected range) — a snapshot of one day's activity.`,
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
        key: "stickiness",
        label: "Stickiness (DAU/MAU)",
        description: "DAU divided by MAU — the classic engagement-depth metric investors look for. Higher means active users come back more often, not just once a month.",
        kind: "percent",
        value: pct(dauCount, mauCount),
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

  const rows: (string | number)[][] = [...cohortByWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, users]) => {
      const d1 = users.filter((u) => retainedAt(u, 1, 0)).length;
      const d7 = users.filter((u) => retainedAt(u, 7, 1)).length;
      const d30 = users.filter((u) => retainedAt(u, 30, 2)).length;
      return [week, users.length, `${pct(d1, users.length)}%`, `${pct(d7, users.length)}%`, `${pct(d30, users.length)}%`];
    });

  return {
    key: "retention",
    title: "Retention cohorts",
    metrics: [
      {
        key: "retention-cohorts",
        label: "Weekly signup cohorts — D1 / D7 / D30 retention",
        description:
          "Users grouped by the Sunday-starting week they signed up in. D1/D7/D30 = % of that cohort with at least one login within a day of that many days after their own signup date (D1: the next day; D7: day 6-8; D30: day 28-32). Uses all available login history, not just the selected range, since retention looks forward from signup.",
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
    select: { currentStreak: true, longestStreak: true },
  });

  const buckets = [
    { label: "0 days", test: (n: number) => n === 0 },
    { label: "1-2 days", test: (n: number) => n >= 1 && n <= 2 },
    { label: "3-6 days", test: (n: number) => n >= 3 && n <= 6 },
    { label: "7-13 days", test: (n: number) => n >= 7 && n <= 13 },
    { label: "14-29 days", test: (n: number) => n >= 14 && n <= 29 },
    { label: "30+ days", test: (n: number) => n >= 30 },
  ];
  const series = buckets.map((b) => ({ label: b.label, value: users.filter((u) => b.test(u.currentStreak)).length }));
  const longest = users.reduce((max, u) => Math.max(max, u.longestStreak), 0);

  return {
    key: "streaks",
    title: "Streak distribution",
    metrics: [
      {
        key: "streak-distribution",
        label: "Current login-streak distribution",
        description: "Snapshot (not range-scoped) of every activated user's current consecutive-day login streak, bucketed. Shows how many users are in a deep habitual-use groove right now.",
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

  const dayBuckets = new Map<string, number>();
  for (const s of sessions) {
    const label = s.startedAt.toISOString().slice(0, 10);
    dayBuckets.set(label, (dayBuckets.get(label) ?? 0) + 1);
  }
  const series = [...dayBuckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value }));

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
        description: "Daily session-start counts within the selected range.",
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

export async function getAdminMetrics(range: DateRange): Promise<MetricSection[]> {
  const [growth, engagement, retention, streaks, virality, trust, sessions] = await Promise.all([
    growthSection(range),
    engagementSection(range),
    retentionSection(range),
    streaksSection(),
    viralitySection(range),
    trustSection(),
    sessionsSection(range),
  ]);
  return [growth, engagement, retention, streaks, virality, trust, sessions];
}
