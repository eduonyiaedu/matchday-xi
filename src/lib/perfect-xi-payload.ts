import { prisma } from "@/lib/prisma";
import { perfectXiCountForPrediction } from "@/lib/seasons";

export interface PerfectXiTakeoverPayload {
  matchLabel: string;
  matchdayLabel: string;
  formation: string;
  rows: { pos: string; number: number | null; name: string }[];
  pointsAwarded: number;
  perfectXiCount: number;
  predictionId: string;
}

const POS_ABBREV: Record<string, string> = {
  GOALKEEPER: "GK",
  DEFENDER: "DEF",
  MIDFIELDER: "MID",
  FORWARD: "FWD",
};

/**
 * Builds the Perfect XI takeover's props from just a predictionId — shared by (app)/layout.tsx's
 * automatic trigger and anything else that needs to render the same celebration. `perfectXiCount`
 * is scoped to the prediction's own scope: that private league, or (global) that season.
 */
export async function buildPerfectXiTakeoverPayload(predictionId: string): Promise<PerfectXiTakeoverPayload | null> {
  const prediction = await prisma.prediction.findUnique({
    where: { id: predictionId },
    include: {
      fixture: { include: { homeTeam: true, awayTeam: true, competition: true } },
      privateLeague: { select: { name: true } },
      slots: {
        include: { squadPlayer: { select: { name: true, shirtNumber: true, position: true } } },
        orderBy: { slotIndex: "asc" },
      },
    },
  });
  if (!prediction || !prediction.isPerfectXi || prediction.pointsAwarded === null) return null;

  const matchLabel =
    prediction.fixture.homeScore !== null && prediction.fixture.awayScore !== null
      ? `${prediction.fixture.homeTeam.shortName ?? prediction.fixture.homeTeam.name} ${prediction.fixture.homeScore}–${prediction.fixture.awayScore} ${prediction.fixture.awayTeam.shortName ?? prediction.fixture.awayTeam.name}`
      : `${prediction.fixture.homeTeam.shortName ?? prediction.fixture.homeTeam.name} vs ${prediction.fixture.awayTeam.shortName ?? prediction.fixture.awayTeam.name}`;

  const matchdayLabel = prediction.privateLeague
    ? `${prediction.privateLeague.name} · Final`
    : `${prediction.fixture.competition.name} · Final`;

  const perfectXiCount = await perfectXiCountForPrediction(prediction);

  return {
    matchLabel,
    matchdayLabel,
    formation: prediction.formation,
    rows: prediction.slots.map((s) => ({
      pos: s.slotIndex === 0 ? "GK" : POS_ABBREV[s.squadPlayer.position] ?? "MID",
      number: s.squadPlayer.shirtNumber,
      name: s.squadPlayer.name,
    })),
    pointsAwarded: prediction.pointsAwarded,
    perfectXiCount,
    predictionId: prediction.id,
  };
}
