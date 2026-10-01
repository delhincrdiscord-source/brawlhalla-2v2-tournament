const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  generateBracket,
  reportWinner,
  bracketComplete,
  undoResult,
  teamStatuses,
  teamBracketInfo,
} = require('../lib/bracket');

// helper: build fake teams with elo for seeding
function teams(...elos) {
  return elos.map((elo, i) => ({
    id: i + 1,
    name: `Team ${i + 1}`,
    avgElo: elo,
  }));
}

describe('generateBracket', () => {
  test('4 teams: WB has 2 semifinals, GF exists', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    assert.ok(b.winners);
    assert.ok(b.losers);
    assert.ok(b.grandFinal);
    assert.strictEqual(b.winners.rounds[0].matches.length, 2);
  });

  test('4 teams: seeds are serpentine (1v4, 2v3)', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    const [m1, m2] = b.winners.rounds[0].matches;
    assert.strictEqual(m1.slots[0].seed, 1);
    assert.strictEqual(m1.slots[1].seed, 4);
    assert.strictEqual(m2.slots[0].seed, 2);
    assert.strictEqual(m2.slots[1].seed, 3);
  });

  test('4 teams: WB final feeds GF slot A, LB final feeds GF slot B', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    const wbFinal = b.winners.rounds[b.winners.rounds.length - 1].matches[0];
    assert.strictEqual(b.grandFinal.slots[0].from, wbFinal.id);
    // LB final is last round of losers
    const lbFinal = b.losers.rounds[b.losers.rounds.length - 1].matches[0];
    assert.strictEqual(b.grandFinal.slots[1].from, lbFinal.id);
  });

  test('6 teams: byes present in round 1 (3 matches, one is a bye)', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200, 1100, 1000));
    const r1 = b.winners.rounds[0].matches;
    assert.strictEqual(r1.length, 4); // padded to next power of 2 (8 -> 4 matches)
    const byes = r1.filter((m) => m.isBye);
    assert.strictEqual(byes.length, 2);
  });

  test('6 teams: bye matches auto-advance the team', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200, 1100, 1000));
    const r1 = b.winners.rounds[0].matches;
    const byeMatch = r1.find((m) => m.isBye);
    assert.strictEqual(byeMatch.winner, byeMatch.slots[0].slotId);
  });

  test('rejects fewer than 2 teams', () => {
    assert.throws(() => generateBracket(teams(1500)));
  });

  test('2 teams: degenerate bracket - WB final crowns the champion automatically', () => {
    const b = generateBracket(teams(1500, 1400));
    assert.strictEqual(b.losers.rounds.length, 0);
    assert.strictEqual(b.winners.rounds.length, 1);
    assert.strictEqual(b.grandFinal.ready, false); // resolves after WB final
    const wbFinal = b.winners.rounds[0].matches[0];
    reportWinner(b, wbFinal.id, wbFinal.slots[0].slotId);
    // GF has no opposing LB champion, so it auto-advances and crowns
    assert.strictEqual(bracketComplete(b), true);
    assert.strictEqual(b.champion, wbFinal.slots[0].slotId);
  });

  test('all matches start unresolved except byes', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    for (const round of b.winners.rounds)
      for (const m of round.matches)
        if (!m.isBye) assert.strictEqual(m.winner, null);
  });
});

