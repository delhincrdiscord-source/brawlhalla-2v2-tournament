const { test, describe, beforeEach, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// Integration tests against the real Express app over HTTP, using an
// in-memory store so tests never touch real Neon/Postgres.
const { createApp } = require('../server');
const { createMemoryStore } = require('./helpers/memory-store');

let server;
let baseUrl;
let cookieValue = null;

async function start() {
  const store = createMemoryStore();
  const app = createApp(store, { adminPassword: 'test-admin' });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return store;
}

async function req(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (cookieValue) headers.cookie = cookieValue;
  const res = await fetch(baseUrl + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookieValue = setCookie.split(';')[0];
  let bodyJson = null;
  try {
    bodyJson = await res.json();
  } catch {}
  return { status: res.status, body: bodyJson, headers: res.headers };
}

const get = (p) => req('GET', p);
const post = (p, b) => req('POST', p, b);
const del = (p) => req('DELETE', p);

const VALID_TEAM = {
  p1: { discordId: '123456789012345678', username: 'PlayerOne', elo: 2000, peak: 2200 },
  p2: { discordId: '234567890123456789', username: 'PlayerTwo', elo: 1800, peak: 2100 },
};

function postTeam(overrides = {}) {
  return {
    name: overrides.name || 'Test Team',
    p1: { ...VALID_TEAM.p1, ...overrides.p1 },
    p2: { ...VALID_TEAM.p2, ...overrides.p2 },
  };
}

let store;
let testState = 0; // bump to reset server state between groups

before(async () => {
  store = await start();
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
});

async function freshState() {
  // reset in-memory store contents between test groups
  store._reset ? store._reset() : null;
  cookieValue = null;
}

describe('POST /api/register', () => {
  beforeEach(async () => {
    await freshState();
  });

  test('registers a valid team and returns 201', async () => {
    const res = await post('/api/register', postTeam());
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual((await store.getTeams()).length, 1);
  });

  test('rejects registration when registration is closed', async () => {
    await store.setRegistrationOpen(false);
    const res = await post('/api/register', postTeam());
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, 'REGISTRATION_CLOSED');
    assert.strictEqual((await store.getTeams()).length, 0);
  });

  test('rejects duplicate discord id on either player', async () => {
    await post('/api/register', postTeam());
    const res = await post('/api/register', postTeam({
      p1: { discordId: '999999999999999999', username: 'FreshName', elo: 1000, peak: 1200 },
    }));
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, 'ALREADY_REGISTERED');
    assert.match(res.body.message, /already registered/i);
    assert.strictEqual((await store.getTeams()).length, 1);
  });

  test('rejects duplicate in-game username (case-insensitive)', async () => {
    await post('/api/register', postTeam());
    const res = await post('/api/register', postTeam({
      p1: { discordId: '888888888888888888', username: 'playerONE', elo: 1000, peak: 1200 },
    }));
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, 'ALREADY_REGISTERED');
  });

  test('rejects both players being the same person', async () => {
    const res = await post('/api/register', postTeam({
      p2: { discordId: VALID_TEAM.p1.discordId, username: 'PlayerOne', elo: 2000, peak: 2200 },
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'SAME_PLAYERS');
  });

  test('validates required fields', async () => {
    const res = await post('/api/register', postTeam({ p1: { username: '' } }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'VALIDATION');
  });

  test('validates elo fields are numbers', async () => {
    const res = await post('/api/register', postTeam({ p2: { elo: 'abc' } }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'VALIDATION');
  });

  test('validates discord id is 17-20 digits', async () => {
    const res = await post('/api/register', postTeam({ p1: { discordId: '123' } }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'VALIDATION');
  });
});

describe('GET /api/status', () => {
  test('returns registration state and team count', async () => {
    await freshState();
    await post('/api/register', postTeam());
    const res = await get('/api/status');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.registrationOpen, true);
    assert.strictEqual(res.body.teamCount, 1);
  });
});

describe('GET /api/bracket', () => {
  test('returns null bracket before generation', async () => {
    await freshState();
    const res = await get('/api/bracket');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.bracket, null);
  });

  test('returns generated bracket with team names', async () => {
    await freshState();
    await post('/api/register', postTeam());
    await post('/api/register', postTeam({
      p1: { discordId: '333333333333333333', username: 'P3', elo: 1500, peak: 1600 },
      p2: { discordId: '444444444444444444', username: 'P4', elo: 1400, peak: 1500 },
    }));
    await post('/api/admin/login', { password: 'test-admin' });
    const gen = await post('/api/admin/generate-bracket', {});
    assert.strictEqual(gen.status, 200);
    const res = await get('/api/bracket');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.bracket.winners);
    assert.strictEqual(res.body.teams.length, 2);
  });
});

describe('admin auth', () => {
  test('login with correct password sets cookie', async () => {
    await freshState();
    const res = await post('/api/admin/login', { password: 'test-admin' });
    assert.strictEqual(res.status, 200);
    assert.ok(cookieValue && cookieValue.startsWith('session='));
  });

  test('login with wrong password is 401', async () => {
    await freshState();
    const res = await post('/api/admin/login', { password: 'wrong' });
    assert.strictEqual(res.status, 401);
  });

  test('admin endpoints reject unauthenticated requests', async () => {
    await freshState();
    const res = await post('/api/admin/settings', { open: false });
    assert.strictEqual(res.status, 401);
  });
});

describe('admin operations', () => {
  beforeEach(async () => {
    await freshState();
    await post('/api/register', postTeam());
    await post('/api/admin/login', { password: 'test-admin' });
  });

  test('open/close registration toggle', async () => {
    const res = await post('/api/admin/settings', { open: false });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await store.getRegistrationOpen(), false);
    const res2 = await post('/api/register', postTeam({
      p1: { discordId: '555555555555555555', username: 'Late', elo: 1000, peak: 1100 },
    }));
    assert.strictEqual(res2.status, 403);
  });

  test('force register works while registration is closed', async () => {
    await post('/api/admin/settings', { open: false });
    const res = await post('/api/admin/force-register', {
      name: 'Forced Team',
      p1: { discordId: '666666666666666666', username: 'Forced1', elo: 1200, peak: 1300 },
      p2: { discordId: '777777777777777777', username: 'Forced2', elo: 1100, peak: 1200 },
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual((await store.getTeams()).length, 2);
  });

  test('force register still rejects duplicates', async () => {
    const res = await post('/api/admin/force-register', {
      name: 'Dup Team',
      p1: { discordId: '999888777666555444', username: 'Fresh', elo: 1000, peak: 1100 },
      p2: { discordId: '234567890123456789', username: 'Dup2', elo: 1000, peak: 1100 },
    });
    // p2 duplicates existing team's p2 discord id
    assert.strictEqual(res.status, 409);
  });

  test('remove team by id', async () => {
    const team = (await store.getTeams())[0];
    const res = await del(`/api/admin/teams/${team.id}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await store.getTeams()).length, 0);
  });

  test('remove unknown team is 404', async () => {
    const res = await del('/api/admin/teams/9999');
    assert.strictEqual(res.status, 404);
  });

  test('report match winner persists bracket progression', async () => {
    await post('/api/register', postTeam({
      p1: { discordId: '333333333333333333', username: 'P3', elo: 1500, peak: 1600 },
      p2: { discordId: '444444444444444444', username: 'P4', elo: 1400, peak: 1500 },
    }));
    await post('/api/admin/generate-bracket', {});
    const b = await store.getBracket();
    const m1 = b.winners.rounds[0].matches[0];
    const res = await post('/api/admin/report-match', {
      matchId: m1.id, winner: m1.slots[0].slotId,
    });
    assert.strictEqual(res.status, 200);
    const updated = await store.getBracket();
    assert.strictEqual(updated.winners.rounds[0].matches[0].winner, m1.slots[0].slotId);
  });

  test('report match with bad winner is 400', async () => {
    await post('/api/register', postTeam({
      p1: { discordId: '333333333333333333', username: 'P3', elo: 1500, peak: 1600 },
      p2: { discordId: '444444444444444444', username: 'P4', elo: 1400, peak: 1500 },
    }));
    await post('/api/admin/generate-bracket', {});
    const res = await post('/api/admin/report-match', {
      matchId: 'W1M0', winner: 'nope',
    });
    assert.strictEqual(res.status, 400);
  });
});

describe('undo, content, csv, my-match', () => {
  beforeEach(async () => {
    await freshState();
  });

  test('undo-match reverts a reported result', async () => {
    await post('/api/admin/login', { password: 'test-admin' });
    // 4 registrations = 4 teams: W1M0 is a Bo3 semifinal, not the GF
    const quads = [
      ['555555555555555555', '666666666666666666', 'U1', 'U2', 1500, 1600, 1400, 1500],
      ['777777777777777777', '888888888888888888', 'U3', 'U4', 1300, 1400, 1200, 1300],
      ['199999999999999999', '299999999999999999', 'U5', 'U6', 1100, 1200, 1000, 1100],
      ['399999999999999999', '499999999999999999', 'U7', 'U8', 900, 1000, 800, 900],
    ];
    for (const [d1, d2, n1, n2, e1, p1, e2, p2] of quads)
      await post('/api/register', postTeam({
        p1: { discordId: d1, username: n1, elo: e1, peak: p1 },
        p2: { discordId: d2, username: n2, elo: e2, peak: p2 },
      }));
    await post('/api/admin/generate-bracket', {});
    const rep = await post('/api/admin/report-match', { matchId: 'W1M0', winner: 't1', scores: [2, 1] });
    assert.strictEqual(rep.status, 200);
    const undo = await post('/api/admin/undo-match', { matchId: 'W1M0' });
    assert.strictEqual(undo.status, 200);
    const m = undo.body.bracket.winners.rounds[0].matches[0];
    assert.strictEqual(m.winner, null);
    assert.deepStrictEqual(m.scores, [0, 0]);
    const bad = await post('/api/admin/undo-match', { matchId: 'W1M0' });
    assert.strictEqual(bad.status, 400); // nothing to undo
    const noAuth = await fetch(baseUrl + '/api/admin/undo-match', { method: 'POST' });
    assert.strictEqual(noAuth.status, 401);
  });

  test('content get/set stores rules and prizes', async () => {
    await post('/api/admin/login', { password: 'test-admin' });
    const anon = await get('/api/content');
    assert.strictEqual(anon.status, 200);
    assert.deepStrictEqual(anon.body, { rules: '', prizes: '' });
    const saved = await post('/api/admin/content', { rules: 'Rule A\nRule B', prizes: '1st: $50' });
    assert.strictEqual(saved.status, 200);
    const again = await get('/api/content');
    assert.strictEqual(again.body.rules, 'Rule A\nRule B');
    assert.strictEqual(again.body.prizes, '1st: $50');
  });

  test('teams.csv downloads a CSV with header row', async () => {
    await post('/api/admin/login', { password: 'test-admin' });
    await post('/api/register', postTeam());
    const res = await fetch(baseUrl + '/api/admin/teams.csv', { headers: { cookie: cookieValue } });
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.match(text, /^team_id,/);
    assert.match(text, /PlayerOne/);
    assert.match(text, /PlayerOne/);
  });

  test('my-match finds team by username or discord id and returns info', async () => {
    await post('/api/register', postTeam()); // PlayerOne / PlayerTwo
    await post('/api/register', postTeam({
      p1: { discordId: '777777777777777777', username: 'U3', elo: 1300, peak: 1400 },
      p2: { discordId: '888888888888888888', username: 'U4', elo: 1200, peak: 1300 },
    }));
    const byName = await get('/api/my-match?q=playerone');
    assert.strictEqual(byName.status, 200);
    assert.strictEqual(byName.body.team.p1.username, 'PlayerOne');
    assert.ok(byName.body.info);
    assert.ok(Array.isArray(byName.body.info.history));
    const byId = await get('/api/my-match?q=888888888888888888');
    assert.strictEqual(byId.status, 200);
    assert.strictEqual(byId.body.team.p2.username, 'U4');
    const missing = await get('/api/my-match?q=nobody-here');
    assert.strictEqual(missing.status, 404);
    const noq = await get('/api/my-match');
    assert.strictEqual(noq.status, 400);
  });

  test('team bracket endpoint returns history', async () => {
    await post('/api/register', postTeam());
    await post('/api/register', postTeam({
      p1: { discordId: '777777777777777777', username: 'U3', elo: 1300, peak: 1400 },
      p2: { discordId: '888888888888888888', username: 'U4', elo: 1200, peak: 1300 },
    }));
    await post('/api/admin/login', { password: 'test-admin' });
    await post('/api/admin/generate-bracket', {});
    const res = await get('/api/teams/1/bracket');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.team);
    assert.ok(res.body.info);
  });
});
