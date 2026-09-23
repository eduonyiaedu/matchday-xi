import { describe, expect, it } from "vitest";
import { formatCalendarDay, leagueEndDateLowerBoundFor, leagueWindowEndExclusive } from "@/lib/league-window";

// What z.coerce.date() produces from the create-league form's <input type="date"> value.
const endDate = new Date("2026-10-31");

describe("leagueWindowEndExclusive", () => {
  it("includes a kickoff late on the final day", () => {
    const kickoff = new Date("2026-10-31T19:45:00Z");
    expect(kickoff < leagueWindowEndExclusive(endDate)).toBe(true);
  });

  it("excludes a kickoff on the day after", () => {
    const kickoff = new Date("2026-11-01T12:30:00Z");
    expect(kickoff < leagueWindowEndExclusive(endDate)).toBe(false);
  });
});

describe("leagueEndDateLowerBoundFor", () => {
  it("agrees with leagueWindowEndExclusive for the Prisma-side filter", () => {
    for (const iso of ["2026-10-31T00:00:00Z", "2026-10-31T19:45:00Z", "2026-11-01T00:00:00Z", "2026-11-01T12:30:00Z"]) {
      const kickoff = new Date(iso);
      const viaWindow = kickoff < leagueWindowEndExclusive(endDate);
      const viaFilter = endDate > leagueEndDateLowerBoundFor(kickoff);
      expect(viaFilter).toBe(viaWindow);
    }
  });
});

describe("formatCalendarDay", () => {
  it("renders the picked day regardless of the process timezone", () => {
    expect(formatCalendarDay(endDate)).toBe("31 Oct 2026");
  });
});