describe('reportWinner', () => {
  test('4 teams: WB R1 winners advance to WB final', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    const [m1, m2] = b.winners.rounds[0].matches;
    reportWinner(b, m1.id, m1.slots[0].slotId);
    reportWinner(b, m2.id, m2.slots[1].slotId);
    const wbFinal = b.winners.rounds[1].matches[0];
    assert.strictEqual(wbFinal.slots[0].from, m1.id);
    assert.strictEqual(wbFinal.slots[1].from, m2.id);
    assert.strictEqual(wbFinal.ready, true);
  });

  test('WB loser drops into losers bracket slot', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    const [m1, m2] = b.winners.rounds[0].matches;
    reportWinner(b, m1.id, m1.slots[0].slotId); // team seed1 wins, seed4 drops
    const lbR1 = b.losers.rounds[0].matches[0];
    assert.strictEqual(lbR1.slots[0].from, m1.id);
    assert.strictEqual(lbR1.slots[0].loser, true);
  });

  test('reporting an already-decided match is rejected', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    const m1 = b.winners.rounds[0].matches[0];
    reportWinner(b, m1.id, m1.slots[0].slotId);
    assert.throws(() => reportWinner(b, m1.id, m1.slots[1].slotId));
  });

  test('reporting for a slot not in the match is rejected', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    const m1 = b.winners.rounds[0].matches[0];
    assert.throws(() => reportWinner(b, m1.id, 'nope'));
  });

  test('full 4-team run: WB champ and LB champ meet in GF; WB champ wins GF', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    const [m1, m2] = b.winners.rounds[0].matches;
    // seeds 1 and 2 win WB R1
    reportWinner(b, m1.id, m1.slots[0].slotId);
    reportWinner(b, m2.id, m2.slots[0].slotId);
    const wbFinal = b.winners.rounds[1].matches[0];
    reportWinner(b, wbFinal.id, wbFinal.slots[0].slotId); // seed 1 wins WB

    // LB: WB R1 losers meet, then winner faces WB final loser
    const lbR1 = b.losers.rounds[0].matches[0];
    assert.strictEqual(lbR1.ready, true);
    reportWinner(b, lbR1.id, lbR1.slots[0].slotId);
    const lbFinal = b.losers.rounds[b.losers.rounds.length - 1].matches[0];
    assert.strictEqual(lbFinal.ready, true);
    reportWinner(b, lbFinal.id, lbFinal.slots[1].slotId);

    assert.strictEqual(b.grandFinal.ready, true);
    reportWinner(b, b.grandFinal.id, b.grandFinal.slots[0].slotId);
    assert.strictEqual(bracketComplete(b), true);
    assert.strictEqual(b.champion, b.grandFinal.winner);
  });

  test('GF reset: LB champ beats WB champ once -> grandFinalReset appears, second GF decides', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    const [m1, m2] = b.winners.rounds[0].matches;
    reportWinner(b, m1.id, m1.slots[0].slotId);
    reportWinner(b, m2.id, m2.slots[0].slotId);
    const wbFinal = b.winners.rounds[1].matches[0];
    reportWinner(b, wbFinal.id, wbFinal.slots[0].slotId);
    const lbR1 = b.losers.rounds[0].matches[0];
    assert.strictEqual(lbR1.ready, true);
    reportWinner(b, lbR1.id, lbR1.slots[0].slotId);
    const lbFinal = b.losers.rounds[1].matches[0];
    assert.strictEqual(lbFinal.ready, true);
    reportWinner(b, lbFinal.id, lbFinal.slots[0].slotId);

    reportWinner(b, b.grandFinal.id, b.grandFinal.slots[1].slotId); // LB champ wins GF
    assert.strictEqual(b.bracketResetRequired, true);
    assert.ok(b.grandFinalReset, 'reset match exists');
    assert.strictEqual(bracketComplete(b), false);

    reportWinner(b, b.grandFinalReset.id, b.grandFinalReset.slots[0].slotId);
    assert.strictEqual(bracketComplete(b), true);
  });

  test('8 teams: LB has 2 rounds before final structure is consistent', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200, 1100, 1000, 900, 800));
    assert.ok(b.losers.rounds.length >= 2);
    // every WB R1 loser has a LB landing spot after both R1 matches reported
    const r1 = b.winners.rounds[0].matches;
    for (const m of r1) reportWinner(b, m.id, m.slots[0].slotId);
    const lbR1 = b.losers.rounds[0].matches;
    const filled = lbR1.filter((m) => m.ready);
    assert.ok(filled.length >= 2);
  });
});

describe('series formats (Bo3 semis, Bo5 finals)', () => {
  const t8 = teams(1500, 1400, 1300, 1200, 1100, 1000, 900, 800);
  const b8 = generateBracket(t8);

  test('round-1 matches are Bo1 with zeroed scores', () => {
    for (const m of b8.winners.rounds[0].matches) {
      assert.strictEqual(m.bestOf, 1);
      assert.deepStrictEqual(m.scores, [0, 0]);
    }
  });

  test('semifinals are Bo3', () => {
    const semis = b8.winners.rounds[b8.winners.rounds.length - 2].matches;
    for (const m of semis) assert.strictEqual(m.bestOf, 3);
    const lbSemis = b8.losers.rounds[b8.losers.rounds.length - 2].matches;
    for (const m of lbSemis) assert.strictEqual(m.bestOf, 3);
  });

  test('finals are Bo5 (WB final, LB final, GF)', () => {
    const wbFinal = b8.winners.rounds[b8.winners.rounds.length - 1].matches[0];
    assert.strictEqual(wbFinal.bestOf, 5);
    const lbFinal = b8.losers.rounds[b8.losers.rounds.length - 1].matches[0];
    assert.strictEqual(lbFinal.bestOf, 5);
    assert.strictEqual(b8.grandFinal.bestOf, 5);
  });
});

