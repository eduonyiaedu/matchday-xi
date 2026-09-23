const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A private league's end date is picked as a calendar day ("Ends: Oct 31") and stored as that
 * day's UTC midnight — so comparing kickoffs against the raw value made the whole final day
 * fall OUTSIDE the league. Every "is this kickoff inside the league?" check goes through here
 * instead, treating the end date as inclusive: the window's exclusive upper bound is the
 * following midnight.
 */
export function leagueWindowEndExclusive(endDate: Date): Date {
  return new Date(endDate.getTime() + DAY_MS);
}

/** A league start/end date as the calendar day the creator picked, independent of viewer timezone. */
export function formatCalendarDay(date: Date): string {
  return date.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
}

/**
 * The same boundary flipped for a Prisma filter on the league row itself (where the kickoff is
 * the known value): `endDate + 1 day > kickoff` is `endDate > kickoff - 1 day`.
 */
export function leagueEndDateLowerBoundFor(kickoffAt: Date): Date {
  return new Date(kickoffAt.getTime() - DAY_MS);
}
