/**
 * Double-elimination bracket engine for a 2v2 tournament.
 *
 * Data shape (JSON-serializable, stored as one row in the brackets table):
 * {
 *   winners:  { rounds: [{ matches: [Match] }] },
 *   losers:   { rounds: [{ matches: [Match] }] },
 *   grandFinal: Match,
 *   grandFinalReset: Match | null,   // exists only after a GF reset is triggered
 *   bracketResetRequired: boolean,
 *   champion: slotId | null
 * }
 *
 * Match = {
 *   id: string,                  // 'W1M0', 'L1M1', 'GF', 'GFR'
 *   slots: [Slot, Slot],
 *   winner: slotId | null,
 *   ready: boolean,              // both slots resolved
 *   isBye: boolean
 * }
 *
 * Slot = {
 *   slotId: string,              // stable id used for reporting ('t<teamId>' or 'w<W1M0>')
 *   seed: number | null,         // set only for round-1 team slots
 *   teamId: number | null,       // resolved team (null until propagated)
 *   from: matchId | null,        // which match this slot consumes
 *   loser: boolean               // true when the slot consumes a LOSER
 * }
 */

function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Serpentine seed order for a bracket of size p: 1,p,2,p-1,3,p-2... */
function seedOrder(p) {
  const order = [];
  let lo = 1;
  let hi = p;
  while (lo < hi) {
    order.push(lo++, hi--);
  }
  return order;
}

function slot(opts) {
  return {
    slotId: opts.slotId,
    seed: opts.seed ?? null,
    teamId: opts.teamId ?? null,
    from: opts.from ?? null,
    loser: opts.loser ?? false,
    bye: opts.bye ?? false,
  };
}

function makeMatch(id, slots, isBye = false) {
  return { id, slots, winner: null, scores: [0, 0], bestOf: 1, ready: false, isBye };
}

/**
 * Series format by match id: Bo1 default, Bo3 semifinals, Bo5 finals
 * (WB final, LB final, grand final, grand-final reset). Applied after
 * full bracket construction.
 */
function applySeriesFormats(bracket) {
  const wbCount = bracket.winners.rounds.length;
  bracket.winners.rounds.forEach((r, i) => {
    for (const m of r.matches) {
      if (i === wbCount - 1) m.bestOf = 5;          // WB final
      else if (i === wbCount - 2) m.bestOf = 3;     // WB semifinals
    }
  });
  const lbCount = bracket.losers.rounds.length;
  bracket.losers.rounds.forEach((r, i) => {
    for (const m of r.matches) {
      if (i === lbCount - 1) m.bestOf = 5;          // LB final
      else if (i === lbCount - 2) m.bestOf = 3;     // LB semifinals
    }
  });
  bracket.grandFinal.bestOf = 5;
  if (bracket.grandFinalReset) bracket.grandFinalReset.bestOf = 5;
}

function matchById(bracket, id) {
  for (const round of bracket.winners.rounds)
    for (const m of round.matches) if (m.id === id) return m;
  for (const round of bracket.losers.rounds)
    for (const m of round.matches) if (m.id === id) return m;
  if (bracket.grandFinal.id === id) return bracket.grandFinal;
  if (bracket.grandFinalReset && bracket.grandFinalReset.id === id)
    return bracket.grandFinalReset;
  return null;
}

function allMatches(bracket) {
  const out = [];
  for (const round of bracket.winners.rounds) out.push(...round.matches);
  for (const round of bracket.losers.rounds) out.push(...round.matches);
  out.push(bracket.grandFinal);
  if (bracket.grandFinalReset) out.push(bracket.grandFinalReset);
  return out;
}

