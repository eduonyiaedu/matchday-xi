import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
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
    try {
      await prisma.squadPlayer.update({
        where: { id: matchedId },
        data: {
          shirtNumber: entry.number ?? undefined,
          apiFootballId: entry.id,
          photoUrl: entry.photo ?? undefined,
        },
      });
      matched++;
    } catch (error) {
      // A young player can appear in BOTH API-Football's senior and U21 squad listings under the
      // same apiFootballId, while our own two name-matching passes (this one, and
      // enrichU21Squad's) can independently create/track them as two separate SquadPlayer rows —
      // one genuinely senior, one still tagged U21 from before their call-up. Stamping the same
      // apiFootballId onto this row then collides with the unique constraint on the other row.
      // Skip rather than crash: losing this one player's shirt-number refresh for a run is far
      // better than this row's failure aborting the whole team (and, since a thrown error here
      // stops apiFootballSquadSyncedAt from ever being set, permanently blocking every other team
      // queued behind it — confirmed live, this exact gap left the sync stuck on one team for 11
      // days). Same "catch P2002, treat as already-handled" pattern already used below in
      // enrichU21Squad's create() call, now applied to both update() calls too.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }
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

    // Check the stable apiFootballId first — name matching is fuzzy and can miss a player it
    // already created on a previous run (whitespace/diacritic drift, matcher threshold), which
    // would otherwise try to create a second row with the same apiFootballId and hit the unique
    // constraint. The id, once seen, is authoritative; name matching is only for the first sighting.
    const existingByApiFootballId = await prisma.squadPlayer.findUnique({
      where: { apiFootballId: entry.id },
      select: { id: true, squadTier: true },
    });
    if (existingByApiFootballId?.squadTier === "SENIOR") continue; // already a senior player, skip
    const existingU21Id = existingByApiFootballId?.id ?? matchPlayerName(entry.name, u21Rows);
    if (existingU21Id) {
      try {
        await prisma.squadPlayer.update({
          where: { id: existingU21Id },
          data: {
            shirtNumber: entry.number ?? undefined,
            apiFootballId: entry.id,
            photoUrl: entry.photo ?? undefined,
          },
        });
        matched++;
      } catch (error) {
        // Name-matched (not id-matched) branch — the findUnique above confirmed no row held
        // entry.id at read time, but this job also runs from an admin button that can overlap
        // the cron, so a concurrent run can still have claimed it in between. Same "skip, don't
        // abort the whole team" reasoning as enrichSeniorSquad's update, above.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
        throw error;
      }
      continue;
    }

    try {
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
    } catch (error) {
      // This job also runs from an admin "sync now" button, so it can overlap with the scheduled
      // cron — both can read the same "not yet created" state and race to create this player,
      // and the loser hits the unique constraint here. The winner already created an equivalent
      // row, so treat it the same as a check that a concurrent run had already recorded.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }
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
  const failed: { team: string; error: string }[] = [];

  for (const team of teams) {
    const ids = API_FOOTBALL_CLUB_TEAM_IDS[team.externalId];
    if (!ids) {
      skipped.push(team.name);
      continue;
    }

    // Isolate each team — an unanticipated failure here (an API outage, an account suspension, a
    // name-matching edge case neither update() catch above anticipated) used to throw straight out
    // of this loop, which not only aborted the run but also meant apiFootballSquadSyncedAt was
    // never set for the failing team. Since teams are processed oldest-synced-first, that team
    // then stayed permanently first in line, silently blocking every other team queued behind it
    // too — confirmed live, this stuck the whole pipeline on one team for 11 days. Catching here
    // means one team's failure no longer stops the rest of the batch from being refreshed.
    try {
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
    } catch (error) {
      failed.push({ team: team.name, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // Still surface a failure at the JobRun level if anything went wrong — per-team isolation must
  // not silently swallow a systemic problem (e.g. the whole API-Football account being suspended)
  // just because it didn't crash the process.
  if (failed.length > 0) {
    throw new Error(
      `${failed.length} club(s) failed: ${failed.map((f) => `${f.team} (${f.error})`).join("; ")}. ` +
        `Succeeded: ${processed.join(", ") || "none"}.`,
    );
  }

  return { clubsProcessed: processed, clubsSkipped: skipped, seniorMatched, u21Created, u21Matched };
}
