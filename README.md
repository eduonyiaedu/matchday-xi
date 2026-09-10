# Matchday XI

A football lineup-prediction app: pick a Premier League club, guess the starting XI before it's
confirmed, get scored the moment the real lineup drops. See [docs/matchday-xi-rulebook.md](docs/matchday-xi-rulebook.md)
for the full rules this app implements.

This README is written for a solo, non-technical founder deploying this for the first time. Follow
it top to bottom — later steps depend on earlier ones.

## Stack

- **Next.js 16** (App Router, TypeScript) — one codebase for pages + API routes, deployed on **Vercel**.
- **Supabase** — hosted Postgres database + auth (email/password, magic link, Google).
- **Prisma 7** — the database schema lives in [prisma/schema.prisma](prisma/schema.prisma), readable as documentation.
- **GitHub Actions** — runs the scheduled jobs (locking predictions, checking for lineups, scoring) every 5 minutes, for free.
- **football-data.org** and **API-Football** — the two external football data providers (both free tier).

Nothing here costs money at MVP scale: Vercel's Hobby plan, Supabase's free tier, and both data
providers' free tiers are all sufficient.

## 1. One-time setup

### 1a. Create a Supabase project

1. Go to [supabase.com](https://supabase.com), create a free account and a new project.
2. In **Project Settings → Database → Connection string**, copy the **Session pooler** connection
   string (port `5432`, not the "Transaction pooler" on 6543 — this app doesn't need transaction
   pooling and it would break some queries). This is your `DATABASE_URL`.
3. In **Project Settings → API**, copy the **Project URL** (`NEXT_PUBLIC_SUPABASE_URL`), the
   **anon public key** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`), and the **service_role key**
   (`SUPABASE_SERVICE_ROLE_KEY` — keep this one secret, never put it in client-side code).
4. In **Authentication → Providers**, enable **Email** (on by default) and, if you want "Continue
   with Google" to work, enable **Google** and follow Supabase's prompt to create a Google OAuth
   client.
5. In **Authentication → URL Configuration**, add your site URL (e.g. `http://localhost:3000` for
   now, your real domain once deployed) and `<that-url>/auth/callback` as a redirect URL.

### 1b. Get free API keys

