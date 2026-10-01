require('dotenv').config();

async function main() {
  const { createApp } = require('./server');
  let store;

  if (process.env.DATABASE_URL && !/user:password/.test(process.env.DATABASE_URL)) {
    const { createPostgresStore } = require('./db');
    store = createPostgresStore(process.env.DATABASE_URL);
    await store.init();
    console.log('[db] connected to Postgres (Neon)');
  } else {
    const { createMemoryStore } = require('./test/helpers/memory-store');
    store = createMemoryStore();
    await store.init();
    console.warn('[db] DATABASE_URL not set — using IN-MEMORY store (data resets on restart)');
  }

  const app = createApp(store, { adminPassword: process.env.ADMIN_PASSWORD });
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`[server] Valhalla 2v2 running → http://localhost:${port}`);
    console.log(`[server] admin panel → http://localhost:${port}/admin`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