describe('score reporting', () => {
  test('Bo1 match: 1-0 accepted, wrong scores rejected', () => {
    // 8-team bracket: WB R1 matches are true Bo1s
    const b = generateBracket(teams(1500, 1400, 1300, 1200, 1100, 1000, 900, 800));
    const m = b.winners.rounds[0].matches[0];
    const w = m.slots[0].slotId;
    assert.throws(() => reportWinner(b, m.id, w, [2, 0]), /cannot exceed/);
    assert.throws(() => reportWinner(b, m.id, w, [0, 1]), /winner needs at least/);
    reportWinner(b, m.id, w, [1, 0]);
    assert.deepStrictEqual(m.scores, [1, 0]);
    assert.strictEqual(m.winner, w);
  });

  test('Bo3 semifinal: 2-1 accepted, 1-0 rejected, 2-2 rejected', () => {
    // 8-team bracket: WB R1 is separate from the semifinals
    const b = generateBracket(teams(1500, 1400, 1300, 1200, 1100, 1000, 900, 800));
    for (const m of b.winners.rounds[0].matches)
      reportWinner(b, m.id, m.slots[0].slotId);
    const semi = b.winners.rounds[b.winners.rounds.length - 2].matches[0];
    assert.strictEqual(semi.bestOf, 3);
    const w = semi.slots.find((s) => s.teamId !== null).slotId;
    assert.throws(() => reportWinner(b, semi.id, w, [1, 0]), /winner needs at least/);
    assert.throws(() => reportWinner(b, semi.id, w, [2, 2]), /loser cannot reach/);
    assert.throws(() => reportWinner(b, semi.id, w, [3, 1]), /cannot exceed/);
    reportWinner(b, semi.id, w, [2, 1]);
    assert.deepStrictEqual(semi.scores, [2, 1]);
  });

  test('Bo5 grand final: 3-2 accepted', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    for (const m of b.winners.rounds[0].matches) reportWinner(b, m.id, m.slots[0].slotId);
    const wbFinal = b.winners.rounds[1].matches[0];
    reportWinner(b, wbFinal.id, wbFinal.slots[0].slotId, [3, 1]);
    const lbR1 = b.losers.rounds[0].matches;
    for (const m of lbR1) if (m.ready) reportWinner(b, m.id, m.slots[0].slotId);
    // walk the LB to produce a champion, then GF 3-2
    const lbMatches = b.losers.rounds.flatMap((r) => r.matches);
    for (const m of lbMatches) if (m.ready && !m.winner) reportWinner(b, m.id, m.slots[0].slotId);
    const gf = b.grandFinal;
    assert.strictEqual(gf.bestOf, 5);
    const winner = gf.slots.find((s) => s.teamId !== null && !s.bye).slotId;
    reportWinner(b, 'GF', winner, [3, 2]);
    assert.deepStrictEqual(gf.scores, [3, 2]);
  });

  test('scores are optional (defaults preserved)', () => {
    const b = generateBracket(teams(1500, 1400));
    const m = b.winners.rounds[0].matches[0];
    reportWinner(b, m.id, m.slots[0].slotId);
    assert.deepStrictEqual(m.scores, [0, 0]);
    assert.strictEqual(m.winner, m.slots[0].slotId);
  });
});

describe('undoResult', () => {
  test('undoes a result whose consumers are unresolved; clears scores', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    const m = b.winners.rounds[0].matches[0];
    reportWinner(b, m.id, m.slots[0].slotId, [2, 1]);
    undoResult(b, m.id);
    assert.strictEqual(m.winner, null);
    assert.deepStrictEqual(m.scores, [0, 0]);
    // downstream slot is cleared again
    const next = b.winners.rounds[1].matches[0];
    const slotA = next.slots.find((s) => s.from === m.id);
    assert.strictEqual(slotA.teamId, null);
    assert.strictEqual(next.ready, false);
  });

  test('refuses to undo when the result already advanced downstream', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    for (const m of b.winners.rounds[0].matches) reportWinner(b, m.id, m.slots[0].slotId, [2, 1]);
    const wbFinal = b.winners.rounds[1].matches[0];
    reportWinner(b, wbFinal.id, wbFinal.slots[0].slotId, [3, 1]); // downstream decided
    assert.throws(() => undoResult(b, b.winners.rounds[0].matches[0].id), /advanced into/);
  });

  test('refuses to undo an undecided or unknown match', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    assert.throws(() => undoResult(b, 'W1M0'), /not decided/);
    assert.throws(() => undoResult(b, 'NOPE'), /Unknown match/);
  });

  test('GFR undo clears champion and restores bracket-reset state', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    for (const m of b.winners.rounds[0].matches) reportWinner(b, m.id, m.slots[0].slotId, [2, 1]);
    const wbFinal = b.winners.rounds[1].matches[0];
    reportWinner(b, wbFinal.id, wbFinal.slots[0].slotId, [3, 1]);
    const lbR1 = b.losers.rounds[0].matches[0];
    reportWinner(b, lbR1.id, lbR1.slots[0].slotId, [2, 1]);
    const lbFinal = b.losers.rounds[1].matches[0];
    reportWinner(b, lbFinal.id, lbFinal.slots[0].slotId, [3, 2]);
    // LB champion wins GF -> reset
    const lbSlot = b.grandFinal.slots[1];
    reportWinner(b, 'GF', lbSlot.slotId, [2, 3]); // winner is slot 1
    assert.ok(b.grandFinalReset);
    // undo GF refused while the reset exists
    assert.throws(() => undoResult(b, 'GF'), /bracket reset/);
    reportWinner(b, 'GFR', lbSlot.slotId, [2, 3]);
    assert.strictEqual(b.champion, lbSlot.slotId);
    undoResult(b, 'GFR');
    assert.strictEqual(b.champion, null);
    assert.strictEqual(b.grandFinalReset, null);
    assert.strictEqual(b.bracketResetRequired, true);
    // GF result itself is preserved — undo GF separately to unwind further
    assert.strictEqual(b.grandFinal.winner, lbSlot.slotId);
    undoResult(b, 'GF');
    assert.strictEqual(b.grandFinal.winner, null);
    assert.strictEqual(b.bracketResetRequired, false);
  });
});

