# Awin Commission Rates

Production-ready JavaScript/JSX Next.js and MongoDB system for importing the complete Awin programme directory and synchronizing each advertiser's programme details and commission range.

The application source uses `.js` and `.jsx` files with `jsconfig.json` path aliases. There is no TypeScript source or `tsconfig.json`.

## What is implemented

- Phase 1: reusable Awin API client and single-advertiser test
- Phase 2: complete programme directory import with bulk upserts
- Phase 3: resumable, rate-limited background detail worker
- Phase 4: admin dashboard, search, filters, controls, and CSV export
- Phase 5: PM2 deployment, recurring scheduler, health endpoint, and GitHub Actions CI

The detail worker sends one request approximately every 3.2 seconds, remaining below Awin's 20-calls-per-minute user limit. Each response is saved immediately. If the worker or server restarts, processing resumes from MongoDB.

## Requirements

- Node.js 22 recommended
- MongoDB
- Awin publisher API token
- PM2 for production

## Setup

```bash
cp .env.example .env.local
npm install
```

Fill in `.env.local`:

```env
MONGODB_URI=mongodb+srv://...
AWIN_API_TOKEN=...
AWIN_PUBLISHER_ID=1951827
ADMIN_API_KEY=use-a-long-random-secret
APP_BASE_URL=http://127.0.0.1:3000
AWIN_SCHEDULER_ENABLED=false
AWIN_DIRECTORY_SYNC_INTERVAL_HOURS=24
AWIN_DETAIL_SYNC_INTERVAL_HOURS=168
AWIN_DETAIL_STALE_AFTER_DAYS=30
```

Generate an admin key, for example:

```bash
openssl rand -hex 32
```

## Development

```bash
npm run dev
```

Open:

- Home: `http://localhost:3000`
- Admin dashboard: `http://localhost:3000/dashboard`
- Health: `http://localhost:3000/api/health`

The dashboard asks for `ADMIN_API_KEY`. The key is kept in browser session storage and is never bundled into the application.

## Complete first-time synchronization

### 1. Import every programme

```bash
curl -X POST http://localhost:3000/api/awin/import-programmes \
  -H "Content-Type: application/json" \
  -H "x-admin-api-key: YOUR_ADMIN_API_KEY" \
  -d '{"includeHidden":true}'
```

This creates the merchant master list. Existing commission detail data is preserved.

### 2. Start the detail worker

Development terminal:

```bash
npm run worker
```

The worker can be started before or after creating a detail run. It waits when no run exists.

### 3. Queue missing programme details

```bash
curl -X POST http://localhost:3000/api/awin/detail-sync/start \
  -H "Content-Type: application/json" \
  -H "x-admin-api-key: YOUR_ADMIN_API_KEY" \
  -d '{"mode":"missing"}'
```

Supported modes:

- `missing`: merchants without saved programme details
- `stale`: details older than `staleAfterDays`
- `failed`: retry previously failed merchants
- `all`: refresh every active merchant
- `selected`: synchronize up to 1,000 supplied advertiser IDs

Selected example:

```json
{
  "mode": "selected",
  "advertiserIds": [55541, 12345]
}
```

### 4. Check progress

```bash
curl http://localhost:3000/api/awin/detail-sync/status \
  -H "x-admin-api-key: YOUR_ADMIN_API_KEY"
```

The response includes queued, processed, successful, failed, retry and rate-limit counts, progress percentage, heartbeat, and estimated remaining time.

## Pause, resume, or cancel

```bash
curl -X POST http://localhost:3000/api/awin/detail-sync/control \
  -H "Content-Type: application/json" \
  -H "x-admin-api-key: YOUR_ADMIN_API_KEY" \
  -d '{"action":"pause"}'
```

Replace `pause` with `resume` or `cancel`. A specific `runId` may also be supplied.

## Merchant API

```bash
curl "http://localhost:3000/api/awin/merchants?page=1&limit=25&search=nike&syncStatus=completed" \
  -H "x-admin-api-key: YOUR_ADMIN_API_KEY"
```

Filters:

- `search`
- `syncStatus`
- `directoryStatus`
- `countryCode`
- `membershipStatus`
- `page`
- `limit` (maximum 100)

## CSV export

```bash
curl http://localhost:3000/api/awin/export \
  -H "x-admin-api-key: YOUR_ADMIN_API_KEY" \
  -o awin-merchants.csv
```

The export includes advertiser ID, name, relationship, country, currency, sector, commission range, status, and last sync error.

## Production deployment with PM2

```bash
npm ci
npm run build
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Useful commands:

```bash
pm2 status
pm2 logs awin-detail-worker --lines 100
pm2 logs awin-web --lines 100
pm2 restart ecosystem.config.cjs --update-env
```

The PM2 configuration runs:

- `awin-web`: Next.js production server
- `awin-detail-worker`: one resumable Awin worker
- `awin-scheduler`: optional recurring scheduler

Only one detail worker instance should run for the Awin user because the API limit is shared per user.

## Recurring automatic refresh

Set:

```env
AWIN_SCHEDULER_ENABLED=true
```

Defaults:

- programme directory: every 24 hours
- stale programme details: every 168 hours
- stale threshold: 30 days

The scheduler stores its next-run timestamps in `.awin-scheduler-state.json`. HTTP `409` responses are treated as safe no-ops when another import or detail run is already active.

## API routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/awin/test-program` | Test one advertiser |
| POST | `/api/awin/import-programmes` | Import all programmes |
| GET | `/api/awin/import-programmes/status` | Directory import status |
| POST | `/api/awin/detail-sync/start` | Queue a detail run |
| POST | `/api/awin/detail-sync/control` | Pause, resume, or cancel |
| GET | `/api/awin/detail-sync/status` | Detail run status and ETA |
| GET | `/api/awin/merchants` | Paginated merchant list |
| GET | `/api/awin/export` | CSV export |
| GET | `/api/health` | Safe health check |

All Awin administration routes require the `x-admin-api-key` header. The health endpoint does not expose credentials.

## Validation

```bash
npm test
npm run lint
npm run build
node --check scripts/awin-detail-worker.mjs
node --check scripts/awin-scheduler.mjs
```

GitHub Actions runs JavaScript tests, linting, worker syntax checks, and the production build for pushes and pull requests.

## Operational behavior

- Complete raw Awin responses are retained in MongoDB.
- Commission minimum, maximum, and type are extracted for search/export.
- Directory imports use batches of 500 and do not overwrite detail data.
- Duplicate advertiser IDs are deduplicated before MongoDB writes.
- A unique lock prevents simultaneous directory imports.
- A unique lock and expiring worker lease prevent simultaneous detail runs/workers.
- `429` responses respect `Retry-After` and pause safely.
- Temporary errors use exponential retries.
- Authentication or permission errors stop the run instead of failing thousands of merchants.
- Merchants are never deleted when missing from a later directory response.
