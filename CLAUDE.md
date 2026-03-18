# TND Research Terminal — Project Guide

## Skills
When looking up FRED series codes, always read `.claude/skills/fred-lookup/SKILL.md` before proceeding.

## Tech Stack
- **Frontend:** React 18 + TypeScript, Vite dev server (localhost:5173), React Router v6, Recharts, CSS Modules
- **Backend:** Node.js + Express + TypeScript (localhost:3001)
- **Database:** SQLite via `better-sqlite3` (file: `fred_data.db` at project root)
- **Environment:** `.env` at project root (FRED_API_KEY, BEA_API_KEY, ANTHROPIC_API_KEY)
- **Dev runner:** `npm run dev` from root uses concurrently to start both client and server

## Project Structure

```
dashboardv1/
├── .env
├── fred_data.db                    # SQLite — auto-created on first run
├── package.json                    # Root workspace
├── client/src/
│   ├── App.tsx                     # All route definitions (React Router)
│   ├── Dashboard.tsx               # Landing page
│   ├── pages/                      # All page components
│   ├── components/                 # Shared UI (Panel, NavDropdown, etc.)
│   ├── data/                       # Series config files
│   ├── hooks/                      # useFredData, etc.
│   ├── lib/                        # API clients, math transforms
│   └── styles/globals.css          # CSS variables, theme
└── server/src/
    ├── index.ts                    # Express app, route registration, startup syncs, cron
    ├── db.ts                       # SQLite schema, all CREATE TABLE statements, query helpers
    ├── fetchAllSeries.ts           # Batch FRED fetcher
    ├── routes/                     # Express routers
    │   ├── fred.ts                 # /api/fred
    │   ├── bea.ts                  # /api/bea
    │   ├── news.ts                 # /api/news
    │   ├── treasury.ts             # /api/treasury
    │   ├── sce.ts                  # /api/sce
    │   ├── umich.ts                # /api/umich
    │   ├── fiscal.ts               # /api/fiscal (legacy cumulative flows)
    │   ├── fiscalFlows.ts          # /api/fiscal-flows (DTS flows + tax receipts)
    │   └── census-trade.ts         # /api/census-trade
    ├── dtsFiscalFlows.ts           # DTS fiscal flows sync → dts_fiscal_flows table
    ├── dtsTaxDeposits.ts           # DTS tax deposits sync → dts_tax_deposits table
    ├── fiscalData.ts               # Legacy fiscal data (in-memory cache, being replaced)
    ├── treasuryAuctions.ts         # TreasuryDirect API sync
    ├── investorClassData.ts        # Treasury investor class Excel parse
    ├── sceData.ts                  # NY Fed SCE sync
    ├── umichData.ts                # UMich expectations sync
    └── newsFetcher.ts              # RSS + Claude classification
```

## Key File Locations (Do NOT search for these — use directly)

| What | Path |
|------|------|
| Route definitions (React) | `client/src/App.tsx` |
| DB schema + tables | `server/src/db.ts` |
| Server startup + route registration | `server/src/index.ts` |
| CSS variables / theme | `client/src/styles/globals.css` |
| Nav dropdown | `client/src/components/NavDropdown.tsx` |

## Route Registration Pattern

**Backend (Express):** In `server/src/index.ts`:
```ts
import { myRouter } from './routes/myRoute'
app.use('/api/my-route', myRouter)
```

**Frontend (React Router):** In `client/src/App.tsx`:
```ts
import { MyPage } from './pages/MyPage'
// Inside <Routes>:
<Route path="/models/section/subsection" element={<MyPage />} />
```

## Data Sync Pattern

All external data sources follow this pattern:
1. **Create table** in `server/src/db.ts` using `db.exec(CREATE TABLE IF NOT EXISTS ...)`
2. **Create sync module** in `server/src/` (e.g., `dtsFiscalFlows.ts`) exporting:
   - `syncXxx()` — async function that fetches from API and upserts into SQLite
   - `getXxxData()` — synchronous function that reads from SQLite and returns shaped data
3. **Create route** in `server/src/routes/` that calls the getter
4. **Register route** in `server/src/index.ts` with `app.use()`
5. **Call sync on startup** in `server/src/index.ts` startup function (non-blocking):
   ```ts
   syncXxx().catch(err => console.error('[startup] Xxx sync error:', err))
   ```

### Incremental Sync Pattern (used by DTS):
- Check `MAX(record_date)` in table
- If exists: fetch from 14 days before last record (overlap window)
- If empty: full fetch from data start date
- Delete current FY rows before reinserting (cumulative values depend on full FY)
- Use `INSERT ... ON CONFLICT DO UPDATE` for upserts

