import { describe, expect, it } from "vitest";
import { scorePrediction } from "@/lib/scoring";

const elevenIds = (prefix: string) => Array.from({ length: 11 }, (_, i) => `${prefix}${i}`);

describe("scorePrediction", () => {
  it("awards 10 points per correctly predicted player", () => {
    const predicted = elevenIds("p");
    const official = [...predicted.slice(0, 4), "x1", "x2", "x3", "x4", "x5", "x6", "x7"];
    const result = scorePrediction(predicted, official);
    expect(result.correctSquadPlayerIds).toHaveLength(4);
    expect(result.pointsAwarded).toBe(40);
    expect(result.isPerfectXi).toBe(false);
  });

  it("awards 0 points when nothing matches", () => {
    const result = scorePrediction(elevenIds("p"), elevenIds("q"));
    expect(result.pointsAwarded).toBe(0);
    expect(result.isPerfectXi).toBe(false);
  });

  it("awards +25 bonus on top of the 110 base points for a perfect XI", () => {
    const ids = elevenIds("p");
    const result = scorePrediction(ids, [...ids]);
    expect(result.pointsAwarded).toBe(135);
    expect(result.isPerfectXi).toBe(true);
  });

  it("is order-independent — a perfect XI in a different slot order still counts", () => {
    const ids = elevenIds("p");
    const shuffled = [...ids].reverse();
    const result = scorePrediction(ids, shuffled);
    expect(result.isPerfectXi).toBe(true);
    expect(result.pointsAwarded).toBe(135);
  });

  it("does not award the perfect-XI bonus for 10/11 correct", () => {
    const ids = elevenIds("p");
    const official = [...ids.slice(0, 10), "someone-else"];
    const result = scorePrediction(ids, official);
    expect(result.pointsAwarded).toBe(100);
    expect(result.isPerfectXi).toBe(false);
  });

  it("never double-counts a player predicted twice (shouldn't happen given API validation, but stays correct)", () => {
    const predicted = ["a", "a", "b"];
    const official = ["a", "b", "c"];
    const result = scorePrediction(predicted, official);
    expect(result.correctSquadPlayerIds).toEqual(["a", "a", "b"]);
    expect(result.pointsAwarded).toBe(30);
  });
});
