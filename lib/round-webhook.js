/**
 * Round-image webhook: after match reports, when the current round changes
 * (previous round fully decided), POST a PNG of the new round's matches to
 * Discord via multipart/form-data. Fire-and-forget like the other webhooks.
 */
const { currentRound, renderRoundPng } = require('./round-image');

/**
 * Compute and send the round-transition announcement if the current round
 * has changed since lastRoundKey. Returns the round key posted (or null).
 */
async function maybePostRoundImage(bracket, teams, lastRoundKey) {
  const round = currentRound(bracket);
  const key = round ? round.key : 'DONE';
  if (key === lastRoundKey) return null;

  const url = process.env.DISCORD_WEBHOOK_ROUNDS;
  if (!url) return key; // still advance the tracker so we don't re-post later

  const form = new FormData();
  if (round) {
    form.append(
      'payload_json',
      JSON.stringify({
        username: 'Tournament Bot',
        content: `⚔️ **${round.label}** — current round in progress`,
      })
    );
    const png = renderRoundPng(round, teams);
    form.append('files[0]', new Blob([png], { type: 'image/png' }), {
      filename: `${round.key}.png`,
    });
  } else {
    form.append(
      'payload_json',
      JSON.stringify({
        username: 'Tournament Bot',
        content: '🏆 **The bracket is complete!** All rounds have been played.',
      })
    );
  }
  await fetch(url, { method: 'POST', body: form }).catch((err) =>
    console.error('Round webhook failed:', err.message)
  );
  return key;
}

module.exports = { maybePostRoundImage };
