/**
 * Where-clause fragment every scheduled job adds to its fixture queries. There's one database
 * shared by production and live verification, and disposable test fixtures are created with a
 * NEGATIVE externalId (real football-data.org match ids are always positive) — without this the
 * live 5-minute crons act on them like real matches: calling API-Football, emailing lineup
 * alerts, and pushing "fixture locked" nudges to real fans of the two clubs (confirmed happening
 * 2026-09-22/23, luckily with no real recipients at the time).
 */
export const REAL_FIXTURES_ONLY = { externalId: { gt: 0 } };
