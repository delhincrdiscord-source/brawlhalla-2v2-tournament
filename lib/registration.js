/**
 * Registration validation + duplicate detection (pure functions, unit-tested).
 */
const DISCORD_ID_RE = /^\d{17,20}$/;

function validateRegistration(body) {
  const errors = [];
  const p1 = body && body.p1;
  const p2 = body && body.p2;
  for (const [label, p] of [['p1', p1], ['p2', p2]]) {
    if (!p) {
      errors.push(`${label} is required`);
      continue;
    }
    if (!p.discordId || !DISCORD_ID_RE.test(String(p.discordId)))
      errors.push(`${label}.discordId must be a 17-20 digit Discord user ID`);
    if (!p.username || typeof p.username !== 'string' || !p.username.trim())
      errors.push(`${label}.username is required`);
    if (!Number.isFinite(Number(p.elo)) || Number(p.elo) < 0)
      errors.push(`${label}.elo must be a non-negative number`);
    if (!Number.isFinite(Number(p.peak)) || Number(p.peak) < 0)
      errors.push(`${label}.peak must be a non-negative number`);
  }
  if (p1 && p2 && errors.length === 0) {
    if (String(p1.discordId) === String(p2.discordId))
      errors.push('Both players cannot be the same person');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Returns { player: 'p1'|'p2', by: 'discordId'|'username' } if either new
 * player collides with any already-registered player, else null.
 */
function findDuplicate(team, existingTeams) {
  const norm = (s) => String(s).trim().toLowerCase();
  for (const existing of existingTeams) {
    for (const side of ['p1', 'p2']) {
      const cand = team[side];
      const old = existing[side];
      if (String(cand.discordId) === String(old.discordId))
        return { player: side, by: 'discordId' };
      if (norm(cand.username) === norm(old.username))
        return { player: side, by: 'username' };
    }
  }
  return null;
}

function normalizeTeam(body) {
  return {
    p1: {
      discordId: String(body.p1.discordId).trim(),
      username: body.p1.username.trim(),
      elo: Math.round(Number(body.p1.elo)),
      peak: Math.round(Number(body.p1.peak)),
    },
    p2: {
      discordId: String(body.p2.discordId).trim(),
      username: body.p2.username.trim(),
      elo: Math.round(Number(body.p2.elo)),
      peak: Math.round(Number(body.p2.peak)),
    },
  };
}

module.exports = { validateRegistration, findDuplicate, normalizeTeam };
