@AGENTS.md

# Working on Matchday XI — notes for whoever (human or AI) picks this up next

The founder is a solo, non-technical operator. Explain things plainly, verify live before
declaring anything done, and don't make destructive or scope-expanding calls without asking first.

## Infrastructure map (verify against the live services if anything here seems stale)

- **Vercel** — project `matchday-xi`, project id `prj_qY1nWWrusonBUmFPMtcSxkgYEodP`, team id
  `team_wUzCBJnmaSXg2wV04k16TeRq`. Hosts the deployed app; has its own copy of every secret in
  `.env.example`, configured directly in the Vercel dashboard (not synced from any local file).
- **Supabase** — project ref `bqvvilwxxlzruqpnxwbx`. Postgres + Auth. Every table needs
  `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` the moment it's created — access is enforced at the
  API layer, not via RLS policies, so "RLS enabled, no policy" INFO-level advisor notices are
  expected and not a bug; what's NOT expected is a table with RLS left disabled entirely.
- **Real cron scheduler is cron-job.org, not GitHub Actions.** GitHub Actions' `schedule` trigger
  was tested and found unreliable for this app's time-critical jobs (a 5-minute schedule actually
  fired every 1–5 hours on this repo) — confirmed by comparing configured vs. actual fired
  timestamps, not just "did it run once." The real 5-minute cadence (lock-sweep, notify-sweep,
  check-lineups) and the once-daily jobs (daily-rollup, matchday-notify) are scheduled directly
  against `console.cron-job.org` via its REST API (`api.cron-job.org`), hitting the same
  `/api/cron/*` routes the workflows call manually. `.github/workflows/*.yml` are kept
  `workflow_dispatch`-only for manual re-testing — do not re-add a `schedule:` trigger there. The
  6-hourly fixture/squad/standings sync is the one exception still actually scheduled via GitHub
  Actions, since hour-ish drift doesn't matter for it.
- **cron-job.org's API key is never stored anywhere in this repo or in Claude's memory** — it's
  provided fresh in chat by the founder each time a cron job needs to be added or changed there.
- **`JobRun.details`, not `.error`** — an easy mistake when querying job failures ad hoc.

## The recurring "check the site for any other issues" audit

The founder asks this periodically and expects the same thorough pass every time, not a skim —
every round so far has found genuine, previously-unnoticed bugs. Run all of these, not just
whichever turned something up last time:

1. Vercel `get_runtime_errors` for the project above — check whether error timestamps predate or
   postdate the most recent relevant fix before treating an old error group as still-active.
