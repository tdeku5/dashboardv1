# Macro Terminal

A Bloomberg-style U.S. economic dashboard that pulls live data from the [FRED API](https://fred.stlouisfed.org/) (Federal Reserve Bank of St. Louis). It tracks growth, inflation, labour, credit, interest rates, and money supply — all in one terminal-style view.

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | 18 or later |
| npm | 8 or later (ships with Node 18) |

Check your versions:

```sh
node -v   # should print v18.x.x or higher
npm -v    # should print 8.x.x or higher
```

---

## Getting a FRED API Key

FRED API keys are free and take about 30 seconds to get:

1. Go to <https://fred.stlouisfed.org/docs/api/api_key.html>
2. Click **Request API Key** (you'll need to create a free St. Louis Fed account if you don't have one)
3. Fill in the short form — any description is fine
4. Your key will be emailed to you immediately (32 alphanumeric characters)

---

## Adding the Key to .env

Create a file named `.env` in the **project root** (next to `package.json`):

```sh
# .env — project root
FRED_API_KEY=your_32_character_key_here
```

> The `.env` file is listed in `.gitignore` and will never be committed.

If the key is missing or wrong, the dashboard shows a setup screen explaining exactly what to do instead of displaying blank panels.

---

## Install and Run

Install all dependencies (run once from the project root):

```sh
npm install
```

Start both the API server and the Vite dev client together:

```sh
npm run dev
```

| Service | URL |
|---------|-----|
| Dashboard (Vite) | <http://localhost:5173> |
| API proxy (Express) | <http://localhost:3001> |

The browser opens automatically. Data loads within a few seconds.

### Other scripts

```sh
npm run build   # type-check + production build (client + server)
npm run start   # run the compiled server (after build)
```

---

## Project Structure

```
dashboardv1/
├── .env                        # FRED_API_KEY lives here (create this yourself)
├── package.json                # Root workspace — runs both services via concurrently
│
├── client/                     # Vite + React + TypeScript front-end
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx            # React entry point
│       ├── App.tsx             # Mounts <Dashboard />
│       ├── Dashboard.tsx       # Top-bar, grid layout, config-error screen
│       ├── Dashboard.module.css
│       ├── types.ts            # Shared TypeScript interfaces (LiveRow, Cell, …)
│       │
│       ├── components/
│       │   ├── Panel.tsx           # Panel card with coloured header strip
│       │   ├── Panel.module.css
│       │   ├── LiveRow.tsx         # 3-state row: loading skeleton / error / ready
│       │   └── LiveRow.module.css
│       │
│       ├── data/
│       │   ├── panels.ts           # Static panel metadata (id, title, accent colour)
│       │   └── seriesConfig.ts     # 11 FRED series — fetch params + compute() functions
│       │
│       ├── hooks/
│       │   └── useFredData.ts      # Fetches all series concurrently, manages state
│       │
│       ├── lib/
│       │   ├── fred.ts             # fetchFredSeries() — thin fetch wrapper + error types
│       │   └── transforms.ts       # Pure maths helpers (yoyPct, annualisedGrowth, …)
│       │                           # and display formatters (fmtPct, fmtK, …)
│       └── styles/
│           └── globals.css         # CSS variables, resets, body styles
│
└── server/                     # Node + Express API proxy
    ├── package.json
    └── src/
        ├── index.ts            # Express app, CORS, port 3001
        └── routes/
            └── fred.ts         # GET /api/fred — validates params, proxies to FRED API
```

### How data flows

```
Browser
  └─ fetch /api/fred?series_id=UNRATE&...
       │
       ▼
Express (localhost:3001)
  └─ Validates query params
  └─ Checks FRED_API_KEY is set
  └─ Proxies to https://api.stlouisfed.org/fred/series/observations
  └─ Forwards FRED's JSON (or wraps errors with a clear message)
       │
       ▼
fetchFredSeries()  [client/src/lib/fred.ts]
  └─ Parses response, throws on error
       │
       ▼
useFredData()  [client/src/hooks/useFredData.ts]
  └─ Promise.allSettled over all 12 series
  └─ Runs each series' compute() to derive display cells
  └─ Detects config errors (missing/invalid key) vs data errors
       │
       ▼
<Dashboard /> → <Panel /> → <LiveRow />
  └─ Skeleton while loading
  └─ Setup screen if key is missing/invalid
  └─ Error row if individual series fails
  └─ Ready row with computed values
```

### Adding a new series

1. Open `client/src/data/seriesConfig.ts`
2. Add an entry to `SERIES_DEFS` following the existing pattern — pick a FRED series ID, assign it to a `panelId`, and write a `compute()` function that returns four `Cell` objects
3. The series will be fetched and rendered automatically — no other wiring needed

---

## Data sources

All data is sourced live from the [FRED API](https://fred.stlouisfed.org/) operated by the Federal Reserve Bank of St. Louis. Series included:

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