function resolveSlots(bracket) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of allMatches(bracket)) {
      if (m.ready) continue;
      for (const s of m.slots) {
        if (s.teamId !== null) continue;
        if (s.from) {
          const src = matchById(bracket, s.from);
          if (!src) continue;
          if (s.loser) {
            // losing slotId of src, only once src has a winner
            if (src.winner) {
              const loserSlot =
                src.isBye || src.winner === null
                  ? null
                  : src.slots.find((x) => x.slotId !== src.winner);
              const phantom = src.isBye || (loserSlot && loserSlot.bye);
              if (phantom) {
                // no real loser from a bye: treat this slot as a bye
                if (!s.bye) {
                  s.bye = true;
                  changed = true;
                }
              } else if (loserSlot && s.slotId !== loserSlot.slotId) {
                s.slotId = loserSlot.slotId;
                s.teamId = loserSlot.teamId;
                changed = true;
              }
            }
          } else if (src.winner) {
            const winSlot = src.slots.find((x) => x.slotId === src.winner);
            if (winSlot.teamId === null) {
              // phantom winner (double-bye path) — treat as a bye
              if (!s.bye) {
                s.bye = true;
                changed = true;
              }
            } else if (s.slotId !== src.winner) {
              s.slotId = src.winner;
              s.teamId = winSlot.teamId;
              changed = true;
            }
          }
        }
      }
      m.ready = m.slots.every((s) => s.teamId !== null || s.bye);
      const hasBye = m.slots.some((s) => s.bye);
      if (m.ready && m.winner === null && (m.isBye || hasBye)) {
        // a bye side advances for free
        const real = m.slots.find((s) => s.teamId !== null);
        m.winner = real ? real.slotId : m.slots[0].slotId; // double-bye: first slot
        m.isBye = true;
        changed = true;
        // auto-advanced grand final (degenerate 2-team bracket) crowns directly
        if (m.id === 'GF' || m.id === 'GFR') bracket.champion = m.winner;
      }
    }
  }
}

/**
 * Build a full double-elimination bracket from an array of teams.
 * Each team: { id, name, avgElo }. Seeded serpentine by avgElo desc.
 */
function generateBracket(inputTeams) {
  if (!Array.isArray(inputTeams) || inputTeams.length < 2)
    throw new Error('Need at least 2 teams');

  const sorted = [...inputTeams].sort((a, b) => b.avgElo - a.avgElo);
  sorted.forEach((t, i) => (t.seed = i + 1));
  const p = nextPowerOfTwo(sorted.length);
  const order = seedOrder(p); // seeds per first-round pair, length p

  // map seed -> team (or null for bye)
  const bySeed = new Map(sorted.map((t) => [t.seed, t]));

  const wbR1 = [];
  const wbBySeed = new Map(); // seed -> {matchId, slotId} for drop/advance wiring
  for (let i = 0; i < p / 2; i++) {
    const sA = order[i * 2];
    const sB = order[i * 2 + 1];
    const tA = bySeed.get(sA) || null;
    const tB = bySeed.get(sB) || null;
    const id = `W1M${i}`;
    const slotA = slot({
      slotId: tA ? `t${tA.id}` : `bye${id}a`,
      seed: sA,
      teamId: tA ? tA.id : null,
      bye: tA === null,
    });
    const slotB = slot({
      slotId: tB ? `t${tB.id}` : `bye${id}b`,
      seed: sB,
      teamId: tB ? tB.id : null,
      bye: tB === null,
    });
    const isBye = tA === null || tB === null;
    const m = makeMatch(id, [slotA, slotB], isBye);
    wbR1.push(m);
    if (tA) wbBySeed.set(sA, { matchId: id, slotId: slotA.slotId });
    if (tB) wbBySeed.set(sB, { matchId: id, slotId: slotB.slotId });
  }

  // ---- Winners bracket rounds ----
  const wbRounds = [{ matches: wbR1 }];
  let prev = wbR1;
  let roundNum = 2;
  while (prev.length > 1) {
    const next = [];
    for (let i = 0; i < prev.length / 2; i++) {
      const id = `W${roundNum}M${i}`;
      next.push(
        makeMatch(id, [
          slot({ slotId: `w${prev[i * 2].id}`, from: prev[i * 2].id }),
          slot({ slotId: `w${prev[i * 2 + 1].id}`, from: prev[i * 2 + 1].id }),
        ])
      );
    }
    wbRounds.push({ matches: next });
    prev = next;
    roundNum++;
  }

  const wbRoundCount = wbRounds.length; // R1 matches feed LB R1; later WB rounds feed later LB rounds

  // ---- Losers bracket ----
  // Standard structure: LB round k receives WB-round-k losers.
  // LB R1: pairs of WB R1 losers. LB R2: winners of LB R1 vs WB R2 losers. Etc.
  // Degenerate case (2 teams): single-elimination — no LB, WB final is the GF.
  const lbRounds = [];
  let lbPrev = null;
  if (wbRoundCount === 1) {
    lbPrev = [];
  } else {
  for (let wbR = 1; wbR <= wbRoundCount; wbR++) {
    const sourceMatches = wbRounds[wbR - 1].matches;
    if (wbR === 1) {
      const matches = [];
      for (let i = 0; i < sourceMatches.length / 2; i++) {
        const a = sourceMatches[i * 2];
        const b = sourceMatches[i * 2 + 1];
        matches.push(
          makeMatch(`L1M${i}`, [
            slot({ slotId: `l${a.id}`, from: a.id, loser: true }),
            slot({ slotId: `l${b.id}`, from: b.id, loser: true }),
          ])
        );
      }
      lbRounds.push({ matches });
      lbPrev = matches;
    } else if (wbR < wbRoundCount) {
      // LB survivors meet droppers from WB round wbR
      const matches = [];
      for (let i = 0; i < Math.max(lbPrev.length, sourceMatches.length) / 2; i++) {
        const survivor = lbPrev[i * 2];
        const dropper = sourceMatches[i];
        const id = `L${wbR}M${i}`;
        matches.push(
          makeMatch(id, [
            slot({ slotId: `l${survivor.id}`, from: survivor.id }),
            slot({ slotId: `l${dropper.id}`, from: dropper.id, loser: true }),
          ])
        );
      }
      lbRounds.push({ matches });
      lbPrev = matches;
    } else {
      // Final LB round: LB survivors play among themselves, then the survivor
      // faces the WB final loser.
      const wbFinal = sourceMatches[0];
      const matches = [];
      let survivors;
      if (lbPrev.length === 1) {
        survivors = lbPrev[0];
      } else {
        const lbSemi = makeMatch(`L${wbR}S0`, [
          slot({ slotId: `l${lbPrev[0].id}`, from: lbPrev[0].id }),
          slot({ slotId: `l${lbPrev[1].id}`, from: lbPrev[1].id }),
        ]);
        matches.push(lbSemi);
        survivors = lbSemi;
      }
      matches.push(
        makeMatch(`L${wbR}M0`, [
          slot({ slotId: `l${survivors.id}`, from: survivors.id }),
          slot({ slotId: `l${wbFinal.id}`, from: wbFinal.id, loser: true }),
        ])
      );
      lbRounds.push({ matches });
      lbPrev = [matches[matches.length - 1]];
    }
  }
  } // end non-degenerate LB construction

  const lbFinal = lbRounds.length ? lbRounds[lbRounds.length - 1].matches[0] : null;
  const wbFinalMatch = wbRounds[wbRoundCount - 1].matches[0];

  const grandFinal = lbFinal
    ? makeMatch('GF', [
        slot({ slotId: `l${wbFinalMatch.id}`, from: wbFinalMatch.id }),
        slot({ slotId: `l${lbFinal.id}`, from: lbFinal.id }),
      ])
    : (() => {
        // 2-team degenerate bracket: the WB final IS the grand final.
        const m = makeMatch('GF', [
          slot({ slotId: `l${wbFinalMatch.id}`, from: wbFinalMatch.id }),
          slot({ slotId: 'none', teamId: null, from: null, bye: true }),
        ]);
        m.isBye = false;
        return m;
      })();

  const bracket = {
    winners: { rounds: wbRounds },
    losers: { rounds: lbRounds },
    grandFinal,
    grandFinalReset: null,
    bracketResetRequired: false,
    champion: null,
  };
  applySeriesFormats(bracket);
  resolveSlots(bracket);
  return bracket;
}

