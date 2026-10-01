/**
 * E2E smoke: full tournament lifecycle against the running dev server
 * (in-memory store). Run: node test/e2e-lifecycle.js
 * Requires: npm start already running on :3000.
 */
const assert = require('node:assert');

const BASE = 'http://localhost:3000';
let cookie = null;

async function req(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

function team(i, elo) {
  return {
    name: `E2E Squad ${i}`,
    p1: { discordId: `1${String(i).padStart(3, '0')}000000000000001`, username: `E2E_P${i}a`, elo, peak: elo + 200 },
    p2: { discordId: `1${String(i).padStart(3, '0')}000000000000002`, username: `E2E_P${i}b`, elo: elo - 100, peak: elo + 100 },
  };
}

(async () => {
  // 1. status
  let r = await req('GET', '/api/status');
  assert.strictEqual(r.status, 200);

  // 2. register 6 unique teams
  const elos = [2000, 1900, 1800, 1700, 1600, 1500];
  for (let i = 0; i < 6; i++) {
    r = await req('POST', '/api/register', team(i, elos[i]));
    assert.strictEqual(r.status, 201, `team ${i} should register`);
  }

  // 3. duplicate rejected (re-use team 0's p1 discord id)
  r = await req('POST', '/api/register', team(0, 1500));
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.data.error, 'ALREADY_REGISTERED');

  // 4. admin login + operations
  r = await req('POST', '/api/admin/login', { password: 'change-me' });
  assert.strictEqual(r.status, 200);

  r = await req('POST', '/api/admin/settings', { open: false });
  assert.strictEqual(r.status, 200);
  r = await req('POST', '/api/register', team(99, 1000));
  assert.strictEqual(r.status, 403);

  r = await req('POST', '/api/admin/settings', { open: true });
  assert.strictEqual(r.status, 200);

  r = await req('POST', '/api/admin/force-register', team(50, 1400));
  assert.strictEqual(r.status, 201);

  // 5. generate bracket (7 teams -> 8-slot with 1 bye)
  r = await req('POST', '/api/admin/generate-bracket', {});
  assert.strictEqual(r.status, 200, 'bracket generates');
  let bracket = r.data.bracket;
  assert.strictEqual(bracket.winners.rounds[0].matches.length, 4);

  // 6. play the whole tournament: always pick slot with lower teamId (deterministic)
  async function playAll() {
    let guard = 0;
    while (guard++ < 50) {
      const b = (await req('GET', '/api/bracket')).data.bracket;
      // find any ready, undecided, non-bye match
      const all = [
        ...b.winners.rounds.flatMap((x) => x.matches),
        ...b.losers.rounds.flatMap((x) => x.matches),
        b.grandFinal,
        ...(b.grandFinalReset ? [b.grandFinalReset] : []),
      ];
      const m = all.find((x) => x.ready && !x.winner && !x.isBye);
      if (!m) break;
      const pick = m.slots.reduce((a, s) => (s.teamId < a.teamId ? s : a));
      r = await req('POST', '/api/admin/report-match', { matchId: m.id, winner: pick.slotId });
      assert.strictEqual(r.status, 200, `report ${m.id}: ${JSON.stringify(r.data)}`);
    }
    const b = (await req('GET', '/api/bracket')).data.bracket;
    assert.ok(b.champion, 'tournament produces a champion');
    return b;
  }
  const final = await playAll();
  console.log('E2E PASS — champion slot:', final.champion);

  // 7. remove team works
  r = await req('GET', '/api/admin/teams');
  const someTeam = r.data.teams[0];
  r = await req('DELETE', `/api/admin/teams/${someTeam.id}`);
  assert.strictEqual(r.status, 200);

  console.log('ALL E2E CHECKS PASSED');
})().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
