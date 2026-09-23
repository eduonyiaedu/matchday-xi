import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { parseMetricsRange } = await import("@/lib/admin-metrics");

const now = new Date("2026-09-23T14:30:00Z");

describe("parseMetricsRange", () => {
  it("includes the whole end day", () => {
    const { range } = parseMetricsRange("2026-09-01", "2026-09-22", now);
    expect(range.from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-09-22T23:59:59.999Z");
    // A sign-up late on the end day is inside the range.
    expect(new Date("2026-09-22T21:00:00Z") <= range.to).toBe(true);
  });

  it("defaults to the last 90 days through the end of today", () => {
    const { range, fromInput, toInput } = parseMetricsRange(undefined, undefined, now);
    expect(fromInput).toBe("2026-06-25");
    expect(toInput).toBe("2026-09-23");
    expect(range.to.toISOString()).toBe("2026-09-23T23:59:59.999Z");
  });

  it("falls back instead of producing an Invalid Date for garbage input", () => {
    const { range, fromInput, toInput } = parseMetricsRange("not-a-date", "2026-13-45", now);
    expect(Number.isNaN(range.from.getTime())).toBe(false);
    expect(Number.isNaN(range.to.getTime())).toBe(false);
    expect(fromInput).toBe("2026-06-25");
    expect(toInput).toBe("2026-09-23");
  });
});