## Page Component Pattern

All dashboard pages follow the same structure:
```tsx
import { NavDropdown } from '../components/NavDropdown'
import styles from './MyPage.module.css'

export function MyPage() {
  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.barCenter} />
        <div className={styles.barRight} />
      </header>
      <nav className={styles.breadcrumb}>...</nav>
      <main className={styles.body}>...</main>
    </div>
  )
}
```

CSS Modules use `.module.css` extension. Copy from an existing page's CSS file for the base styles.

## Model Hub Pages (Index → Sub-dashboards)

Parent model pages (e.g., Inflation, Growth, Fiscal) use a card grid layout linking to sub-dashboards:
- **Pattern file:** `client/src/pages/InflationPage.tsx`
- **CSS:** `client/src/pages/InflationPage.module.css`
- Cards have: path, title, description, accent color, tag
- Routes: `/models/{model}` → hub, `/models/{model}/{sub}` → dashboard

Current model hubs:
- `/models/inflation` → CPI, CPI Projections, PCE, PCE Projections, PPI, Other
- `/models/labor` → CPS, Claims, CES, JOLTS, Productivity, Projection
- `/models/growth` → NGDP, RGDP, PIO, Retail, NPCE, RPCE, GDI, Consumer Health, Trade
- `/models/fiscal` → (currently single page, being restructured into DTS + MTS sub-routes)

## Chart Pattern (Recharts)

Multi-FY overlay charts (used in DTS, MTS):
- `LineChart` with `ResponsiveContainer` (520px height)
- Each FY = a `<Line>` component with configured color/width/opacity
- `FY_STYLES` record maps FY strings to `{ color, width, opacity }`
- Current FY: red (#ef4444), thick. COVID FYs: orange/yellow, medium. Others: muted, thin.
- Custom tooltip component
- Clickable legend toggles series visibility via `hiddenFYs` state

## SQLite Tables

| Table | Purpose |
|-------|---------|
| `series_observations` | FRED time series data |
| `series_metadata` | FRED series metadata + fetch timestamps |
| `known_series` | Tracks all series IDs ever requested |
| `negative_cache` | Caches failed FRED lookups |
| `news_articles` | RSS news with Claude-classified topics |
| `news_topics` | Topic definitions |
| `treasury_auctions` | TreasuryDirect auction results |
| `treasury_investor_class` | Treasury investor class allotments |
| `dts_fiscal_flows` | Daily Treasury Statement cumulative flows |
| `dts_tax_deposits` | DTS withheld tax deposits |

## External APIs Used

| API | Base URL | Auth |
|-----|----------|------|
| FRED | `https://api.stlouisfed.org/fred` | FRED_API_KEY |
| BEA NIPA | `https://apps.bea.gov/api/data` | BEA_API_KEY |
| Fiscal Data (DTS/MTS) | `https://api.fiscaldata.treasury.gov/services/api/fiscal_service` | None |
| TreasuryDirect | `https://api.treasurydirect.gov` | None |
| Census | `https://api.census.gov` | None |

## Common Formatting Functions

- `fmtBillions(v)` — `$1.2T`, `$500B`, `$200M`
- `fmtBillionsExact(v)` — `$1,234.5B`
- `fmtDollars(v)` — `$ 123,456` (with locale formatting)
- `fmtGrowth(v)` — `5.3%` or `−4.5%`

## CSS Theme Variables

Key variables defined in `globals.css`:
- `--surface`, `--surface-header` — background colors
- `--border`, `--border-accent` — border colors
- `--text-primary` — main text color
- `--font-mono` — monospace font stack
- Colors: green `#22c55e`, red `#ef4444`, muted `#64748B`, `#4e6070`

## Instructions for Claude

1. **Do NOT search or explore files** unless specifically told to. Use the paths listed above.
2. **When creating new pages**, copy CSS from an existing page's `.module.css` file.
3. **When adding tables**, add the `CREATE TABLE` to `server/src/db.ts`.
4. **When adding routes**, register in `server/src/index.ts`.
5. **When adding frontend routes**, add to `client/src/App.tsx`.
6. **When adding syncs**, add the non-blocking call in the `startup()` function in `server/src/index.ts`.
7. **Always use `better-sqlite3`** — never use async SQLite.
8. **Fiscal Data API pagination** uses `page[number]` and `page[size]` params, with `meta['total-pages']` in response.
