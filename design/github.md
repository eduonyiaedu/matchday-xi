repo: eduonyiaedu/matchday-xi
branch: main

## Last sync
date: 2026-09-12T12:46:00Z

### Updated in this project
- Read the live app and full `src/` tree as the baseline for a visual redesign ("Floodlight" direction).
- Built `Matchday XI.dc.html` — navigable redesign of landing, onboarding, home, prediction builder, scored view, Perfect XI takeover, share cards, leaderboard, icon/splash, edge states, desktop.
- Built `Handoff.dc.html` — token block for `globals.css`, shadcn variant specs, Tailwind theme mapping, per-file screen map, new-data requirements.
- No repo files were modified; routes and schema are unchanged except where the handoff flags new data.

## Screen map
| Screen | Built from |
|---|---|
| Landing | `src/app/(marketing)/page.tsx` |
| Onboarding | `src/app/onboarding/select-team/page.tsx`, `src/components/team/team-picker.tsx` |
| Home (+ new user) | `src/app/(app)/home/page.tsx`, `src/app/(app)/layout.tsx` |
| Prediction builder, squad drawer, scored view | `src/components/predict/pitch-builder.tsx`, `src/components/predict/jersey.tsx` |
| Leaderboard | `src/components/leaderboard/leaderboard-table.tsx`, `src/app/(public)/leaderboards/global/page.tsx` |
| Navigation (bottom tabs / top nav) | `src/components/layout/app-nav.tsx` |
| Club accent system | `src/lib/team-colors.ts` |
| Streak / prizes copy | `src/lib/streaks.ts`, `src/lib/prizes.ts`, `src/app/(app)/prizes/page.tsx` |
| Edge states | `src/app/(app)/fixtures/page.tsx`, `src/app/(app)/history/page.tsx`, `public/offline.html` |
| Tokens, type, icon, splash | `src/app/globals.css`, `src/app/layout.tsx`, `public/icons/*` |
