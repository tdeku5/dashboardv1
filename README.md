# TND Research Terminal

A locally-run macroeconomic research terminal for economic and financial data analysis. The application provides interactive dashboards, data models, and charting tools that pull live data from multiple public data sources. Built with a React/TypeScript frontend and a Node/Express backend with SQLite for local data caching.

---

## Data Sources

### FRED (Federal Reserve Economic Data)

The primary source for most economic indicators (CPI, PPI, PCE, GDP, labor market, etc.). The server fetches series on demand via the FRED API using an API key, caches results in SQLite, and serves them to the frontend. Over 230 individual series are used across the dashboards, covering inflation components, employment statistics, claims, JOLTS flows, productivity measures, and more. Series are refreshed daily at 06:00 UTC or on server startup when stale (older than 20 hours).

### TreasuryDirect API

US Treasury auction results including bid-to-cover ratios, offering amounts, high yields, and allocation percentages. The server performs incremental syncs on startup, storing auction records in a local SQLite table with upsert logic. Covers Notes, Bonds, TIPS, and FRNs from 2000 to present. No API key required.

### Treasury Investor Class Data

Investor class auction allotment data from Treasury.gov, showing the breakdown of who buys Treasuries at auction (Dealers & Brokers, Foreign & International, Investment Funds, Depository Institutions, Pension & Retirement, Federal Reserve, Individuals, Other). Downloaded as Excel files from Treasury.gov, parsed with SheetJS, and stored in SQLite.

### BEA (Bureau of Economic Analysis)

PCE price index data sourced from BEA Table 2.3.4U (Price Indexes for Personal Consumption Expenditures by Major Type of Product). Used by the PCE Dashboard for detailed PCE component analysis. Requires a BEA API key.

### NY Fed Survey of Consumer Expectations (SCE)

Inflation expectations data (1-year, 3-year, and 5-year ahead medians). Downloaded as an Excel file from a stable NY Fed URL, parsed with SheetJS, and stored in SQLite. Synced on server startup. Updated monthly by the NY Fed.

### University of Michigan Surveys of Consumers

5-year ahead inflation expectations (PX5 median). Downloaded as a CSV from the UMich website, parsed, and stored in SQLite. Synced on server startup. The 1-year ahead expectations are also available via FRED as the `MICH` series.

### News Feeds (Bloomberg & Reuters)

RSS feeds from Bloomberg and Reuters (via Google News RSS proxy). Articles are fetched twice daily by the server and classified into topics using Claude Haiku via the Anthropic API.

---

## Application Sections

### US Economic Dashboard (`/`)

The landing page. A macro environment summary organized into 5 panels: Growth, Inflation, Labor Market, Consumer, and Industry. Each panel displays key economic indicators with their latest value, YoY % change, annualized 6-month and 3-month % changes, and MoM % change.

| Panel | Indicators |
|-------|-----------|
| Growth | Nominal GDP (`GDP`), Real GDP (`GDPC1`) — quarterly, annualized QoQ |
| Inflation | Core PCE (`PCEPILFE`), Core CPI (`CPILFESL`), Avg Hourly Earnings (`CES0500000003`) |
| Labor Market | Nonfarm Payrolls (`PAYEMS`), Unemployment Rate (`UNRATE`), Initial Claims (`ICSA`), Job Openings (`JTSJOL`), Quits Rate (`JTSQUL`) |
| Consumer | Real Personal Income (`RPI`), Real PCE (`DPCERA3M086SBEA`), Retail Sales (`RSXFS`) |
| Industry | Industrial Production (`INDPRO`), Durable Goods Orders (`DGORDER`) |

### Models > Inflation

#### CPI Dashboard (`/models/inflation/cpi`)

- **Contribution-to-YoY and Contribution-to-MoM composition charts**: Stacked bar charts decomposing headline CPI into Food, Energy, Core Goods, and Core Services with weighted contributions, plus headline and core CPI line overlays.
- **CPI Series Explorer**: Dropdown-based explorer allowing selection of any series in the full CPI hierarchy (104 series mapped from BLS item codes to FRED series IDs). For each selected series, displays outright index level, YoY % change with regime shading, YoY delta, MoM % change with moving averages, annualized MoM, and seasonal sequential comparison charts. All charts share a synchronized brush/range selector.

#### CPI Projections (`/models/inflation/projections`)

Forward projection of headline and core CPI YoY% under constant MoM growth scenarios with interactive heatmap tables.

#### PCE Dashboard (`/models/inflation/pce`)

PCE price index explorer sourced from BEA Table 2.3.4U with 23 line items. Same chart types as the CPI explorer: outright index, YoY regimes, YoY delta, MoM with moving averages, annualized MoM, and seasonal sequential comparison.

