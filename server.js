/**
 * Express app factory. Takes a store (Postgres in prod, in-memory in tests)
 * so routes are fully testable without a database.
 */
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const { generateBracket, reportWinner, bracketComplete, undoResult, teamBracketInfo, teamStatuses } = require('./lib/bracket');
const {
  validateRegistration,
  findDuplicate,
  normalizeTeam,
} = require('./lib/registration');
const {
  announceRegistration,
  announceTeamRegistered,
} = require('./lib/webhooks');
const { maybePostRoundImage } = require('./lib/round-webhook');

function createApp(store, opts = {}) {
  const adminPassword = opts.adminPassword || 'change-me';
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  // ---- security headers (helmet-lite, no extra deps) ----
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // ---- tiny per-IP fixed-window rate limiter for abuse-prone endpoints ----
  // On serverless each warm instance keeps its own map; that still blunts
  // brute-force bursts without an external store.
  const hits = new Map();
  function rateLimit({ windowMs, max }) {
    return (req, res, next) => {
      const key = req.ip || req.socket?.remoteAddress || 'unknown';
      const now = Date.now();
      const rec = hits.get(key);
      if (!rec || now > rec.reset) {
        hits.set(key, { count: 1, reset: now + windowMs });
        return next();
      }
      rec.count += 1;
      if (rec.count > max)
        return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many requests — slow down.' });
      next();
    };
  }
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }, 5 * 60 * 1000).unref();
  // Rate limiting is active in production (Vercel sets NODE_ENV=production).
  // Tests run many requests from one IP, so it stays off in test/dev.
  const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
  const loginLimiter = isProd ? rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }) : (req, res, next) => next();
  const registerLimiter = isProd ? rateLimit({ windowMs: 60 * 1000, max: 10 }) : (req, res, next) => next();

  // ---- auth helpers ----
  // Signed stateless session cookie so admin auth survives serverless
  // cold starts (no in-memory session state). Logout clears the cookie.
  function sign(value) {
    const secret = opts.sessionSecret || adminPassword;
    const mac = crypto.createHmac('sha256', secret).update(value).digest('hex');
    return `${value}.${mac}`;
  }
  function verify(signed) {
    if (!signed) return false;
    const idx = signed.lastIndexOf('.');
    if (idx < 1) return false;
    return sign(signed.slice(0, idx)) === signed;
  }

  function isAdmin(req) {
    const token = req.cookies && req.cookies.session;
    return token ? verify(token) : false;
  }

  function requireAdmin(req, res, next) {
    if (!isAdmin(req)) return res.status(401).json({ error: 'UNAUTHORIZED' });
    next();
  }

  // ---- public API ----
  app.get('/api/status', async (req, res) => {
    try {
      const [open, teams, start] = await Promise.all([
        store.getRegistrationOpen(),
        store.getTeams(),
        store.getTournamentStart ? store.getTournamentStart() : Promise.resolve(null),
      ]);
      res.json({ registrationOpen: open, teamCount: teams.length, tournamentStart: start });
    } catch (err) {
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  app.post('/api/register', registerLimiter, async (req, res) => {
    try {
      const open = await store.getRegistrationOpen();
      if (!open)
        return res
          .status(403)
          .json({ error: 'REGISTRATION_CLOSED', message: 'Registration is closed.' });

      // same-person check takes priority over field validation
      if (
        req.body &&
        req.body.p1 && req.body.p2 &&
        String(req.body.p1.discordId) === String(req.body.p2.discordId)
      )
        return res.status(400).json({
          error: 'SAME_PLAYERS',
          message: 'Both players cannot be the same person.',
        });

      const validation = validateRegistration(req.body);
      if (!validation.valid)
        return res
          .status(400)
          .json({ error: 'VALIDATION', message: validation.errors.join('; ') });

      const team = normalizeTeam(req.body);
      const existing = await store.getTeams();
      const dup = findDuplicate(team, existing);
      if (dup)
        return res.status(409).json({
          error: 'ALREADY_REGISTERED',
          message: `Player ${dup.player === 'p1' ? 1 : 2} is already registered (matched by ${dup.by === 'discordId' ? 'Discord ID' : 'in-game username'}).`,
        });

      const row = await store.insertTeam(team);
      announceTeamRegistered(row); // fire-and-forget Discord embed
      res.status(201).json({ ok: true, team: row });
    } catch (err) {
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  app.get('/api/bracket', async (req, res) => {
    try {
      const bracket = await store.getBracket();
      const teams = bracket ? await store.getTeams() : [];
      const eliminated = bracket ? [...teamStatuses(bracket).keys()] : [];
      res.json({ bracket, teams, eliminated });
    } catch (err) {
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // ---- admin auth ----
  app.post('/api/admin/login', loginLimiter, (req, res) => {
    if (!req.body || req.body.password !== adminPassword)
      return res.status(401).json({ error: 'INVALID_PASSWORD' });
    const token = crypto.randomBytes(24).toString('hex');
    res.cookie('session', sign(token), {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production' || !!process.env.VERCEL,
      maxAge: 7 * 24 * 3600 * 1000,
    });
    res.json({ ok: true });
  });

  app.post('/api/admin/logout', (req, res) => {
    res.clearCookie('session');
    res.json({ ok: true });
  });

  app.get('/api/admin/me', (req, res) => {
    res.json({ admin: isAdmin(req) });
  });

  // ---- admin API ----
  app.post('/api/admin/settings', requireAdmin, async (req, res) => {
    if (typeof req.body.open !== 'boolean')
      return res.status(400).json({ error: 'VALIDATION' });
    const prev = await store.getRegistrationOpen();
    await store.setRegistrationOpen(req.body.open);
    if (prev !== req.body.open) {
      const teams = await store.getTeams();
      announceRegistration(req.body.open, teams.length); // fire-and-forget
    }
    res.json({ ok: true, registrationOpen: req.body.open });
  });

  app.post('/api/admin/tournament-start', requireAdmin, async (req, res) => {
    if (!store.setTournamentStart)
      return res.status(400).json({ error: 'UNSUPPORTED' });
    const { start } = req.body || {};
    if (start === null || start === '') {
      await store.setTournamentStart(null);
      return res.json({ ok: true, tournamentStart: null });
    }
    const d = new Date(start);
    if (!start || isNaN(d.getTime()) || d.getTime() < Date.now())
      return res.status(400).json({ error: 'VALIDATION', message: 'Start must be a valid future date/time.' });
    await store.setTournamentStart(d.toISOString());
    res.json({ ok: true, tournamentStart: d.toISOString() });
  });

  app.get('/api/admin/teams', requireAdmin, async (req, res) => {
    res.json({ teams: await store.getTeams() });
  });

  app.delete('/api/admin/teams/:id', requireAdmin, async (req, res) => {
    const ok = await store.deleteTeam(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ ok: true });
  });

  app.post('/api/admin/force-register', requireAdmin, async (req, res) => {
    const validation = validateRegistration(req.body);
    if (!validation.valid)
      return res
        .status(400)
        .json({ error: 'VALIDATION', message: validation.errors.join('; ') });
    const team = normalizeTeam(req.body);
    const existing = await store.getTeams();
    const dup = findDuplicate(team, existing);
    if (dup)
      return res.status(409).json({
        error: 'ALREADY_REGISTERED',
        message: `Player ${dup.player === 'p1' ? 1 : 2} is already registered (matched by ${dup.by}).`,
      });
    const row = await store.insertTeam(team);
    announceTeamRegistered(row); // fire-and-forget Discord embed
    res.status(201).json({ ok: true, team: row });
  });

  app.post('/api/admin/generate-bracket', requireAdmin, async (req, res) => {
    try {
      const teams = await store.getTeams();
      const seeded = teams.map((t) => ({
        id: t.id,
        name: `${t.p1.username} / ${t.p2.username}`,
        avgElo: (t.p1.elo + t.p2.elo) / 2,
      }));
      const bracket = generateBracket(seeded);
      await store.saveBracket(bracket);
      if (store.setSetting) {
        await store.setSetting('last_round_announced', '');
        await maybePostRoundImage(bracket, teams, '');
      }
      res.json({ ok: true, bracket });
    } catch (err) {
      res.status(400).json({ error: 'BRACKET_ERROR', message: err.message });
    }
  });

  app.post('/api/admin/report-match', requireAdmin, async (req, res) => {
    try {
      const bracket = await store.getBracket();
      if (!bracket) return res.status(400).json({ error: 'NO_BRACKET' });
      reportWinner(bracket, req.body.matchId, req.body.winner, req.body.scores);
      await store.saveBracket(bracket);
      // announce a round transition (previous round fully decided)
      if (store.getSetting) {
        const teams = await store.getTeams();
        const last = (await store.getSetting('last_round_announced')) || '';
        const posted = await maybePostRoundImage(bracket, teams, last);
        if (posted && store.setSetting) await store.setSetting('last_round_announced', posted);
      }
      res.json({ ok: true, bracket, complete: bracketComplete(bracket) });
    } catch (err) {
      res.status(400).json({ error: 'REPORT_ERROR', message: err.message });
    }
  });

  app.post('/api/admin/undo-match', requireAdmin, async (req, res) => {
    try {
      const bracket = await store.getBracket();
      if (!bracket) return res.status(400).json({ error: 'NO_BRACKET' });
      undoResult(bracket, req.body.matchId);
      await store.saveBracket(bracket);
      // rewinding results may bring an earlier round back to current
      if (store.getSetting) {
        const teams = await store.getTeams();
        const last = (await store.getSetting('last_round_announced')) || '';
        const posted = await maybePostRoundImage(bracket, teams, last);
        if (posted && store.setSetting) await store.setSetting('last_round_announced', posted);
      }
      res.json({ ok: true, bracket });
    } catch (err) {
      res.status(400).json({ error: 'UNDO_ERROR', message: err.message });
    }
  });

  // Public lookup: everything about one team in the bracket (history, next
  // match, elimination status). Also used to build team profile cards.
  app.get('/api/teams/:id/bracket', async (req, res) => {
    try {
      const bracket = await store.getBracket();
      if (!bracket) return res.status(404).json({ error: 'NO_BRACKET' });
      const teamId = Number(req.params.id);
      const team = (await store.getTeams()).find((t) => t.id === teamId);
      if (!team) return res.status(404).json({ error: 'NOT_FOUND' });
      res.json({ team, info: teamBracketInfo(bracket, teamId) });
    } catch (err) {
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Player-facing search: find my team by Discord ID or username, get my
  // next match (opponent, round, BoX) plus history.
  app.get('/api/my-match', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim().toLowerCase();
      if (!q) return res.status(400).json({ error: 'MISSING_QUERY' });
      const teams = await store.getTeams();
      const team = teams.find(
        (t) =>
          String(t.p1.discordId) === q ||
          String(t.p2.discordId) === q ||
          t.p1.username.toLowerCase() === q ||
          t.p2.username.toLowerCase() === q
      );
      if (!team)
        return res.status(404).json({
          error: 'NOT_FOUND',
          message: 'No registered team found for that Discord ID or username.',
        });
      const bracket = await store.getBracket();
      const info = bracket ? teamBracketInfo(bracket, team.id) : { next: null, history: [], eliminated: false, champion: false };
      res.json({ team, info, hasBracket: !!bracket });
    } catch (err) {
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // ---- site content (rules / prizes), admin-editable ----
  app.get('/api/content', async (req, res) => {
    try {
      const [rules, prizes] = await Promise.all([
        store.getSetting ? store.getSetting('rules') : Promise.resolve(null),
        store.getSetting ? store.getSetting('prizes') : Promise.resolve(null),
      ]);
      res.json({ rules: rules || '', prizes: prizes || '' });
    } catch (err) {
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  app.post('/api/admin/content', requireAdmin, async (req, res) => {
    try {
      if (!store.setSetting) return res.status(400).json({ error: 'UNSUPPORTED' });
      for (const key of ['rules', 'prizes']) {
        if (typeof req.body[key] === 'string')
          await store.setSetting(key, req.body[key]);
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Admin CSV export of all registered teams
  app.get('/api/admin/teams.csv', requireAdmin, async (req, res) => {
    const teams = await store.getTeams();
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [
      ['team_id', 'p1_username', 'p1_discord_id', 'p1_elo', 'p1_peak', 'p2_username', 'p2_discord_id', 'p2_elo', 'p2_peak', 'avg_elo', 'registered_at'],
    ];
    for (const t of teams) {
      rows.push([
        t.id,
        t.p1.username, t.p1.discordId, t.p1.elo, t.p1.peak,
        t.p2.username, t.p2.discordId, t.p2.elo, t.p2.peak,
        Math.round((t.p1.elo + t.p2.elo) / 2),
        t.registeredAt || '',
      ]);
    }
    const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n');
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="teams.csv"');
    res.send(csv);
  });

  // ---- static files ----
  const path = require('path');
  const pub = path.join(__dirname, 'public');
  app.use(express.static(pub));
  const sendPage = (file) => (req, res) => res.sendFile(path.join(pub, file));
  app.get('/', sendPage('index.html'));
  app.get('/home', sendPage('index.html'));
  app.get('/register', sendPage('register.html'));
  app.get('/bracket', sendPage('bracket.html'));
  app.get('/admin', sendPage('admin.html'));
  app.get('/overlay', sendPage('overlay.html'));

  return app;
}

module.exports = { createApp };