/**
 * Record a winner (slotId) for match id, with the series score.
 * scores is [winsA, winsB] aligned to m.slots order, e.g. Bo3 "2-1".
 * Mutates and returns the bracket. Throws on invalid match, invalid
 * slot, already-decided match, or a score inconsistent with the format.
 */
function reportWinner(bracket, matchId, winnerSlotId, scores) {
  const m = matchById(bracket, matchId);
  if (!m) throw new Error(`Unknown match: ${matchId}`);
  if (m.winner) throw new Error(`Match ${matchId} already decided`);
  if (m.isBye) throw new Error('Cannot report a bye match');
  const s = m.slots.find((x) => x.slotId === winnerSlotId);
  if (!s) throw new Error(`Slot ${winnerSlotId} not in match ${matchId}`);
  if (!m.ready || s.teamId === null)
    throw new Error(`Match ${matchId} is not ready to be played`);

  // validate score against the series format
  const winsNeeded = Math.ceil(m.bestOf / 2);
  if (scores !== undefined && scores !== null) {
    if (
      !Array.isArray(scores) ||
      scores.length !== 2 ||
      !Number.isInteger(scores[0]) ||
      !Number.isInteger(scores[1]) ||
      scores[0] < 0 ||
      scores[1] < 0
    )
      throw new Error('scores must be [wins, wins] integers, e.g. [2, 1]');
    const winnerIdx = m.slots.findIndex((x) => x.slotId === winnerSlotId);
    const loserIdx = 1 - winnerIdx;
    if (scores[winnerIdx] < winsNeeded)
      throw new Error(
        `Score invalid: winner needs at least ${winsNeeded} game(s) (Bo${m.bestOf})`
      );
    if (scores[loserIdx] >= winsNeeded)
      throw new Error(
        `Score invalid: loser cannot reach ${winsNeeded} game(s) (Bo${m.bestOf})`
      );
    if (scores[winnerIdx] > winsNeeded)
      throw new Error(
        `Score invalid: winner cannot exceed ${winsNeeded} game(s) (Bo${m.bestOf})`
      );
    m.scores = scores;
  }

  m.winner = winnerSlotId;

  // GF special handling
  if (matchId === 'GF') {
    const hasLbChampion =
      bracket.grandFinal.slots[1].from !== null;
    const lbWon =
      hasLbChampion && winnerSlotId === bracket.grandFinal.slots[1].slotId;
    if (lbWon && !bracket.grandFinalReset) {
      bracket.bracketResetRequired = true;
      const gfr = makeMatch('GFR', [
        slot({
          slotId: bracket.grandFinal.slots[0].slotId,
          teamId: bracket.grandFinal.slots[0].teamId,
          from: bracket.grandFinal.slots[0].from,
        }),
        slot({
          slotId: bracket.grandFinal.slots[1].slotId,
          teamId: bracket.grandFinal.slots[1].teamId,
          from: bracket.grandFinal.slots[1].from,
        }),
      ]);
      gfr.ready = true;
      gfr.bestOf = 5; // the reset set is a final: Bo5 like the GF
      bracket.grandFinalReset = gfr;
    } else {
      bracket.champion = winnerSlotId;
    }
    return bracket;
  }
  if (matchId === 'GFR') {
    bracket.champion = winnerSlotId;
    return bracket;
  }

  resolveSlots(bracket);
  return bracket;
}

