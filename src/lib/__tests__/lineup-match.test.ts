import { describe, expect, it } from "vitest";
import { groupBySignaturePercentage } from "@/lib/lineup-match";

describe("groupBySignaturePercentage", () => {
  it("returns one 100% group when everyone picked the same lineup", () => {
    const groups = groupBySignaturePercentage([
      { userId: "a", lineupSignature: "1,2,3" },
      { userId: "b", lineupSignature: "1,2,3" },
    ]);
    expect(groups).toEqual([{ userIds: ["a", "b"], percentage: 100 }]);
  });

  it("splits into separate groups by distinct signature, percentages summing to 100", () => {
    const groups = groupBySignaturePercentage([
      { userId: "a", lineupSignature: "1,2,3" },
      { userId: "b", lineupSignature: "1,2,3" },
      { userId: "c", lineupSignature: "4,5,6" },
      { userId: "d", lineupSignature: "4,5,6" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.reduce((sum, g) => sum + g.percentage, 0)).toBe(100);
    const groupFor = (userId: string) => groups.find((g) => g.userIds.includes(userId));
    expect(groupFor("a")?.percentage).toBe(50);
    expect(groupFor("c")?.percentage).toBe(50);
  });

  it("excludes predictions with no signature from both grouping and the denominator", () => {
    const groups = groupBySignaturePercentage([
      { userId: "a", lineupSignature: "1,2,3" },
      { userId: "b", lineupSignature: null },
    ]);
    expect(groups).toEqual([{ userIds: ["a"], percentage: 100 }]);
  });

  it("returns an empty array when nobody has a signature", () => {
    expect(groupBySignaturePercentage([{ userId: "a", lineupSignature: null }])).toEqual([]);
  });

  it("returns an empty array for no predictions at all", () => {
    expect(groupBySignaturePercentage([])).toEqual([]);
  });

  it("rounds to the nearest integer rather than truncating", () => {
    // 1 of 3 = 33.33...% -> rounds to 33, not floored to 33 by coincidence here; use a case where
    // rounding direction actually matters: 2 of 3 = 66.66...% must round up to 67, not down to 66.
    const groups = groupBySignaturePercentage([
      { userId: "a", lineupSignature: "x" },
      { userId: "b", lineupSignature: "x" },
      { userId: "c", lineupSignature: "y" },
    ]);
    const groupFor = (sig: string) => groups.find((g) => g.userIds[0] === (sig === "x" ? "a" : "c"));
    expect(groupFor("x")?.percentage).toBe(67);
    expect(groupFor("y")?.percentage).toBe(33);
  });

  it("treats lineup signatures as order-sensitive strings — callers must pre-sort them", () => {
    // groupBySignaturePercentage itself does no normalization; it trusts the caller's signature
    // is already canonical (sorted). Two differently-ordered strings for the same players are
    // treated as distinct groups here — that's the caller's responsibility, not this function's.
    const groups = groupBySignaturePercentage([
      { userId: "a", lineupSignature: "1,2,3" },
      { userId: "b", lineupSignature: "3,2,1" },
    ]);
    expect(groups).toHaveLength(2);
  });
});
