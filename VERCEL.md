# Deployment — Vercel

## One-time setup

### 1. Create the database (required)
The in-memory fallback does **not** work on Vercel — you need real Postgres.
1. Sign up at [neon.com](https://neon.com) (free tier is enough) and create a project.
2. Copy the connection string (looks like `postgresql://user:password@ep-xxx.neon.tech/dbname?sslmode=require`).

### 2. Deploy to Vercel
```bash
npm i -g vercel
vercel
```
Follow the prompts (accept defaults). Then set the environment variables:
```bash
vercel env add DATABASE_URL      # paste the Neon connection string
vercel env add ADMIN_PASSWORD    # your real admin password
vercel env add SESSION_SECRET    # any long random string
vercel --prod                    # redeploy with env vars applied
```
(You can also set env vars in the Vercel dashboard: Project → Settings → Environment Variables.)

### 3. Initialize the database schema
From your machine, once, against the Neon database:
```bash
DATABASE_URL="<your neon url>" node -e "
const { createPostgresStore } = require('./db');
(async () => { const s = createPostgresStore(process.env.DATABASE_URL); await s.init(); console.log('schema ready'); process.exit(0); })();
"
```

## After deploy
- Your site: `https://<your-project>.vercel.app`
- Admin panel: `https://<your-project>.vercel.app/admin`

## Notes
- Admin sessions now use a signed cookie (stateless), so they survive
  Vercel's serverless cold starts. Logging in again after a deploy is normal.
- Local dev is unchanged: `npm start` still runs `server-entry.js` on port 3000.
- If you redeploy, `vercel --prod` is enough; env vars persist.