- **football-data.org**: register at [football-data.org/client/register](https://www.football-data.org/client/register) → `FOOTBALL_DATA_API_KEY`.
- **API-Football**: register at [api-football.com](https://www.api-football.com/) (via the RapidAPI
  or direct dashboard) → `API_FOOTBALL_KEY`.

### 1c. Set your local environment

Copy `.env.example` to `.env` and fill in everything from steps 1a/1b, plus a random
`CRON_SECRET` (any long random string — this is what proves a request to `/api/cron/*` really
came from your scheduled jobs and not a stranger on the internet).

```bash
cp .env.example .env
```

### 1d. Install dependencies and set up the database

```bash
npm install
npm run db:push      # creates all the tables in your Supabase database from prisma/schema.prisma
npm run db:seed      # optional: adds a couple of fake teams/players/fixtures so you can try the app immediately
```

`db:push` is used instead of `prisma migrate` on purpose — Supabase's default database role can't
create the "shadow database" that `migrate` needs, and at this stage of the project a full
migration history isn't worth the setup friction. If you outgrow this later, a real engineer can
switch to `prisma migrate` in an afternoon.

### 1e. Run it locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign up, pick a team, and — if you ran
`db:seed` — you'll have one fake fixture to build a prediction against.

## 2. Deploying

### 2a. Push to GitHub, then deploy on Vercel

1. Push this repo to a new GitHub repository.
2. Go to [vercel.com/new](https://vercel.com/new), import that repository.
3. In the Vercel project's **Environment Variables**, add every variable from your `.env` file
   (same names, same values) — `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FOOTBALL_DATA_API_KEY`,
   `API_FOOTBALL_KEY`, `CRON_SECRET`. Set `APP_BASE_URL` to your real Vercel URL (you'll know it
   after the first deploy, e.g. `https://matchday-xi.vercel.app`) — you can add it after the first
   deploy and redeploy once you know the URL.
4. Deploy. Update your Supabase **Authentication → URL Configuration** to use the real deployed
   URL instead of `localhost`.

### 2b. Turn on the scheduled jobs (GitHub Actions)

The app needs two things to happen automatically: syncing fixtures/squads periodically, and
checking for + scoring official lineups every few minutes. Both run via the workflows already in
[.github/workflows/](.github/workflows/) — you just need to give GitHub the secrets they call with:

1. In your GitHub repo, go to **Settings → Secrets and variables → Actions**.
2. Add two repository secrets:
   - `APP_BASE_URL` — your deployed Vercel URL (e.g. `https://matchday-xi.vercel.app`, no trailing slash).
   - `CRON_SECRET` — the exact same value you set in Vercel's environment variables.
3. That's it — the workflows are already scheduled (every 6 hours for fixtures/squads, every 5
   minutes for the lock/lineup-check/scoring pipeline) and will start running on their own. You
   can watch them under the repo's **Actions** tab, or trigger one manually with the "Run workflow"
   button to test immediately after setup.

## 3. Day-to-day

- **`/admin`** (visible only to users with the `ADMIN` role — see below) shows recent job runs and
  lets you manually re-trigger a fixture/squad sync, and flag a user's account as a fair-play
  duplicate (disqualifies them from prizes without touching their points, per the rulebook).
- **To make yourself an admin**: open the Supabase dashboard's Table Editor, find your row in the
  `User` table, and change `role` from `USER` to `ADMIN`.
- **If a fixture shows up under "needs manual review"** on the admin page, it means the lineup
  job couldn't find an official lineup by kickoff — check API-Football directly for that match and
  investigate (this should be rare).

## 4. What's deliberately not live yet

Per the rulebook, all paid features are UI-only "Coming Soon" placeholders with **no real payment
logic anywhere in this codebase**:

- Tiered global prize pools (₦1,000 / ₦10,000 / ₦100,000 entry tiers).
- Paid entry to private leagues.

Private leagues themselves (create, search, join-approve, separate scoring) are fully live in
their **free** form. Private league creation is currently open to any logged-in user — the
rulebook ties it to a "subscribed user" tier that doesn't exist yet in this build; there's a
`// TODO` marking exactly where to add that gate once a subscription tier ships
(`src/app/api/leagues/route.ts`).

## 5. Testing

```bash
npm test         # unit tests for the scoring and player-matching logic — the highest-stakes code in the app
npm run lint      # code style checks
npx tsc --noEmit  # type checks
```

There's no automated end-to-end test suite yet. To manually verify the full prediction → lock →
score pipeline without waiting for a real match or burning API quota, use `npm run db:seed` (kicks
off ~3 hours from now) and then, once you're within its lineup-check window, POST to
`/api/cron/check-lineups` yourself with the `Authorization: Bearer <CRON_SECRET>` header — though
note this will genuinely call API-Football, so for a purely offline test you'd want to insert a
fake `OfficialLineup` row directly via Prisma Studio (`npm run db:studio`) instead and watch the
`Prediction` rows get scored on your next call to that route.

## 6. Project structure

```
prisma/schema.prisma          All data models, one file, documented inline
src/app/                      Pages (App Router) and API routes
src/app/(app)/                Authenticated app pages (fixtures, predict, history, leagues, prizes)
src/app/(public)/             Public pages (leaderboards) — no login required
src/app/api/cron/             The scheduled-job endpoints GitHub Actions calls
src/lib/services/             The actual automation logic (fixture sync, lineup check + scoring, lock sweep)
src/lib/football-data/        football-data.org API client
src/lib/api-football/         API-Football API client
src/components/               UI components, grouped by feature
.github/workflows/            The GitHub Actions cron schedules
```
