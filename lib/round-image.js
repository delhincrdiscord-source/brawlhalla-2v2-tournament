/**
 * Dependency-free PNG renderer for "current round" bracket images.
 * Draws match cards with a 3x5 bitmap font (uppercase) onto an RGBA
 * framebuffer and encodes a PNG with zlib — no native deps, so it works
 * identically locally and on Vercel serverless.
 */
const zlib = require('zlib');

// ---- tiny 3x5 bitmap font (row-major, 3 bits per row, 5 rows) ----
const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011',
  D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111',
  J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111101101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101010001', R: '110101110101101',
  S: '011100010001110', T: '111010010010010', U: '101101101101111',
  V: '101101101101010', W: '101101101111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111',
  3: '111001011001111', 4: '101101111001001', 5: '111100111001111',
  6: '111100111101111', 7: '111001001010010', 8: '111101111101111',
  9: '111101111001111',
  '-': '000000111000000', ':': '000010000010000', '.': '000000000000010',
  '/': '001001010100100', '#': '101111101111101', '?': '111001011000010',
  '(': '010100100100010', ')': '010001001001010', '+': '000010111010000',
  '!': '010010010000010', "'": '010010000000000', ',': '000000000010100',
  '&': '010101010101011', '%': '101001010100101', '_': '000000000000111',
};

// ---- colors ----
const C = {
  bg: [13, 13, 31],
  card: [24, 24, 52],
  cardEdge: [58, 58, 100],
  gold: [255, 194, 75],
  cyan: [53, 230, 255],
  white: [235, 235, 245],
  dim: [140, 140, 175],
  red: [255, 77, 109],
  title: [255, 194, 75],
};

function createCanvas(w, h) {
  return { w, h, data: Buffer.alloc(w * h * 4) };
}
function px(c, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  c.data[i] = r; c.data[i + 1] = g; c.data[i + 2] = b; c.data[i + 3] = a;
}
function rect(c, x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) px(c, xx, yy, color);
}
function rectOutline(c, x, y, w, h, color) {
  rect(c, x, y, w, 1, color); rect(c, x, y + h - 1, w, 1, color);
  rect(c, x, y, 1, h, color); rect(c, x + w - 1, y, 1, h, color);
}

// text drawing: scale s, char 3s x 5s, pitch 4s
function textWidth(str, s = 2) { return str.length * 4 * s - s; }
function text(c, x, y, str, color, s = 2) {
  str = String(str).toUpperCase();
  let cx = x;
  for (const ch of str) {
    const glyph = FONT[ch] || FONT['?'];
    for (let i = 0; i < 15; i++) {
      if (glyph[i] === '1') {
        for (let dy = 0; dy < s; dy++)
          for (let dx = 0; dx < s; dx++)
            px(c, cx + (i % 3) * s + dx, y + Math.floor(i / 3) * s + dy, color);
      }
    }
    cx += 4 * s;
  }
}

// ---- PNG encoding ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(canvas) {
  const { w, h, data } = canvas;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    data.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- round selection ----
function allRounds(bracket) {
  const rounds = [];
  bracket.winners.rounds.forEach((r, i) =>
    rounds.push({ key: 'W' + (i + 1), label: 'Winners Round ' + (i + 1), matches: r.matches }));
  bracket.losers.rounds.forEach((r, i) =>
    rounds.push({ key: 'L' + (i + 1), label: 'Losers Round ' + (i + 1), matches: r.matches }));
  rounds.push({ key: 'GF', label: 'Grand Final', matches: [bracket.grandFinal] });
  if (bracket.grandFinalReset)
    rounds.push({ key: 'GFR', label: 'Grand Final Reset', matches: [bracket.grandFinalReset] });
  return rounds;
}

/**
 * The round currently being played: the first round (in play order) that
 * still has an undecided real match. While WB R1 runs this is WB R1; when
 * it ends, WB R2 becomes current — matching "post this round, then the
 * next one after it ends". Returns null when the bracket is complete.
 */
function currentRound(bracket) {
  for (const r of allRounds(bracket))
    if (r.matches.some((m) => !m.isBye && !m.winner)) return r;
  return null;
}

// ---- rendering ----
function slotName(s, teams) {
  if (s.bye) return 'BYE';
  if (s.teamId !== null) {
    const t = teams.get(s.teamId);
    return t ? `${t.p1.username} / ${t.p2.username}` : `TEAM ${s.teamId}`;
  }
  if (s.from) return (s.loser ? 'LOSER OF ' : 'WINNER OF ') + s.from;
  return 'TBD';
}
function clip(str, n) {
  str = String(str);
  return str.length > n ? str.slice(0, n - 1) + '.' : str;
}

function renderRoundPng(round, teamsArr) {
  const teams = new Map(teamsArr.map((t) => [t.id, t]));
  const S = 2; // text scale
  const cardW = 620, cardH = 78, gap = 16, pad = 24, titleH = 56;
  const real = round.matches.filter((m) => !m.isBye);
  const matches = real.length ? real : round.matches;
  const height = pad + titleH + matches.length * (cardH + gap) + pad;
  const width = pad * 2 + cardW;
  const c = createCanvas(width, height);
  rect(c, 0, 0, width, height, C.bg);

  text(c, pad, pad, round.label.toUpperCase(), C.title, 4);
  const nReal = matches.length;
  text(c, pad, pad + 34, `${nReal} MATCH${nReal === 1 ? '' : 'ES'}`, C.dim, S);

  let y = pad + titleH;
  for (const m of matches) {
    rect(c, pad, y, cardW, cardH, C.card);
    rectOutline(c, pad, y, cardW, cardH, m.winner ? C.gold : m.ready ? C.cyan : C.cardEdge);
    // status top-right
    const status = m.winner ? 'FINAL' : m.ready ? 'READY' : 'PENDING';
    const statusColor = m.winner ? C.gold : m.ready ? C.cyan : C.dim;
    text(c, pad + cardW - textWidth(status, S) - 12, y + 8, status, statusColor, S);
    text(c, pad + 12, y + 8, `${m.id}${m.bestOf > 1 ? ' - BO' + m.bestOf : ''}`, C.dim, S);

    m.slots.forEach((s, i) => {
      const rowY = y + 28 + i * 24;
      const isWin = m.winner === s.slotId;
      const nameColor = s.bye || s.teamId === null ? C.dim : isWin ? C.gold : C.white;
      text(c, pad + 12, rowY, clip(slotName(s, teams), 30), nameColor, S);
      if (m.winner && !m.isBye) {
        const score = String((m.scores || [0, 0])[i]);
        text(c, pad + cardW - textWidth(score, S) - 12, rowY, score, isWin ? C.gold : C.dim, S + 1);
      }
    });
    y += cardH + gap;
  }
  return encodePng(c);
}

module.exports = { currentRound, renderRoundPng, encodePng, allRounds };