2. Query the `JobRun` table for recent failures AND the most-recent-run-per-job-name (a job that's
   silently stopped firing entirely won't show up in a "recent failures" query).
3. Supabase advisors (`get_advisors`) for both `security` and `performance` types.
4. Delegate a fresh code-review agent scoped to whatever code hasn't had a dedicated review pass
   yet — tell it explicitly what prior rounds already covered so it doesn't re-tread. Verify its
   top 2-3 findings personally (read the actual code) before fixing or reporting.
5. For a confirmed concurrency bug, prove the fix under real concurrent calls (e.g. `Promise.all`
   of two invocations against disposable test data) rather than just reasoning about it — this has
   caught fixes that looked right but weren't, more than once.
6. Live-verify user-facing fixes with a disposable test account (`npm run create-test-user`),
   clean up the test data (both the Prisma rows and the Supabase auth user) afterward.
   **There is only one database — live verification writes into production**, and the live
   cron jobs act on whatever they find there. Confirmed real (2026-09-22/23): LOCKED test
   fixtures got picked up by the 5-minute jobs, which called API-Football, emailed the founder
   "lineup fetch failed" alerts, and sent a "fixture locked" push to every fan of both clubs
   (luckily none were real users at the time). So: **every disposable test fixture must use a
   negative `externalId`** (real football-data.org ids are always positive), and every scheduled
   job's fixture query spreads `REAL_FIXTURES_ONLY` from `src/lib/real-fixture.ts` — any new job
   that queries fixtures must add it too. Also remember `/leagues` lists *every* private league
   to *every* user, so a leftover test league is publicly visible — sweep for test users, leagues,
   and fixtures at the end of every round, not just the ones the current script created.
7. Always ask before committing/pushing, even after a large multi-fix round.
8. Before wrapping up, check whether anything learned this round is durable and non-obvious — if
   so, propose folding it into this file too, the same way step 7 asks about committing. Confirmed
   explicitly by the founder (2026-09-17): offer this every round, since this file travels with the
   repo across machines/sessions and Claude's own session memory doesn't.

## A recurring bug class: two routes/jobs racing on the same row

Several service functions run from both a scheduled cron route and an admin "do it now" button in
`/admin` (e.g. `squad-enrichment-sync.ts`, `lineup-scoring.ts`, `standings-sync.ts`). When both fire
close together, a naive implementation lets them race. **The pattern isn't limited to cron vs.
admin-button, though** — any two routes/jobs that can write the same row concurrently qualify. A
confirmed real example: `/api/leagues/[id]/join` (a user submitting/retrying a join request) vs.
`/api/leagues/membership` (the league creator approving it) — the join route read membership
status, then unconditionally upserted `PENDING` if not already `APPROVED`; a join retry racing a
concurrent approval could read stale (pre-approval) state and revert the just-approved membership,
silently swapping the "permanent" team back. Fixed by giving both routes the same advisory lock
keyed on `(leagueId, userId)`, so whichever acquires it first fully completes before the other's
transaction even reads. Three fix patterns are established here, depending on what's racing:
- **A non-atomic check-then-create against a row with a real unique constraint** → convert to a
  real Prisma `upsert`, or catch `P2002` on the `create()` (don't parse `error.meta.target` to
  distinguish constraint types — it's not a reliable column-array; re-query by the actual unique
  field instead). **This applies to `update()` calls too, not just `create()`** — a real incident
  (`squad-enrichment-sync.ts`, confirmed live) crashed on exactly this: an `update()` stamping a
  unique-constrained field (`apiFootballId`) collided with a different row that already held that
  value, and because only the `create()` path had a `P2002` catch, the `update()` path took down
  the whole run. Audit both when checking a service function for this class of bug.
- **A read-then-write against a value with no unique constraint to catch the collision**
  (denormalized counters, "does this logical row already exist" checks) → wrap the whole
  read-decide-write sequence in one `prisma.$transaction`, with a Postgres advisory lock
  (`pg_advisory_xact_lock(hashtext(key))`) as the first statement, keyed on whatever logical
  resource must be serialized. Keep any real network I/O (push sends, external API calls) *outside*
  the transaction, executed only after it commits — a delivery failure shouldn't roll back state
  that already correctly committed.
- **A check-then-write race where the guarded field has no unique constraint but IS itself a
  natural single-column guard** (e.g. `User.favoriteTeamLockedAt`, checked-then-set once) doesn't
  need a full advisory-lock transaction — a single atomic conditional update does it: `prisma.x
  .updateMany({ where: { id, guardColumn: null }, data: {...} })`, then branch on the returned
  `count` (0 means someone else already won the race). Cheaper than a lock when the "collision"
  condition is expressible directly in a `WHERE` clause. Used in `teams/change/route.ts` to close a
  race against `predictions/route.ts`'s first-prediction lock.
- When auditing or touching a service function, check whether it's invoked from more than one
  entry point (grep for its name across `src/app/api/cron/**` and `src/app/**/admin/**`) before
  assuming "it's just a cron, it won't overlap with anything."
- **Per-item isolation in a batch loop (try/catch around each item so one failure doesn't abort
  the rest) must still surface an aggregate failure at the end if anything failed** — don't let the
  loop return normally and report success just because it didn't crash. The same real incident
  above also showed why: the failing item's failure silently never marked itself done, which left
  it permanently first in an "oldest processed first" queue and blocked every other item queued
  behind it — for 11 days, undetected, because the job kept reporting `SUCCESS`. Collect per-item
  errors and `throw` a summary once the loop finishes if any occurred, so `JobRun` correctly shows
  `FAILURE` and it's actually visible.
- **A best-effort notification (never throws, so it can't break its caller) should still
  distinguish "not configured" from "a real send failed"** — treat the former as handled (no
  retry, since retrying a missing API key does nothing), but let the caller know the latter so it
  can retry rather than permanently marking something "handled" that was actually just lost. Return
  a boolean (or similar) rather than swallowing everything into `void`. Both `lib/notify.ts` and
  `lib/push.ts` follow this now — if a new best-effort sender gets added, match it.
- **A "do this once" step must keep retrying until it has succeeded — never hang it off "did this
  run just create the row?"** That condition is true for exactly one run, so if that run fails
  (a timeout, a DB blip, the function killed at its time limit) the step is silently skipped
  forever. Confirmed by review 2026-09-23 on the season rollover (clearing club locks + pushes
  hung off `recordSeason()` returning "new") and the season export email (flag set before the
  send, so a killed function left it showing "Emailed" with nothing sent). Pattern now used by
  `Season.rolloverClaimedAt/rolloverDoneAt` (lib/new-season.ts) and
  `Season.exportEmailClaimedAt/exportEmailedAt` (lib/season-export.ts): an atomic claim
  (`updateMany` where not done and the claim is null *or older than ~10 min*, so a killed run's
  claim can be retaken), mark done only after the work succeeds, release the claim on failure.
- **`sendPushToUsers` (lib/push.ts) queues, it doesn't send.** It writes one `PushOutbox` row per
  device and returns true once queued (false only if the queue write itself failed); delivery
  happens in `drainPushOutbox` — started in the background via `after()` right away, and again on
  every 5-minute notify sweep — at most 25 devices at once, in batches claimed with `FOR UPDATE
  SKIP LOCKED`. The queue handles everything callers used to: expired devices (410/404) are
  deleted, other failures retried with back-off up to 5 times, anything older than 2 hours dropped
  (a late "lock in 30 minutes" is worse than none). So a caller's `false` no longer means "a device
  failed" — don't build retry logic on it beyond clearing its own dedup flag. Built for sends to
  tens of thousands of fans, which used to be one `Promise.all` in one 60-second function.
- **For anything that notifies users, keep "who gets what" separate from actually sending.** The
  founder's phone is the only real device with push enabled, and the database is shared with live
  verification — so calling a real sender in a test pings the founder. `lib/prize-notify.ts`
  splits each announcement into a `plan…Pushes()` function (returns recipients + payloads, sends
  nothing) and a `notify…IfNeeded()` function (atomic claim, then sends the plan). Tests verify the
  plan — recipients, exclusions, wording — without any push leaving the server. New notification
  code should follow the same split.
- **A lock scoped to a narrower resource can't safely decide something that spans a wider shared
  resource.** `lineup-scoring.ts`'s `applyOfficialLineup` locks on `(fixtureId, teamId)` — correct
  for preventing two calls for the *same* team from double-counting points, but a home-team call
  and an away-team call take two *different* lock keys and can run fully concurrently. The
  "are both sides done → flip the fixture to SCORED" check used to be computed from inside that
  same per-team-locked transaction — under READ COMMITTED, a genuinely concurrent home+away call
  (confirmed real: exactly the admin-manual-entry-while-a-cron-run-is-in-flight scenario this file
  already describes) could have both calls see only their own uncommitted row and neither ever
  observe "both done," silently stranding the fixture forever despite every prediction being
  scored correctly. Fixed by giving that decision its own separate transaction, locked on a
  fixture-wide key, run only after both individual per-team transactions have committed. The
  general rule: if a decision depends on state written under multiple different lock keys, that
  decision needs its own lock on the resource it actually spans — not a decision made while
  holding a narrower one.

## Free-tier data provider limits (confirmed live, not assumed — re-verify if plans may have changed)

- **football-data.org** free tier: standings (`/competitions/PL/standings`) and a season-long
  goals+assists leaderboard (`/competitions/PL/scorers`) both work for the *current* season. A
  single match's detail endpoint has no goal-event breakdown at all, even for a finished match.
  `score.fullTime` on any match object is a **live** score, not a final one, until
  `match.status === "FINISHED"` — writing it unconditionally will persist an in-play score and
  later display it as if final.
- **API-Football** free tier: `/fixtures?date=X` (no season param) only works within a ~3-day
  rolling window around today — fine for the lineup-check use case, useless for historical dates.
  Any endpoint taking a `season` param is hard-blocked for the current season on the free plan.
- **Net effect**: no free path to per-match goal-scorer/assist events for the current season on
  either provider — a season-long aggregate is the ceiling without a paid tier upgrade.
- **API-Football request caps (free tier: 100/day, 10/minute) are enforced in code, before every
  request**, by DB-backed counters in `src/lib/api-football/client.ts` (`ApiUsageCounter` rows):
  90/day, and 3 per UTC calendar minute — 3 rather than 9 because any 60-second span touches at
  most 3 calendar minutes, which guarantees ≤9 in any rolling minute however bursts line up. Both
  are env vars (`API_FOOTBALL_DAILY_REQUEST_CAP`, `API_FOOTBALL_PER_MINUTE_CAP`) to raise after a
  paid-tier upgrade. Never call API-Football except through that client. A refused request throws
  `ApiFootballBudgetError` before anything is sent: `window: "minute"` is routine back-pressure —
  callers defer to their next run (lineup-check hands the fixture's attempt back; squad
  enrichment leaves the club unstamped) and must NOT treat it as a failure or alert on it.
  Worst realistic day (10 simultaneous kickoffs, all 20 clubs followed) is ~31 lineup requests
  (one shared `/fixtures?date=` lookup + ≤3 lineup checks per match) + 6 squad-enrichment = ~37.
- **To check whether the API-Football account itself is working, call `/status`** — it doesn't
  count against the daily request quota. Confirmed 2026-09-23: the account was **suspended**
  (every endpoint, `/status` included, answers `errors.access: "Your account is suspended…"`),
  which surfaced only as the daily SYNC_SHIRT_NUMBERS job failing. While suspended, automated
  lineup fetching fails for every match and each one falls back to manual entry + an alert email.
- **Match API-Football data to ours by club ID, never by name.** football-data.org and
  API-Football use different club names ("Arsenal FC" vs "Arsenal") and unrelated team-id spaces;
  use `src/lib/api-football/match.ts` (backed by the static `API_FOOTBALL_CLUB_TEAM_IDS` table).
  Name/ID comparisons across the two providers silently never matched — confirmed 2026-09-23,
  automated lineup fetching had never once resolved a fixture before this was fixed.

## Other gotchas worth knowing before you hit them yourself

- **Anything scoped to one season (prizes, season rankings, past leaderboards) must be computed
  from that season's own match data** — `lib/seasons.ts`'s `seasonStandings()` sums
  `pointsAwarded` of global predictions for real fixtures kicking off within the season's dates.
  Every season the standings sync sees is recorded in the `Season` table (never overwritten).
  `User.totalPoints` / `perfectXiCount` are the *current* season's totals only (founder decision
  2026-09-23: the global leaderboard resets each season, past seasons viewable via a dropdown) —
  recomputed at rollover and nightly by `recomputeCurrentSeasonTotals()` under an exclusive
  advisory lock that scoring/voiding take shared.
- **A closed season is view-only** (founder's rule, 2026-09-23): once a newer season exists AND the
  old season's winners are confirmed, its lineups can't be entered/corrected and its fixtures can't
  be voided. The rule lives in one place — `fixtureSeasonStatus()` / `isSeasonClosed()` in
  lib/seasons.ts — and `applyOfficialLineup` / `voidFixtureAndReversePoints` throw
  `SeasonFrozenError` for a closed season (admin lineup route → 409; fixture sync skips it). A
  previous season *not yet confirmed* stays correctable on purpose (otherwise one unscored
  final-day match would make its prizes unconfirmable forever), but its points never touch
  User.totalPoints, which then holds the new season's totals. Anything new that changes a
  fixture's points must go through `fixtureSeasonStatus()` too. Closed seasons' final tables are
  saved once to `SeasonStandingSnapshot` and read from there.
- **"First time" rules must mean "first this season", not "first ever".** Club locks reset every
  season (founder decision 2026-09-23): at rollover `lib/new-season.ts` clears
  `favoriteTeamLockedAt`, pushes returning players, and Home asks "keep or change your club?"
  until they answer (`User.seasonClubConfirmedFor`) or predict. The prediction route used to lock
  only on a player's first prediction *ever* (`count === 0`), which would have left every
  returning player's club unlocked forever from season two on — caught before it shipped. Any new
  per-player "first X" check should be scoped to the season, or it silently stops working after
  season one.

- **A sync window that starts at "today" silently loses anything that finishes after its last
  run.** `fixture-sync.ts` asked football-data.org only for matches from today onward, so a match
  whose final whistle came after the day's last (drifting, 6-hourly) sync run never got its final
  score — confirmed real 2026-09-23 (Brentford vs Chelsea sat SCORED with no score). It now looks
  back `SYNC_LOOKBACK_DAYS` (7), and never *creates* a fixture whose kickoff has passed (that
  would start life SCHEDULED and send the lineup job after a finished match). Any new sync against
  an external source should likewise reach back a few days, not start at "now".
- **When anonymizing a deleted user, check every channel that still reaches them through a field
  you deliberately kept.** The purge keeps `favoriteTeamId` (so points stay on leaderboards), but
  the matchday/lock/notify jobs pick push recipients by `favoriteTeamId` — so a "deleted" user kept
  getting pushes until the purge also deleted their `PushSubscription` rows (confirmed by review,
  2026-09-23). `push.ts` also skips anyone with `deletionScheduledAt` set during the 30-day grace
  period. If a new outbound channel (email digests, etc.) is added, it needs the same treatment.
- **Supabase's `auth.admin.generateLink({ type: "magiclink" })` for an email with no login
  silently CREATES one** — so it can't be used to prove a login was deleted (it will "succeed" and
  leave a new stray auth user behind). Check deletion with `auth.admin.getUserById(id)` instead.

- **`ImageResponse` (next/og) defaults to `cache-control: public, immutable, max-age=31536000` in
  production** (and `no-store` in dev, so you won't see it locally). Any generated image whose URL
  can show different content over time MUST pass its own `headers: { "cache-control": ... }`.
  Confirmed real 2026-09-23: the share card URL shows the predicted lineup until the match is
  scored and the result after, so players who'd opened it at lock time kept the stale pre-score
  card from their browser cache. Fixed with short/longer `s-maxage` by state (cached on Vercel's
  CDN, so a viral card is drawn once) plus `cache: "no-cache"` on the in-app fetch.
- A long-running `next dev` process does **not** pick up a regenerated Prisma client after
  `prisma db push` + `generate` — it needs a hard restart, or every query referencing a new
  field/model throws a validation error that looks like a real bug but isn't.
- **A dev server launched via the in-app preview tool (`preview_start` with a command) runs
  sandboxed and can't make outbound HTTPS calls** — Postgres still works (public DB-backed pages
  render fine), but every Supabase auth call fails with `fetch failed`, so every signed-in request
  looks logged-out (pages 307 to `/login`, API routes 403). Confirmed live 2026-09-23. That's why
  `.claude/launch.json` is deliberately url-only: start `npm run dev` from a normal shell (in the
  background), then `preview_start` just attaches to `http://localhost:3000`.
- **Sign-up/log-in are CAPTCHA-protected (Cloudflare Turnstile, enabled 2026-09-23).** Supabase
  Auth rejects any email sign-up, password log-in or magic-link request without a passed Turnstile
  token (`captcha_failed`) — Google OAuth isn't affected. The public site key is built into
  `src/components/auth/turnstile-widget.tsx` for the two live hostnames only (localhost and
  preview deployments render no widget, so their email log-in forms fail against the same
  Supabase project — use Google or the admin-API session below); `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
  overrides it. The secret key lives only in Supabase → Authentication → Attack Protection, and in
  Cloudflare → Turnstile → "Matchday XI" (which also lists the allowed hostnames — add a new
  domain there *and* to `PRODUCTION_HOSTNAMES` when the app gets its own domain). The admin-API
  magic-link session below bypasses the CAPTCHA, so live verification is unaffected; never try to
  solve the widget in an automated browser.
- **Duplicate-account detection (prize fair play) — lib/account-trust.ts.** New accounts are
  auto-flagged (`isFlaggedDuplicate` + `flagReason`, out of prize contention, never blocked) for a
  throwaway inbox, the same inbox under another spelling (`normalizedEmail`), or turning up on a
  device another, older account already uses (`UserDevice`, from the proxy's random `mxi_device`
  cookie, recorded on every signed-in page load). Admins are never flagged, and a flag the founder
  clears on /admin sets `flagClearedAt`, which automatic checks always respect — never re-flag
  over it. Both `normalizedEmail` and `UserDevice` rows are personal data: the purge clears them.
- **Live-verifying signed-in flows without typing a password anywhere:** in a temp script under
  `scripts/`, call the Supabase admin API's `auth.admin.generateLink({ type: "magiclink", email })`
  for a disposable test account, then `verifyOtp({ token_hash: data.properties.hashed_token, type:
  "magiclink" })` on an `@supabase/ssr` `createServerClient` whose `setAll` collects cookies into an
  array — and send those as a `cookie:` header on `fetch` calls to the local dev server. Gotcha:
  `@supabase/ssr` writes the cookie from an auth-state listener that fires *after* `verifyOtp`
  resolves, so wait ~500ms before reading the array or it's empty and every request is rejected.
  An admin test account still needs its Prisma `User` row created directly with `role: "ADMIN"`.
- A sibling git worktree under `.claude/worktrees/*` can make `npm run lint`/`vitest run` report
  spurious massive error/test counts (the `.next/**` ignore glob only matches at the project root).
  Before treating a lint/test spike as real, check `git status --short` for anything under
  `.claude/worktrees/` and re-run scoped to `src/` only.
- `getOrCreateCurrentUser()` (`src/lib/auth.ts`) deliberately returns `null` — same as "not signed
  in" — for a Supabase session with no consent metadata and no existing User row, rather than
  auto-creating one, to avoid silently bypassing the Google-login consent interstitial. If you add
  a new caller, treat a `null` return as "not authenticated," never assume it always means that.
- The `design/` folder (`Matchday XI.dc.html`, `Handoff.dc.html`) holds the interactive mockup and
  implementation-handoff spec for a full visual redesign ("Floodlight") that has only been
  partially implemented so far — check `git log` for what's actually shipped before assuming the
  handoff doc describes the current UI.
- `src/lib/player-matching.ts`'s `normalizeName` strips Unicode NFD combining marks (handles
  precomposed accents like é/ü/ñ/ç fine), but letters that are historically distinct rather than
  "base letter + accent" — ø, đ, ł, æ, œ, ß, ð, þ — don't decompose that way and were silently
  *deleted* rather than transliterated (confirmed real: Martin **Ø**degaard normalized to
  "degaard"). There's an explicit transliteration map for these now; if a real player's name still
  fails to match, check whether their name uses a letter outside that map before assuming it's a
  provider-spelling difference. Hyphens are deliberately kept as part of a name token (not split
  into a space) so a compound surname like "Alexander-Arnold" doesn't truncate to just "Arnold"
  and risk matching an unrelated same-fragment player.
- **Raising a data volume that feeds into an existing `prisma.$transaction` can blow that
  transaction's own timeout, even though nothing about the transaction's code changed.**
  `standings-sync.ts`'s transaction did a sequential per-row team-upsert-then-create loop for
  every scorer; that was fine at a 20-scorer limit but hit the 20s timeout (confirmed live, P2028
  at ~20.1s) the moment the limit was raised to 500 (returning ~90 real rows) for the assists-list
  fix. Whenever a change increases how many rows flow into a loop inside a transaction, check
  whether the timeout still holds — don't assume "the transaction logic didn't change" means "the
  transaction is still fine." Fix pattern: pre-resolve anything cacheable/shared (here, team rows
  — standings and scorers reference the same 20 PL clubs, so resolving them once outside the
  transaction turned ~110 potential upserts into ~20) and replace a per-row loop with a single
  `createMany` wherever the rows don't need individual per-row branching logic.
  **Rows that DO need different values can usually still be written in groups:** inside a
  transaction, bucket rows by the value they'll receive and issue one `updateMany` per bucket, so
  the statement count stays constant as data grows instead of scaling per row. `lineup-scoring.ts`
  does this — a score depends only on the correct-pick count, so predictions collapse into ≤12
  outcome groups; the old per-prediction loop (~13 statements each) was confirmed live to hit the
  20s timeout at 1,200 predictions for one team, while the grouped version (~35 statements total)
  scored the same data correctly in ~5s even from a 110ms-round-trip dev machine.