#### PCE Projections (`/models/inflation/pce-projections`)

Forward projection of headline and core PCE YoY% under constant MoM growth scenarios with interactive charts and summary analysis.

#### PPI Dashboard (`/models/inflation/ppi`)

- **Top-level PPI composition charts**: Contribution to YoY and MoM PPI, decomposing headline PPI Final Demand into 5 weighted components — Services (67.52%), Goods ex Food & Energy (18.85%), Foods (5.74%), Energy (5.27%), and Construction (2.62%). Stacked bars with PPI and Core PPI line overlays. Charts displayed side-by-side (YoY left, MoM right).
- **5 sub-category composition chart pairs**, each decomposing a top-level component into its demand-stage sub-components:
  - **Services**: Trade Services (28.6%), Transportation & Warehousing (7.3%), Services less Trade/T&W (64.1%)
  - **Goods less Food & Energy**: Finished Goods (57.5%), Gov't Purchased Goods (10.4%), Goods for Export (32.1%)
  - **Foods**: Finished Consumer Foods (76.5%), Gov't Purchased Foods (7.3%), Foods for Export (16.3%)
  - **Energy**: Finished Consumer Energy Goods (77.8%), Gov't Purchased Energy (15.1%), Energy for Export (7.1%)
  - **Construction**: For Private Capital Investment (69.5%), For Gov't (30.5%)
- **PPI and Core PPI trend charts**: Side-by-side line charts showing YoY % change (solid), 6-month annualized change (dashed), and 3-month annualized change (dashed) for headline PPI (`PPIFIS`) and Core PPI (`PPIFES`).
- **PPI Series Explorer**: Dropdown-based explorer covering the PPI Final Demand hierarchy with the same chart types as CPI/PCE.

#### Other Inflation Measures (`/models/inflation/other`)

- **Inflation Expectations chart**: Multi-line chart showing 5 series:
  - UMich 1-year expectations (FRED `MICH`, back to ~1978)
  - UMich 5-year expectations (from UMich website CSV, back to Feb 1979)
  - NY Fed SCE 1-year, 3-year, and 5-year expectations (from NY Fed Excel download, starts June 2013; 5-year starts Jan 2022)
  - Clickable legend to toggle each series, brush with 6M/1Y/3Y/5Y/All quick-select.
- **Inflation Metrics chart**: Multi-line chart showing YoY % change for 7 inflation measures:
  - Trimmed Mean PCE (`PCETRIM12M159SFRBDAL`) — plotted directly (already in % form)
  - Sticky Price Core CPI (`CORESTICKM159SFRBATL`) — plotted directly (already in % form)
  - Harmonized CPI (`CP0000USM086NEST`) — YoY computed from index
  - CPI (`CPIAUCSL`), Core CPI (`CPILFESL`), PCEPI (`PCEPI`), Core PCEPI (`PCEPILFE`) — YoY computed from index

### Models > Labor Market

#### U-3 Payroll-Based Projection (`/models/labor/projection`)

Projects the forward U-3 unemployment rate 12 months out based on user-configurable inputs: assumed civilian labor force (CLF) MoM growth rate and 4 monthly payroll growth scenarios (default: 50k, 100k, 150k, 200k — user-adjustable). Outputs a line chart with historical U-3 and 4 forward projection lines, plus a color-coded heatmap table.

#### CPS Dashboard (`/models/labor/cps`)

Current Population Survey (Household Survey) data:

- **U-3 with Moving Averages**: 3-month and 6-month MA overlays, toggleable legend
- **Unemployment Rate Decomposition**: Stacked bars breaking down unemployment by reason (Permanent Layoffs, Reentrants, New Entrants, Job Leavers, Completed Temporary Jobs, Temporary Layoffs) as a share of the labor force
- **U-1 through U-6 Rates**: All six BLS alternative unemployment measures
- **U-3 by Age Group**: 16-24, 25-54, and 55-64 breakdowns
- **Employment-Population Ratios**: Overall and 25-54 prime-age
- **Labor Force Participation Rates**: Overall and 25-54 prime-age
- **Civilian Labor Force Level**: Line chart with MoM % change bars and user-controlled MA
- **Unemployment vs CLF**: Dual Y-axis comparison

#### Claims Dashboard (`/models/labor/claims`)

- **Initial Claims**: NSA (`ICNSA`) and SA (`ICSA`) time series with YoY comparison
- **Continuing Claims**: NSA (`CCNSA`) and SA (`CCSA`) time series
- **Seasonal Heatmaps**: Week-of-year by year heatmaps for Initial and Continuing Claims (NSA), color-coded with percentile-based scaling