describe('teamStatuses + teamBracketInfo', () => {
  test('LB loser is eliminated; WB loser is not; champion detected', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    for (const m of b.winners.rounds[0].matches) reportWinner(b, m.id, m.slots[0].slotId);
    const wbLoser = b.winners.rounds[0].matches[0].slots.find(
      (s) => s.slotId !== b.winners.rounds[0].matches[0].winner
    );
    assert.strictEqual(teamStatuses(b).get(wbLoser.teamId), undefined); // still alive in LB
    const lbR1 = b.losers.rounds[0].matches.find((m) => m.ready && !m.isBye);
    reportWinner(b, lbR1.id, lbR1.slots[0].slotId);
    const lbLoser = lbR1.slots.find((s) => s.slotId !== lbR1.winner);
    assert.strictEqual(teamStatuses(b).get(lbLoser.teamId), 'eliminated');

    const info = teamBracketInfo(b, lbLoser.teamId);
    assert.strictEqual(info.eliminated, true);
    assert.strictEqual(info.history.length, 2);
    assert.strictEqual(info.next, null);
  });

  test('next match reports round, opponent and bestOf', () => {
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    const m = b.winners.rounds[0].matches[0];
    reportWinner(b, m.id, m.slots[0].slotId, [2, 1]);
    const winnerTeam = m.slots[0].teamId;
    // final not ready until the other semi is played
    assert.strictEqual(teamBracketInfo(b, winnerTeam).next, null);
    const m2 = b.winners.rounds[0].matches[1];
    reportWinner(b, m2.id, m2.slots[0].slotId, [2, 0]);
    const info = teamBracketInfo(b, winnerTeam);
    assert.ok(info.next);
    assert.strictEqual(info.next.matchId, 'W2M0');
    assert.strictEqual(info.next.bestOf, 5); // 4-team bracket: W2 is the WB final
    assert.strictEqual(info.next.opponent, m2.slots[0].teamId);
    assert.strictEqual(info.history.length, 1);
    assert.deepStrictEqual(info.history[0].scores, [2, 1]);
  });
});

describe('round image rendering', () => {
  test('currentRound picks first undecided round; null when done', () => {
    const { currentRound } = require('../lib/round-image');
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    assert.strictEqual(currentRound(b).key, 'W1');
    for (const m of b.winners.rounds[0].matches) reportWinner(b, m.id, m.slots[0].slotId, [2, 1]);
    assert.strictEqual(currentRound(b).key, 'W2');
  });

  test('renderRoundPng produces a valid PNG of the round', () => {
    const { renderRoundPng } = require('../lib/round-image');
    const b = generateBracket(teams(1500, 1400, 1300, 1200));
    const teamRows = teams(1500, 1400, 1300, 1200).map((t) => ({
      id: t.id, p1: { username: 'P' + t.id }, p2: { username: 'Q' + t.id },
    }));
    const png = renderRoundPng({ key: 'W1', label: 'Winners Round 1', matches: b.winners.rounds[0].matches }, teamRows);
    assert.ok(png.length > 500);
    assert.strictEqual(png[0], 0x89);
    assert.strictEqual(png.toString('ascii', 1, 4), 'PNG');
  });
});
