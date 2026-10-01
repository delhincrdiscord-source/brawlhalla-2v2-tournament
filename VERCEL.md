# Deployment — Vercel

**Live site:** https://brawlhalla-2v2-tournament-phi.vercel.app
**Admin panel:** https://brawlhalla-2v2-tournament-phi.vercel.app/admin
**Vercel project:** `delhincrdiscord-3937s-projects/brawlhalla-2v2-tournament`
**GitHub:** `delhincrdiscord-source/brawlhalla-2v2-tournament` (branch `main`)

## Deploying changes

Vercel is connected to the GitHub repo with **production branch `main`**, so a
push is all it takes:

```bash
git add -A && git commit -m "your change" && git push
```
Vercel builds and promotes it to production automatically (~15s).

To deploy the local working copy without committing (e.g. to preview a fix):
```bash
vercel deploy --prod --yes
```

## One-time setup (already done)

### Environment variables
Set in Vercel → Project → Settings → Environment Variables (Production + Preview):
- `DATABASE_URL` — Neon connection string (pooled or direct; see below)
- `ADMIN_PASSWORD` — admin login password
- `SESSION_SECRET` — long random string used to sign admin cookies
- optional: `DISCORD_WEBHOOK_STATUS`, `DISCORD_WEBHOOK_REGISTRATIONS`, `DISCORD_WEBHOOK_ROUNDS`

### Database schema
```bash
DATABASE_URL="<your neon url>" node -e "
const { createPostgresStore } = require('./db');
(async () => { const s = createPostgresStore(process.env.DATABASE_URL); await s.init(); console.log('schema ready'); process.exit(0); })();
"
```

## Neon connection strings — important

Paste **either** the direct or the pooled string; `db.js` does the right thing.

On Vercel the app automatically rewrites the host to Neon's **pooled** endpoint
(`ep-xxxx-pooler...`) so many short-lived lambda instances don't exhaust Neon's
connection limit. Two things matter:

- `-pooler` is inserted into the **endpoint id**, not before `.neon.tech`:
  `ep-abc.c-4.us-east-1.aws.neon.tech` → `ep-abc-pooler.c-4.us-east-1.aws.neon.tech`
- The port stays **5432**. Port `6543` is not reachable on current Neon endpoints
  and produces `ETIMEDOUT`.

Local dev (`VERCEL` unset) uses your string exactly as given.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `FUNCTION_INVOCATION_FAILED` | Serverless function threw on cold start — usually DB | `vercel logs <url>` shows the real error |
| `ENOTFOUND ...neon.tech` | Bad host in `DATABASE_URL` | Check the endpoint id spelling |
| `ETIMEDOUT ...:6543` | Pooler port 6543 unreachable | Use port 5432 (the default) |
| Page loads, data empty | Schema not initialized | Run the schema snippet above |

Useful commands:
```bash
vercel logs https://brawlhalla-2v2-tournament-phi.vercel.app   # runtime errors
vercel ls brawlhalla-2v2-tournament                            # deploy history
vercel env ls                                                  # env var names
```

## Notes
- Admin sessions use a signed stateless cookie, so they survive serverless cold
  starts. Logging in again after a deploy is normal.
- Local dev: `npm start` runs `server-entry.js` (port from `PORT` in `.env`).
- Every push to `main` deploys; other branches get preview URLs.
