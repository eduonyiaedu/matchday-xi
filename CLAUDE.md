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

## Other gotchas worth knowing before you hit them yourself

- A long-running `next dev` process does **not** pick up a regenerated Prisma client after
  `prisma db push` + `generate` — it needs a hard restart, or every query referencing a new
  field/model throws a validation error that looks like a real bug but isn't.
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
