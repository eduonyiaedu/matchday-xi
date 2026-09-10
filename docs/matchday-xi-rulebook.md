# Matchday XI — Official Rulebook (v2.1, Investor/MVP Build)

## 1. Overview
Matchday XI is a football lineup-prediction platform. Users pick a favorite Premier League club, guess the starting XI before it's officially confirmed, and are scored automatically the moment the real lineup drops. Free to play at the core; monetization layered on top (see Section 12, currently roadmap-only).

## 2. Accounts & Team Selection
- One favorite team per user, selected from all 20 current Premier League clubs.
- Squad lists are pulled live from the sports data API, not hardcoded, so they stay current through transfer windows.
- **Team selection is locked once a user submits their first lineup prediction.** Before that first submission, the user may freely change their selected team. After it, the team is permanent for that account — no switching, to keep leaderboard history and team identity unambiguous.

## 3. Competitions Covered
- Premier League (all 38 matchweeks)
- FA Cup — Premier League clubs' fixtures only
- EFL Cup (Carabao Cup) — Premier League clubs' fixtures only

## 4. Lineup Format
- Every prediction (and the official lineup it's scored against) is exactly 11 players: **1 Goalkeeper + 10 outfield players.**
- Only players tagged Goalkeeper may fill the GK slot.
- The 10 outfield slots are freely assigned — users may place any combination of defenders, midfielders, and forwards into any of the 10 outfield positions, unconstrained by their tagged position.
- Default displayed formation is **1-4-4-2**, purely as a visual starting layout; it does not restrict selection.

## 5. Deadlines & Locking
- Locking is automatic: **2 hours before actual kickoff**, driven by live fixture data.
- No manual locking, no edits permitted after lock under any circumstance.

## 6. Official Lineup Feed (Automated)
- Fixture schedules and kickoff times are pulled from **football-data.org** (free tier: fixtures, results, standings).
- Official lineups are pulled from **API-Football** (free tier: includes lineup data).
- Lineup-check job runs on a bounded retry window starting ~75 minutes before kickoff, checking every ~10 minutes until a lineup is found (typically resolves by T-60 to T-70), rather than continuous polling — this keeps usage well within both providers' free-tier request caps.
- Scoring is triggered automatically the moment the official lineup is detected.
- The lineup used for scoring is the final confirmed XI at kickoff; a late pre-kickoff change supersedes an earlier announcement.

## 7. Scoring
- **+1 point** per predicted player who appears in the official starting XI, regardless of slot/position.
- **+3 bonus points** for an exact full-XI match (all 11 correct).
- No points for substitutes or unused players.
- No captain/multiplier mechanic (evaluated and explicitly removed from scope).

## 8. Leaderboards
- **Global leaderboard** — all users, ranked by cumulative season points.
- **Per-team leaderboards** — users ranked only against other fans who selected the same favorite team (e.g. Arsenal fans vs. Arsenal fans).
- Both leaderboards publicly display each user's **number of Perfect XI predictions**, alongside total points.
- Per-user history view of past matchday predictions and results.

## 9. Prizes (Free Tier)
- **Monthly prize:** no longer top-scorer-based. Instead, a **random draw** among users who, in that calendar month, (a) submitted a prediction for every matchday their team played, **and** (b) logged into the app every day of that month.
- **Daily login streak** is tracked per user to support the above (and future engagement features).
- **End-of-season prizes:** grand prize for #1 on the season-long global leaderboard, plus separate 2nd and 3rd place prizes.
- Tiebreaker (for ranking/prize purposes): (1) number of Perfect XIs, then (2) earliest account creation date.

## 10. Edge Cases
- **Postponed/abandoned matches:** matchday voided, no points awarded either way.
- **Duplicate accounts:** disqualifies the user from prize eligibility (points may still accrue but prizes are forfeited).
- **One account per person**, enforced at the fair-play level.

## 11. Platform
- Built and launched as a **web app (installable PWA)** — full-screen, home-screen-installable on iOS and Android via browser "Add to Home Screen," no app store submission required at MVP stage.
- Native app store submission (iOS/Android) is a deliberate later-phase decision — deferred pending real user traction and, if the paid features are involved, regulatory clearance (see Section 12).

## 12. Paid Features — ROADMAP ONLY, NOT LIVE IN THIS BUILD
Everything in this section is to be built as **disabled / "Coming Soon"** in the current MVP. No real payment processing, entry collection, or payout logic goes live until Nigerian gaming-law licensing (or an alternative compliant structure) is confirmed with qualified legal counsel.

### 12a. Tiered Global Prize Pools
- Paid entry tiers (illustrative, not final): ₦1,000 / ₦10,000 / ₦100,000, each with its own separate pool and leaderboard.
- Payout model: hybrid guaranteed-minimum + scaling pool — a committed minimum prize, topped up by accumulated entries once a funding threshold is crossed; typically 70-85% of entries to the prize pool, remainder to platform costs/margin (exact split TBD).
- Eligibility to win (regardless of point ranking): must have submitted a prediction for every matchday their team played that season, **and** achieved a minimum of 10 Perfect XIs over the season.

### 12b. Private Competitions ("Private Leagues")
- **Creation:** limited to subscribed users; each subscriber may create **exactly one** private league.
- **Joining:** subscribers only (not free-tier users). A user requests to join; the creator approves or denies. Once approved, the user gains access immediately if the league is free, or after payment if it's paid.
- **Discovery:** private leagues are searchable by name; joining still requires creator approval regardless of how the league was found.
- **Team rules:** the creator sets, at creation, one of: (a) members may pick any team from any league, (b) members may pick only from one specified league, or (c) all members must use the same single team.
- **Time window:** creator sets a custom active period (e.g. one month, or a specific run of matchdays) — does not have to match the full season.
- **Rules are immutable once the league is created**, and must be visible to all members at all times.
- **Scoring is entirely separate:** private-league predictions are a distinct submission from the user's global/team-leaderboard prediction. Private league points/results do **not** feed into the global or per-team leaderboards, and vice versa.
- **Membership cap:** none. Creation cap: one private league per subscriber.
- **Monetization (paid leagues only, roadmap):** creator sets an entry fee (or makes the league free). Revenue split on paid entries: **15% platform, 15% creator, 70% prize pool.** The full split is disclosed to the creator at creation time; members see only the resulting prize pool amount, not the platform/creator cuts.
- The free version of this feature (no entry fee) is **not** subject to the same regulatory blocker and may be considered for earlier build — flag this explicitly when scoping build phases with Claude Code.

## 13. Version History
- v1.0 — Initial 3-team demo rulebook (Arsenal, Man City, Liverpool). Captain/multiplier mechanic built, then removed.
- v2.0 — Full MVP scope: all 20 Premier League clubs + FA Cup/Carabao Cup fixtures, 1-GK+10-outfield free-form format, automated 2-hour lock, automated live lineup feed (football-data.org + API-Football), per-team leaderboards with public Perfect XI counts, redefined monthly prize + login streak tracking, tiered global prize pools (roadmap), private competitions (roadmap for paid tier, free tier buildable now). Web app/PWA first; native app store submission deferred.
- v2.1 — Clarified team selection: locked permanently once a user submits their first prediction; free to change before that.
