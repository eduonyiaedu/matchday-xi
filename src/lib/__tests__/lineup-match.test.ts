import { describe, expect, it } from "vitest";
import { groupBySignaturePercentage } from "@/lib/lineup-match";

const T = "team-a";

describe("groupBySignaturePercentage", () => {
  it("returns one 100% group when everyone picked the same lineup", () => {
    const groups = groupBySignaturePercentage([
      { userId: "a", teamId: T, lineupSignature: "1,2,3" },
      { userId: "b", teamId: T, lineupSignature: "1,2,3" },
    ]);
    expect(groups).toEqual([{ userIds: ["a", "b"], percentage: 100 }]);
  });

  it("splits into separate groups by distinct signature, percentages summing to 100", () => {
    const groups = groupBySignaturePercentage([
      { userId: "a", teamId: T, lineupSignature: "1,2,3" },
      { userId: "b", teamId: T, lineupSignature: "1,2,3" },
      { userId: "c", teamId: T, lineupSignature: "4,5,6" },
      { userId: "d", teamId: T, lineupSignature: "4,5,6" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.reduce((sum, g) => sum + g.percentage, 0)).toBe(100);
    const groupFor = (userId: string) => groups.find((g) => g.userIds.includes(userId));
    expect(groupFor("a")?.percentage).toBe(50);
    expect(groupFor("c")?.percentage).toBe(50);
  });

  it("computes each club's percentage against that club's predictions only", () => {
    // Both clubs' fans are unanimous — each should read 100%, not 50% of the combined pool.
    const groups = groupBySignaturePercentage([
      { userId: "a1", teamId: "arsenal", lineupSignature: "ars-xi" },
      { userId: "a2", teamId: "arsenal", lineupSignature: "ars-xi" },
      { userId: "c1", teamId: "chelsea", lineupSignature: "che-xi" },
      { userId: "c2", teamId: "chelsea", lineupSignature: "che-xi" },
      { userId: "c3", teamId: "chelsea", lineupSignature: "che-xi" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.percentage === 100)).toBe(true);
  });

  it("never reports 0% for a one-of-a-kind lineup among many predictions", () => {
    const predictions = Array.from({ length: 300 }, (_, i) => ({ userId: `u${i}`, teamId: T, lineupSignature: "common" }));
    predictions.push({ userId: "unique", teamId: T, lineupSignature: "rare" });
    const rare = groupBySignaturePercentage(predictions).find((g) => g.userIds.includes("unique"));
    expect(rare?.percentage).toBe(1);
  });

  it("excludes predictions with no signature from both grouping and the denominator", () => {
    const groups = groupBySignaturePercentage([
      { userId: "a", teamId: T, lineupSignature: "1,2,3" },
      { userId: "b", teamId: T, lineupSignature: null },
    ]);
    expect(groups).toEqual([{ userIds: ["a"], percentage: 100 }]);
  });

  it("returns an empty array when nobody has a signature", () => {
    expect(groupBySignaturePercentage([{ userId: "a", teamId: T, lineupSignature: null }])).toEqual([]);
  });

  it("returns an empty array for no predictions at all", () => {
    expect(groupBySignaturePercentage([])).toEqual([]);
  });

  it("rounds to the nearest integer rather than truncating", () => {
    // 2 of 3 = 66.66...% must round up to 67, not down to 66.
    const groups = groupBySignaturePercentage([
      { userId: "a", teamId: T, lineupSignature: "x" },
      { userId: "b", teamId: T, lineupSignature: "x" },
      { userId: "c", teamId: T, lineupSignature: "y" },
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
      { userId: "a", teamId: T, lineupSignature: "1,2,3" },
      { userId: "b", teamId: T, lineupSignature: "3,2,1" },
    ]);
    expect(groups).toHaveLength(2);
  });
});
