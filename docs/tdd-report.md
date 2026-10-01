# TDD Evidence Report — Brawlhalla 2v2 Tournament Website

Workflow: `/tdd-workflow` ("start building plan is already given")
Date: 2026-10-01
Result: **36/36 tests passing** (`node --test "test/*.test.js"`), E2E lifecycle pass, visual pass of all pages.

## Source plan

`.zcode/plans/plan-sess_49a40328-7adf-4599-8590-b10ca4e5fb3c.md` — "Astonishing Design Edition": Node.js + Express, Neon PostgreSQL, password admin auth, one player registers a team of two, duplicate prevention by Discord ID + username, double-elimination bracket, premium esports frontend.

## User journeys covered

1. **Visitor → registrant**: sees live status on home page; fills two player cards (Discord ID, in-game username, current 2v2 elo, peak 2v2 elo); blocked with "already registered" if either player is on any team (matched by Discord ID or case-insensitive username); blocked when registration is closed.
2. **Admin**: logs in with password; opens/closes registration; force-registers a team even while closed; lists and removes teams; generates the bracket; reports match winners.
3. **Spectator**: views the double-elimination bracket live (15s polling), sees winner propagation, champion banner, and bracket-reset banner after a LB-side Grand Final win.

## Task → test mapping

| Task | Tests (RED → GREEN) |
|---|---|
| Bracket generation, serpentine seeding (1v4, 2v3 by avg elo) | `test/bracket.test.js` — serpentine seeding |
| Byes for non-power-of-2 team counts | 6-team bye tests, bye auto-advance |
| WB winners advance / WB losers drop to LB | WB R1 winners advance, WB loser drops to LB |
| LB structure for 4/6/8 teams | 8-team LB structure |
| GF + bracket reset (LB champion wins GF) | GF reset path, second GF report decides |
| Degenerate 2-team case (no LB) | 2-team degenerate champion |
| Winner reporting validation | double-report rejection, bad-slot rejection, not-ready rejection |
| Registration validation | Discord ID `/^\d{17,20}$/`, non-empty username, finite non-negative elo — `test/api.test.js` |
| SAME_PLAYERS guard (p1 == p2) | checked before field validation |
| Duplicate prevention (Discord ID + username, case-insensitive) | 409 ALREADY_REGISTERED for register and force-register |
| Registration open/closed gating | 403 REGISTRATION_CLOSED when closed; force-register ignores it |
| Admin auth | login sets httpOnly cookie, wrong password 401, admin-gated routes reject unauthenticated |
| Team removal | DELETE admin/teams/:id, 404 on missing |
| Bracket generation endpoint + match reporting | POST admin/generate-bracket, POST admin/report-match |

## RED/GREEN evidence (highlights)

Several genuine RED→GREEN cycles occurred during the build (failures fixed by production-code changes, then re-verified green):

- **Bye handling RED**: `ready` never became true for bye matches (placeholder slot had null teamId) → added `bye: true` to placeholder slots and included it in the ready computation. Green.
- **2-team degenerate case RED**: crash `Cannot read properties of undefined (reading 'id')` in LB construction → added branch skipping LB when `wbRoundCount === 1`; GF auto-advances and crowns the champion.
- **Infinite loop in `resolveSlots` RED**: test run hung (killed); mutations were unconditional every pass → guarded all mutations with change checks and treated phantom (null-team) winners as byes.
- **Over-eager auto-advance RED**: auto-advance fired on fully-populated real matches (6-team test found 4 byes instead of 2) → condition now requires the match to actually contain a bye.
- **API harness RED**: mock-Res harness broke ("Route.post() requires a callback function") → rewrote integration tests to run a real HTTP server on an ephemeral port with `fetch` and a cookie jar.
- **SAME_PLAYERS masking RED**: same-person team was reported as generic VALIDATION → server now checks it explicitly before validation.

## Full-cycle verification

- `test/e2e-lifecycle.js`: against a live server on :3000 — registers 7 teams (with one deliberate duplicate attempt asserting 409), admin logs in, generates the bracket, plays every match by API to a crowned champion, then removes a team. Output: `ALL E2E CHECKS PASSED`.
- Visual pass: full-page screenshots (`shots/home.png`, `shots/register.png`, `shots/bracket.png`, `shots/admin-login.png`, `shots/admin-dash.png`) reviewed at 1280px — hero/crest/stats, two-card registration form, bracket columns with winner highlighting and champion banner, admin login and dashboard all render without defects.

## Coverage and known gaps

- Node's built-in test runner was used without a coverage reporter, so no line-coverage percentage is claimed. By inspection, covered: bracket engine (all structural paths), registration/validation/duplicate logic, all API routes including auth gating and error codes, full lifecycle E2E.
- Honest gaps: no dedicated frontend unit tests (frontend JS is exercised only via E2E/manual visual pass); no direct Postgres store test (production store mirrors the memory store interface and was shape-checked, but a Neon-backed integration test requires live credentials); no load/perf testing.
