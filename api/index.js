const { createApp } = require('../server');

/**
 * Vercel serverless entry. Creates the Postgres store once per lambda
 * instance (reused across warm invocations) and exports the Express app
 * via the Node.js helper.
 */
let cachedApp = null;

async function getApp() {
  if (cachedApp) return cachedApp;
  const { createPostgresStore } = require('../db');
  const store = createPostgresStore(process.env.DATABASE_URL);
  await store.init();
  cachedApp = createApp(store, {
    adminPassword: process.env.ADMIN_PASSWORD,
    sessionSecret: process.env.SESSION_SECRET,
  });
  return cachedApp;
}

module.exports = async (req, res) => {
  const app = await getApp();
  app(req, res);
};
