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

## A recurring bug class: cron + admin-button dual triggers

Several service functions run from both a scheduled cron route and an admin "do it now" button in
`/admin` (e.g. `squad-enrichment-sync.ts`, `lineup-scoring.ts`, `standings-sync.ts`). When both fire
close together, a naive implementation lets them race. Two fix patterns are established here,
depending on what's racing:
- **A non-atomic check-then-create against a row with a real unique constraint** → convert to a
  real Prisma `upsert`, or catch `P2002` on the `create()` (don't parse `error.meta.target` to
  distinguish constraint types — it's not a reliable column-array; re-query by the actual unique
  field instead).
- **A read-then-write against a value with no unique constraint to catch the collision**
  (denormalized counters, "does this logical row already exist" checks) → wrap the whole
  read-decide-write sequence in one `prisma.$transaction`, with a Postgres advisory lock
  (`pg_advisory_xact_lock(hashtext(key))`) as the first statement, keyed on whatever logical
  resource must be serialized. Keep any real network I/O (push sends, external API calls) *outside*
  the transaction, executed only after it commits — a delivery failure shouldn't roll back state
  that already correctly committed.
- When auditing or touching a service function, check whether it's invoked from more than one
  entry point (grep for its name across `src/app/api/cron/**` and `src/app/**/admin/**`) before
  assuming "it's just a cron, it won't overlap with anything."

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
