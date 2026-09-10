import { describe, expect, it } from "vitest";
import { matchPlayerName, normalizeName } from "@/lib/player-matching";

describe("normalizeName", () => {
  it("lowercases, strips accents and punctuation, collapses whitespace", () => {
    expect(normalizeName("Martin Ødegaard")).toBe("martin degaard");
    expect(normalizeName("N'Golo Kanté")).toBe("n golo kante");
    expect(normalizeName("  Bruno   Fernandes ")).toBe("bruno fernandes");
  });
});

describe("matchPlayerName", () => {
  const candidates = [
    { id: "1", name: "Bukayo Saka" },
    { id: "2", name: "Gabriel Martinelli" },
    { id: "3", name: "Gabriel Magalhaes" },
  ];

  it("matches an exact full-name hit", () => {
    expect(matchPlayerName("Bukayo Saka", candidates)).toBe("1");
  });

  it("matches by unique surname when the full name differs slightly", () => {
    expect(matchPlayerName("B. Saka", candidates)).toBe("1");
  });

  it("matches an initial + surname form (common API-Football lineup format)", () => {
    expect(matchPlayerName("G. Martinelli", candidates)).toBe("2");
  });

  it("refuses to guess when a surname is ambiguous", () => {
    // Two "Gabriel"s — surname alone ("magalhaes" vs "martinelli") still disambiguates here,
    // so use a genuinely ambiguous first-name-only case instead.
    const ambiguous = [
      { id: "a", name: "Gabriel Jesus" },
      { id: "b", name: "Gabriel Silva" },
    ];
    expect(matchPlayerName("Gabriel", ambiguous)).toBeNull();
  });

  it("returns null when there is no plausible match", () => {
    expect(matchPlayerName("Cristiano Ronaldo", candidates)).toBeNull();
  });

  it("returns null for an empty name", () => {
    expect(matchPlayerName("", candidates)).toBeNull();
  });
});
