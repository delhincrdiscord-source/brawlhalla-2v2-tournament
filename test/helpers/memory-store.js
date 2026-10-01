/**
 * In-memory store matching the db.js interface, used for integration tests.
 * (Also useful as a fallback when DATABASE_URL is not configured.)
 */
function createMemoryStore() {
  let teams = [];
  let registrationOpen = true;
  let tournamentStart = null;
  let bracket = null;
  let nextId = 1;
  const settings = {};

  return {
    async init() {},
    _reset() {
      teams = [];
      registrationOpen = true;
      tournamentStart = null;
      bracket = null;
      nextId = 1;
      for (const k of Object.keys(settings)) delete settings[k];
    },
    listTeams() {
      return teams;
    },
    async getTeams() {
      return teams;
    },
    async getTeam(id) {
      return teams.find((t) => t.id === id) || null;
    },
    async insertTeam(team) {
      const row = { id: nextId++, registeredAt: new Date().toISOString(), ...team };
      teams.push(row);
      return row;
    },
    async deleteTeam(id) {
      const before = teams.length;
      teams = teams.filter((t) => t.id !== id);
      return teams.length < before;
    },
    getRegistrationOpen() {
      return registrationOpen;
    },
    async setRegistrationOpen(open) {
      registrationOpen = open;
    },
    getTournamentStart() {
      return tournamentStart;
    },
    async setTournamentStart(iso) {
      tournamentStart = iso;
    },
    getBracket() {
      return bracket;
    },
    async saveBracket(b) {
      bracket = b;
    },
    async clearBracket() {
      bracket = null;
    },
    async getSetting(key) {
      return settings[key] ?? null;
    },
    async setSetting(key, value) {
      settings[key] = value;
    },
  };
}

module.exports = { createMemoryStore };
