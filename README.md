# Macro Terminal

A Bloomberg-style U.S. economic dashboard that pulls data from the [FRED API](https://fred.stlouisfed.org/) (Federal Reserve Bank of St. Louis). It tracks growth, inflation, labour, credit, interest rates, and money supply — all in one terminal-style view.

---

## Architecture

Data is stored locally in a SQLite database (`fred_data.db` at the project root) and served by the Express API. The browser never calls FRED directly.

```
Browser
  └─ fetch /api/fred?series_id=UNRATE
       │
       ▼
Express (localhost:3001)
  └─ Reads from fred_data.db (SQLite)
  └─ Returns same JSON shape as FRED API
       │
       ▼
fetchFredSeries()  [client/src/lib/fred.ts]
  └─ Parses response, throws on error
       │
       ▼
useFredData()  [client/src/hooks/useFredData.ts]
  └─ Promise.allSettled over all series
  └─ Runs each series' compute() to derive display cells
       │
       ▼
<Dashboard /> → <Panel /> → <LiveRow />
```

### Database refresh

| Trigger | Behaviour |
|---------|-----------|
| Server startup (empty DB) | Fetches all 70 series from FRED before accepting requests |
| Server startup (stale data) | Refreshes stale series in the background, server starts immediately |
| Daily cron (06:00 UTC) | Re-fetches any series older than 20 hours |
| Refresh button in UI | Forces a full re-fetch of all series, waits for completion |
| `npm run fetch` | Runs the standalone fetch script manually |

A series is considered stale if it has not been fetched in the last **20 hours**.

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | 18 or later |
| npm | 8 or later (ships with Node 18) |

```sh
node -v   # should print v18.x.x or higher
npm -v    # should print 8.x.x or higher
```

---

## Getting a FRED API Key

FRED API keys are free and take about 30 seconds to get:

1. Go to <https://fred.stlouisfed.org/docs/api/api_key.html>
2. Click **Request API Key** (you'll need a free St. Louis Fed account)
3. Fill in the short form — any description is fine
4. Your key will be emailed to you immediately (32 alphanumeric characters)

---

## Setup

**1. Add the key to `.env`**

Create a file named `.env` in the **project root** (next to `package.json`):

```sh
# .env — project root
FRED_API_KEY=your_32_character_key_here
```

> The `.env` file is listed in `.gitignore` and will never be committed.

**2. Install dependencies**

```sh
npm install
```

**3. Start the dev server**

```sh
npm run dev
```

On the first run the server will automatically fetch all ~70 series from FRED and populate `fred_data.db` before accepting browser requests. This takes about 30–60 seconds. You'll see progress in the server terminal:

```
[startup] Database is empty — running initial fetch (this may take ~1 min)…
[fetch]  OK    [1/70] PAYEMS — 936 obs
[fetch]  OK    [2/70] UNRATE — 936 obs
…
[startup] Initial fetch complete.
Server running on http://localhost:3001
```

| Service | URL |
|---------|-----|
| Dashboard (Vite) | <http://localhost:5173> |
| API server (Express) | <http://localhost:3001> |

---

## Manual data fetch

To populate or refresh the database without starting the full server:

```sh
npm run fetch
```

This runs `server/src/fetchAllSeries.ts` directly and always forces a full re-fetch of every series. Useful for seeding the DB on a new machine or recovering from a corrupted database.

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/fred?series_id=PAYEMS&observation_start=2020-01-01` | Serve observations from SQLite. Accepts optional `frequency` and `aggregation_method` params for downsampling. |
| `GET` | `/api/fred/status` | Returns `{ lastUpdated, seriesCount }` — when the DB was last written and how many series are stored. |
| `POST` | `/api/fred/refresh` | Force a full re-fetch of all 70 series from FRED. Blocks until complete. Returns `{ success, lastUpdated, seriesCount }`. Returns 409 if a refresh is already running. |
| `GET` | `/api/health` | Server health check — returns `{ status: "ok" }`. |

---

## Project structure

```
dashboardv1/
├── .env                          # FRED_API_KEY lives here (create this yourself)
├── fred_data.db                  # SQLite database — auto-created on first run
├── package.json                  # Root workspace — runs both services via concurrently
│
├── client/                       # Vite + React + TypeScript front-end
│   └── src/
│       ├── Dashboard.tsx         # Top-bar (shows "Data as of" timestamp), grid layout
│       ├── hooks/
│       │   └── useFredData.ts    # Fetches panels from SQLite, drives refresh
│       ├── lib/
│       │   └── fred.ts           # fetchFredSeries(), fetchDbStatus(), triggerRefresh()
│       └── data/
│           └── seriesConfig.ts   # Series definitions + compute() functions
│
└── server/                       # Node + Express API
    └── src/
        ├── index.ts              # Startup (seed DB if empty, background stale refresh, cron)
        ├── db.ts                 # SQLite connection, schema, query helpers
        ├── fetchAllSeries.ts     # Fetch pipeline — pulls from FRED, writes to SQLite
        └── routes/
            └── fred.ts           # /api/fred, /api/fred/status, /api/fred/refresh
```

### Adding a new series

1. Add the FRED series ID to `ALL_SERIES` in `server/src/fetchAllSeries.ts`
2. Add an entry to `SERIES_DEFS` in `client/src/data/seriesConfig.ts` with a `compute()` function
3. Run `npm run fetch` to populate the new series in the database (or just restart the server — it will refresh stale series on startup)

---

## Data sources

All data is sourced from the [FRED API](https://fred.stlouisfed.org/) operated by the Federal Reserve Bank of St. Louis.

| Panel | Series | FRED ID | Frequency |
|-------|--------|---------|-----------|
| Growth | Nominal GDP | GDP | Quarterly |
| Growth | Real GDP | GDPC1 | Quarterly |
| Inflation | Core PCE Price Index | PCEPILFE | Monthly |
| Inflation | Core CPI | CPILFESL | Monthly |
| Inflation | Avg Hourly Earnings | CES0500000003 | Monthly |
| Labor Market | Unemployment Rate | UNRATE | Monthly |
| Labor Market | Nonfarm Payrolls | PAYEMS | Monthly |
| Consumer | Real Personal Income | RPI | Monthly |
| Consumer | Real PCE | DPCERA3M086SBEA | Monthly |
| Consumer | Retail Sales | RSXFS | Monthly |
| Industry | Industrial Production | INDPRO | Monthly |
| Industry | Durable Goods Orders | DGORDER | Monthly |
