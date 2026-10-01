/**
 * Discord webhook notifications. Webhook URLs come from env:
 *   DISCORD_WEBHOOK_STATUS        — registration open/close announcements
 *   DISCORD_WEBHOOK_REGISTRATIONS — new team registrations (embed with details)
 * All posts are fire-and-forget: a webhook failure must never break the
 * user-facing request, so errors are logged and swallowed.
 */

function postWebhook(url, payload) {
  if (!url) return Promise.resolve(false);
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.error('Webhook failed:', err.message);
    return false;
  });
}

function announceRegistration(open, teamCount) {
  return postWebhook(process.env.DISCORD_WEBHOOK_STATUS, {
    username: 'Tournament Bot',
    embeds: [
      {
        title: open ? '🔔 Registration Open' : '🔒 Registration Closed',
        description: open
          ? 'Registration is now **OPEN**! Grab your duo and sign up on the website.'
          : 'Registration is now **CLOSED**. The bracket will be generated soon — check the website.',
        color: open ? 0x35e6ff : 0xff4d6d,
        fields: [{ name: 'Teams Registered', value: String(teamCount), inline: true }],
        timestamp: new Date().toISOString(),
      },
    ],
  });
}

function teamEmbed(team) {
  const fmt = (p, label) =>
    `**${p.username}**\n<@${p.discordId}>\nElo: ${p.elo} · Peak: ${p.peak}`;
  return {
    title: `🛡️ New Team Registered — #${team.id}`,
    color: 0xffc24b,
    fields: [
      { name: 'Player 1', value: fmt(team.p1), inline: true },
      { name: 'Player 2', value: fmt(team.p2), inline: true },
      { name: 'Average Elo', value: String(Math.round((team.p1.elo + team.p2.elo) / 2)), inline: true },
    ],
    footer: { text: 'Brawlhalla 2v2 Championship' },
    timestamp: team.registeredAt || new Date().toISOString(),
  };
}

function announceTeamRegistered(team) {
  return postWebhook(process.env.DISCORD_WEBHOOK_REGISTRATIONS, {
    username: 'Tournament Bot',
    embeds: [teamEmbed(team)],
  });
}

module.exports = { postWebhook, announceRegistration, announceTeamRegistered, teamEmbed };