#### CES Dashboard (`/models/labor/ces`)

Current Employment Statistics (Establishment Survey):

- **Payrolls Decomposition**: Diverging stacked bar chart showing MoM change in employment by sector (22 sectors), built with D3. Services, Goods, and Government sub-decompositions.
- **Sector Explorer**: Dropdown with BLS hierarchy (Total Nonfarm > Goods-Producing/Service-Providing > individual sectors). For each sector: Payroll Level, MoM Change (thousands), MoM % Change, and YoY % Change — all synchronized with a shared brush.
- **Wages Explorer**: Average Hourly Earnings (AHE) by sector (17 CES series), plus Average Weekly Hours (AWH).
- **Hours Explorer**: Average Weekly Hours by sector.
- **Aggregate Payrolls Explorer**: Aggregate weekly payrolls by sector.

#### JOLTS Dashboard (`/models/labor/jolts`)

- **Rate Charts**: Job Openings, Hiring, Quits, and Layoffs rates (calculated from levels / PAYEMS) with moving averages and X-month change bar charts. User-controlled period inputs.
- **Recent 1-Month Changes**: Grouped bar chart of the 4 most recent months across all 6 JOLTS flows
- **JOLTS Implied NFP Growth**: Hires minus Total Separations overlaid with actual NFP MoM change
- **Beveridge Curve**: Vacancy Rate vs Unemployment Rate scatter plot, colored by year

#### Productivity (`/models/labor/productivity`)

- **Productivity Level and ULC Level**: With OLS trend lines fitted to Q1 2000 – Q4 2019, extended to present
- **Quarter-over-Quarter Annualized % Change**: `((current/prev)^4 - 1) * 100`
- **Year-over-Year % Change**: For both Output per Hour (`OPHNFB`) and Unit Labor Costs (`ULCNFB`)

### News Aggregator (`/news`)

A live news monitoring tool:

- **Data pipeline**: RSS fetch from Bloomberg and Reuters (via Google News RSS proxy), twice daily plus manual refresh. Articles stored in SQLite with deduplication.
- **Claude-powered topic tagging**: Each article classified by Claude Haiku into topics: AI, Federal Reserve, Geopolitics, Tariffs, Markets, Regulation, Energy, Labor, China, Emerging Markets.
- **UI**: Split-view layout (Bloomberg left, Reuters right), source/topic/text filters, topic pills per card. Dark terminal theme.

### Treasury Auction Monitor (`/treasury`)

- **Bid-to-Cover Ratio chart**: Time series with dropdown filter by security term (2y, 3y, 5y, 7y, 10y, 20y, 30y, TIPS, FRNs)
- **Offering Amount chart**: Bar chart of par amounts offered per auction
- **Investor Class Allocation chart**: Line chart showing allocation percentages by investor type (Dealers, Foreign, Investment Funds, etc.) with raw series (dotted) and 4-auction moving average (solid) lines

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, TypeScript, Vite, Recharts, D3 (select charts), React Router, CSS Modules |
| Backend | Node.js, Express, TypeScript |
| Database | SQLite via better-sqlite3 (local caching for all data sources) |
| Data parsing | SheetJS/xlsx (Excel), manual CSV parsing |
| AI | Anthropic Claude Haiku (news topic classification) |
| Scheduling | node-cron (daily FRED refresh, twice-daily news fetch) |

---

## Project Structure

