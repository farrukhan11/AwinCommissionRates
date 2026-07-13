# Awin Merchant Sync

Phase 1 setup for synchronizing Awin merchant programme details into MongoDB.

## Setup

1. Copy the environment template:

```bash
cp .env.example .env.local
```

2. Fill in `.env.local` with your credentials:

- `MONGODB_URI` — MongoDB connection string
- `AWIN_API_TOKEN` — Awin API bearer token (server-side only)
- `AWIN_PUBLISHER_ID` — defaults to `1951827`
- `ADMIN_API_KEY` — protects the test API route

3. Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000).

## Test the Awin sync endpoint

Replace `YOUR_ADMIN_API_KEY` with the value from `.env.local`.

### curl (macOS/Linux)

```bash
curl -X POST http://localhost:3000/api/awin/test-program \
  -H "Content-Type: application/json" \
  -H "x-admin-api-key: YOUR_ADMIN_API_KEY" \
  -d '{"advertiserId":55541}'
```

### PowerShell (Windows)

```powershell
Invoke-RestMethod `
  -Method POST `
  -Uri "http://localhost:3000/api/awin/test-program" `
  -Headers @{"x-admin-api-key"="YOUR_ADMIN_API_KEY"} `
  -ContentType "application/json" `
  -Body '{"advertiserId":55541}'
```

## Phase 1 scope

- Next.js App Router project with TypeScript and Tailwind CSS
- MongoDB connection with Mongoose
- Reusable Awin API client
- Protected test route for a single advertiser sync

Live testing requires valid `MONGODB_URI`, `AWIN_API_TOKEN`, and `ADMIN_API_KEY` values.