function bracketComplete(bracket) {
  return bracket.champion !== null;
}

/**
 * Undo a reported result. Only the most recently reported match in
 * dependency order may be undone (a match whose downstream consumers have
 * already resolved cannot be reverted safely). Clears winner + scores,
 * re-resolves slots, and rolls back champion/GF-reset state if needed.
 * Throws if the match was not decided or is depended upon.
 */
function undoResult(bracket, matchId) {
  const m = matchById(bracket, matchId);
  if (!m) throw new Error(`Unknown match: ${matchId}`);
  if (!m.winner) throw new Error(`Match ${matchId} is not decided yet`);

  // consumers: matches whose slots point at this one. Undo is only safe
  // while no consumer has been *decided* — resolved-but-undecided consumer
  // slots get recomputed by resolveSlots.
  const consumers = allMatches(bracket).filter(
    (o) => o.id !== m.id && o.slots.some((s) => s.from === m.id)
  );
  const depended = consumers.some((o) => o.winner);
  if (depended) {
    throw new Error(
      `Cannot undo ${matchId}: its result already advanced into a later match. Undo the later matches first.`
    );
  }

  // GF/GFR side effects
  if (matchId === 'GF' && bracket.grandFinalReset) {
    throw new Error('Cannot undo the grand final: the bracket reset already exists. Undo it first.');
  }
  if (bracket.champion !== null) {
    // champion was set by GF or GFR; both handled above/by GFR branch
    if (matchId !== 'GF' && matchId !== 'GFR')
      throw new Error('Cannot undo: champion is already crowned.');
    bracket.champion = null;
  }
  if (matchId === 'GFR') {
    bracket.grandFinalReset = null;
    bracket.bracketResetRequired = true;
  }

  m.winner = null;
  m.scores = [0, 0];
  if (matchId === 'GF') bracket.bracketResetRequired = false;
  // reset undecided consumers' slots pointing at this match so
  // resolveSlots recomputes them from the now-undecided source
  for (const o of allMatches(bracket)) {
    if (o.winner) continue;
    for (const s of o.slots) {
      if (s.from !== m.id) continue;
      s.slotId = (s.loser ? 'l' : 'w') + m.id;
      s.teamId = null;
      s.bye = false;
    }
    o.ready = false;
  }
  resolveSlots(bracket);
  return bracket;
}

/**
 * Compute each team's current status from the reported results.
 * Returns Map<teamId, status> where status is 'active' | 'eliminated' | 'champion'.
 * A team is eliminated when it has lost in WB (dropped to LB) and then lost
 * in LB, or lost the GF/GFR.
 */
