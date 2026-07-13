# Awin Merchant Sync

Phase 2 setup for importing the complete Awin programme directory into MongoDB.

## Setup

1. Copy the environment template:

```bash
cp .env.example .env.local
```

2. Fill in `.env.local` with your credentials:

- `MONGODB_URI` — MongoDB connection string
- `AWIN_API_TOKEN` — Awin API bearer token (server-side only)
- `AWIN_PUBLISHER_ID` — defaults to `1951827`
- `ADMIN_API_KEY` — protects the API routes

3. Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000).

## Phase 2: Import the programme master list

This imports the complete Awin programme directory for publisher `1951827`, including joined and not-joined programmes. It does **not** fetch individual `programmedetails` for every merchant yet.

- Existing merchant detail data from Phase 1 is preserved
- Running the import again updates existing merchants without creating duplicates
- Merchants missing from a later import are marked `missing`, not deleted

Replace `YOUR_ADMIN_API_KEY` with the value from `.env.local`.

### Start the programme import

#### curl (macOS/Linux)

```bash
curl -X POST http://localhost:3000/api/awin/import-programmes \
  -H "Content-Type: application/json" \
  -H "x-admin-api-key: YOUR_ADMIN_API_KEY" \
  -d '{"includeHidden":true}'
```

#### PowerShell (Windows)

```powershell
Invoke-RestMethod `
  -Method POST `
  -Uri "http://localhost:3000/api/awin/import-programmes" `
  -Headers @{"x-admin-api-key"="YOUR_ADMIN_API_KEY"} `
  -ContentType "application/json" `
  -Body '{"includeHidden":true}'
```

### Check import status

#### curl (macOS/Linux)

```bash
curl http://localhost:3000/api/awin/import-programmes/status \
  -H "x-admin-api-key: YOUR_ADMIN_API_KEY"
```

#### PowerShell (Windows)

```powershell
Invoke-RestMethod `
  -Method GET `
  -Uri "http://localhost:3000/api/awin/import-programmes/status" `
  -Headers @{"x-admin-api-key"="YOUR_ADMIN_API_KEY"}
```

## Phase 1: Test a single advertiser detail sync

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

## Validation

```bash
npm run test
npm run lint
npm run build
```

Live testing requires valid `MONGODB_URI`, `AWIN_API_TOKEN`, and `ADMIN_API_KEY` values.
