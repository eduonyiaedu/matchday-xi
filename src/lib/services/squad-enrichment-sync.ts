import { prisma } from "@/lib/prisma";
import { apiFootballClient, type ApiFootballSquadPlayer } from "@/lib/api-football/client";
import { API_FOOTBALL_CLUB_TEAM_IDS } from "@/lib/api-football/club-team-ids";
import { matchPlayerName } from "@/lib/player-matching";
import type { PlayerPosition } from "@/generated/prisma/enums";

// API-Football's free tier is 10 requests/minute AND ~100/day, the latter shared with the
// time-critical lineup-checking cron — this job must stay small and infrequent. 3 clubs/run at
// 2 requests each (senior + U21) is 6 requests/run, run once daily (see the workflow entry),
// leaving the daily budget almost entirely free for matchday lineup-checking.
const MAX_CLUBS_PER_ENRICHMENT_RUN = 3;
const REQUEST_SPACING_MS = 700;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapApiFootballPosition(raw: string | null): PlayerPosition {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("goalkeeper")) return "GOALKEEPER";
  if (s.includes("defender")) return "DEFENDER";
  if (s.includes("midfielder")) return "MIDFIELDER";
  return "FORWARD";
}

async function enrichSeniorSquad(teamId: string, players: ApiFootballSquadPlayer[]) {
  const seniorRows = await prisma.squadPlayer.findMany({
    where: { teamId, isActive: true, squadTier: "SENIOR" },
    select: { id: true, name: true },
  });

  let matched = 0;
  for (const entry of players) {
    const matchedId = matchPlayerName(entry.name, seniorRows);
    if (!matchedId) continue;
    await prisma.squadPlayer.update({
      where: { id: matchedId },
      data: {
        shirtNumber: entry.number ?? undefined,
        apiFootballId: entry.id,
        photoUrl: entry.photo ?? undefined,
      },
    });
    matched++;
  }
  return matched;
}

/**
 * A name match against an existing SENIOR row is skipped entirely (not enriched) — that person
 * is already pickable under their senior identity with their senior shirt number, and creating a
 * separate U21 row for the same human would let them be picked twice. Only genuinely new names
 * (no senior match) become new U21 rows, carrying the shirt number they wear in the U21 squad
 * listing itself — never reconciled against any other number source, per founder direction.
 */
async function enrichU21Squad(teamId: string, players: ApiFootballSquadPlayer[]) {
  const existingRows = await prisma.squadPlayer.findMany({
    where: { teamId, isActive: true },
    select: { id: true, name: true, squadTier: true },
  });
  const seniorRows = existingRows.filter((r) => r.squadTier === "SENIOR");
  const u21Rows = existingRows.filter((r) => r.squadTier === "U21");

  let created = 0;
  let matched = 0;
  for (const entry of players) {
    if (matchPlayerName(entry.name, seniorRows)) continue; // already a senior player, skip

    const existingU21Id = matchPlayerName(entry.name, u21Rows);
    if (existingU21Id) {
      await prisma.squadPlayer.update({
        where: { id: existingU21Id },
        data: {
          shirtNumber: entry.number ?? undefined,
          apiFootballId: entry.id,
          photoUrl: entry.photo ?? undefined,
        },
      });
      matched++;
      continue;
    }

    await prisma.squadPlayer.create({
      data: {
        teamId,
        footballDataId: null,
        apiFootballId: entry.id,
        name: entry.name,
        position: mapApiFootballPosition(entry.position),
        shirtNumber: entry.number ?? undefined,
        photoUrl: entry.photo ?? undefined,
        squadTier: "U21",
      },
    });
    created++;
  }
  return { created, matched };
}

/** Used by the sync-shirt-numbers cron route and admin button. */
export async function syncShirtNumbersAndU21Squads() {
  const allTeams = await prisma.team.findMany({ where: { isPremierLeagueClub: true, isActive: true } });
  const teams = [...allTeams]
    .sort((a, b) => (a.apiFootballSquadSyncedAt?.getTime() ?? 0) - (b.apiFootballSquadSyncedAt?.getTime() ?? 0))
    .slice(0, MAX_CLUBS_PER_ENRICHMENT_RUN);

  let seniorMatched = 0;
  let u21Created = 0;
  let u21Matched = 0;
  const skipped: string[] = [];
  const processed: string[] = [];

  for (const team of teams) {
    const ids = API_FOOTBALL_CLUB_TEAM_IDS[team.externalId];
    if (!ids) {
      skipped.push(team.name);
      continue;
    }

    const seniorPlayers = await apiFootballClient.getSquad(ids.senior);
    await sleep(REQUEST_SPACING_MS);
    const u21Players = await apiFootballClient.getSquad(ids.u21);
    await sleep(REQUEST_SPACING_MS);

    seniorMatched += await enrichSeniorSquad(team.id, seniorPlayers);
    const u21Result = await enrichU21Squad(team.id, u21Players);
    u21Created += u21Result.created;
    u21Matched += u21Result.matched;

    await prisma.team.update({ where: { id: team.id }, data: { apiFootballSquadSyncedAt: new Date() } });
    processed.push(team.name);
  }

  return { clubsProcessed: processed, clubsSkipped: skipped, seniorMatched, u21Created, u21Matched };
}