```
dashboardv1/
├── .env                            # API keys (FRED_API_KEY, BEA_API_KEY, ANTHROPIC_API_KEY)
├── fred_data.db                    # SQLite database — auto-created on first run
├── package.json                    # Root workspace — runs both services via concurrently
│
├── client/                         # Vite + React + TypeScript frontend
│   └── src/
│       ├── App.tsx                 # React Router setup
│       ├── Dashboard.tsx           # Landing page (5-panel macro summary)
│       ├── pages/                  # Page components (17 pages)
│       │   ├── CPIDashboardPage.tsx
│       │   ├── CPIProjectionsPage.tsx
│       │   ├── PCEDashboardPage.tsx
│       │   ├── PCEProjectionsPage.tsx
│       │   ├── PPIDashboardPage.tsx
│       │   ├── OtherInflationPage.tsx
│       │   ├── CPSDashboardPage.tsx
│       │   ├── ClaimsDashboardPage.tsx
│       │   ├── CESDashboardPage.tsx
│       │   ├── JOLTSDashboardPage.tsx
│       │   ├── ProductivityPage.tsx
│       │   ├── LaborModelsPage.tsx
│       │   ├── NewsAggregatorPage.tsx
│       │   ├── TreasuryAuctionPage.tsx
│       │   └── ...                 # Hub/landing pages
│       ├── data/                   # Series config files
│       │   ├── seriesConfig.ts     # Main dashboard series definitions
│       │   ├── cpiSeriesConfig.ts  # Full CPI hierarchy (104 series)
│       │   ├── pceSeriesConfig.ts  # PCE series definitions
│       │   └── ppiSeriesConfig.ts  # PPI Final Demand hierarchy
│       ├── components/             # Shared UI components
│       │   ├── Panel.tsx           # Panel card with header/footer
│       │   ├── LiveRow.tsx         # 3-state row (loading/error/ready)
│       │   ├── IndicatorRow.tsx    # Single indicator display
│       │   └── NavDropdown.tsx     # Terminal navigation dropdown
│       ├── hooks/
│       │   └── useFredData.ts      # Fetches series, runs compute() functions
│       └── lib/
│           ├── fred.ts             # FRED API client (fetchFredSeries, etc.)
│           ├── bea.ts              # BEA API client
│           ├── treasury.ts         # Treasury data client
│           ├── news.ts             # News API client
│           └── transforms.ts       # Math helpers (yoyPct, annualisedGrowth, etc.)
│
└── server/                         # Node + Express backend
    └── src/
        ├── index.ts                # Server startup, route registration, cron jobs
        ├── db.ts                   # SQLite schema, connection, query helpers
        ├── fetchAllSeries.ts       # Batch FRED series fetcher (230+ series)
        ├── treasuryAuctions.ts     # TreasuryDirect API sync
        ├── investorClassData.ts    # Treasury investor class Excel download/parse
        ├── sceData.ts              # NY Fed SCE Excel download/parse
        ├── umichData.ts            # UMich CSV download/parse
        ├── newsFetcher.ts          # RSS fetch + Claude topic classification
        └── routes/
            ├── fred.ts             # /api/fred endpoints
            ├── bea.ts              # /api/bea endpoints
            ├── treasury.ts         # /api/treasury endpoints
            ├── sce.ts              # /api/sce endpoints
            ├── umich.ts            # /api/umich endpoints
            └── news.ts             # /api/news endpoints
```

---

## Setup & Running

### Prerequisites

- Node.js 18+ and npm 8+
- A free [FRED API key](https://fred.stlouisfed.org/docs/api/api_key.html)

### Installation

```bash
# Clone and install
npm install

# Create .env at the project root
echo "FRED_API_KEY=your_32_character_key_here" > .env

# Optional: add BEA and Anthropic keys for PCE dashboard and news classification
echo "BEA_API_KEY=your_bea_key_here" >> .env
echo "ANTHROPIC_API_KEY=your_anthropic_key_here" >> .env

# Start the development server (frontend + backend)
npm run dev
```

On the first run the server will fetch all 230+ FRED series and populate `fred_data.db`. This takes 1-2 minutes. Subsequent startups only refresh stale series.

| Service | URL |
|---------|-----|
| Dashboard (Vite) | http://localhost:5173 |
| API server (Express) | http://localhost:3001 |

### Manual data fetch

```bash
npm run fetch          # Runs fetchAllSeries.ts standalone (forces full re-fetch)
```

---

## Network Requirements

The server makes outbound requests to these domains:

| Domain | Purpose |
|--------|---------|
| `api.stlouisfed.org` | FRED API (economic time series) |
| `www.treasurydirect.gov` | Treasury auction data |
| `home.treasury.gov` | Investor class allocation Excel files |
| `apps.bea.gov` | BEA API (PCE data) |
| `www.newyorkfed.org` | NY Fed SCE Excel download |
| `www.sca.isr.umich.edu` | UMich expectations CSV download |
| `feeds.bloomberg.com` | Bloomberg RSS |
| `news.google.com` | Reuters via Google News RSS proxy |
| `api.anthropic.com` | Claude API (news classification) |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/fred?series_id=PAYEMS` | Serve FRED observations from SQLite |
| `GET` | `/api/fred/status` | Database status (last updated, series count) |
| `POST` | `/api/fred/refresh` | Force full re-fetch of all series |
| `GET` | `/api/treasury/auctions?term=10-Year` | Treasury auction data |
| `GET` | `/api/treasury/investor-class?securityType=Note` | Investor class allocations |
| `GET` | `/api/bea?TableName=T20304&Frequency=M` | BEA data |
| `GET` | `/api/sce/inflation-expectations` | NY Fed SCE inflation expectations |
| `GET` | `/api/umich/inflation-expectations` | UMich 5-year inflation expectations |
| `GET` | `/api/news/articles` | News articles with topic tags |
| `GET` | `/api/health` | Server health check |