function teamStatuses(bracket) {
  const status = new Map();
  const bumpLoss = (teamId, where) => {
    if (teamId === null) return;
    if (where === 'WB') {
      // first loss: still alive in LB unless they already lost there
      if (!status.has(teamId)) status.set(teamId, 'wb-lost');
    } else {
      status.set(teamId, 'eliminated');
    }
  };
  for (const r of bracket.winners.rounds)
    for (const m of r.matches) {
      if (m.isBye || !m.winner) continue;
      const loserSlot = m.slots.find((s) => s.slotId !== m.winner);
      if (loserSlot && loserSlot.teamId !== null && !loserSlot.bye)
        bumpLoss(loserSlot.teamId, 'WB');
    }
  for (const r of bracket.losers.rounds)
    for (const m of r.matches) {
      if (m.isBye || !m.winner) continue;
      const loserSlot = m.slots.find((s) => s.slotId !== m.winner);
      if (loserSlot && loserSlot.teamId !== null && !loserSlot.bye)
        bumpLoss(loserSlot.teamId, 'LB');
    }
  for (const m of [bracket.grandFinal, bracket.grandFinalReset].filter(Boolean)) {
    if (m.isBye || !m.winner) continue;
    const loserSlot = m.slots.find((s) => s.slotId !== m.winner);
    if (loserSlot && loserSlot.teamId !== null && !loserSlot.bye)
      bumpLoss(loserSlot.teamId, 'GF');
  }
  const out = new Map();
  for (const [teamId, s] of status) {
    if (s === 'eliminated') out.set(teamId, 'eliminated');
  }
  return out; // teams absent from the map are still alive
}

/**
 * Look up everything about a team's participation: the match it is in next
 * (or currently), its full match history, and its elimination status.
 * Returns { next: {matchId, round, opponent|null, bestOf}|null,
 *            history: [{matchId, round, opponent, won, scores, bestOf}],
 *            eliminated: boolean, champion: boolean }
 */
function teamBracketInfo(bracket, teamId) {
  const history = [];
  let next = null;
  const lbFinalId = bracket.losers.rounds.length
    ? bracket.losers.rounds[bracket.losers.rounds.length - 1].matches.slice(-1)[0].id
    : null;
  const roundName = (m) => {
    if (m.id === 'GF') return 'Grand Final';
    if (m.id === 'GFR') return 'Grand Final Reset';
    if (m.id === lbFinalId) return 'Losers Final';
    const [r, mi] = m.id.slice(1).split('M');
    if (m.id.startsWith('W')) return `Winners R${r}`;
    if (m.id.includes('S')) return `Losers Semifinal ${Number(mi) + 1}`;
    return `Losers R${r} M${Number(mi) + 1}`;
  };
  const opponentFor = (m) => {
    const s = m.slots.find((x) => x.slotId === `t${teamId}`);
    if (!s) return null;
    const other = m.slots.find((x) => x.slotId !== s.slotId);
    if (!other || other.bye) return null;
    return other.teamId !== null ? other.teamId : `winner of ${other.from || '?'}`;
  };

  for (const m of allMatches(bracket)) {
    const s = m.slots.find((x) => x.slotId === `t${teamId}`) ||
              m.slots.find((x) => x.teamId === teamId);
    if (!s) continue;
    const isMySlot = s.slotId === `t${teamId}` || s.teamId === teamId;
    if (!isMySlot) continue;
    const myIdx = m.slots.indexOf(s);
    const other = m.slots[1 - myIdx];
    const opponent = other && !other.bye
      ? (other.teamId !== null ? other.teamId : (other.from ? `winner of ${other.from}` : 'TBD'))
      : null;
    if (m.winner) {
      history.push({
        matchId: m.id,
        round: roundName(m),
        opponent,
        won: m.winner === s.slotId,
        scores: m.scores ? [m.scores[myIdx], m.scores[1 - myIdx]] : [0, 0],
        bestOf: m.bestOf,
      });
    } else if (m.ready && !next && !m.isBye) {
      next = { matchId: m.id, round: roundName(m), opponent, bestOf: m.bestOf };
    }
  }
  const eliminated = teamStatuses(bracket).get(teamId) === 'eliminated';
  const champion = bracket.champion !== null &&
    (bracket.grandFinalReset || bracket.grandFinal).slots.find(
      (s) => s.slotId === bracket.champion
    )?.teamId === teamId;
  return { next, history, eliminated, champion };
}

module.exports = {
  generateBracket,
  reportWinner,
  bracketComplete,
  resolveSlots,
  allMatches,
  undoResult,
  teamStatuses,
  teamBracketInfo,
};
