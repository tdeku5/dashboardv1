# Canada Economic Data Models — Mapping Document (Phase 1)

Produced 2026-07-07 per `docs/country-replication-playbook.md`. Every vector marked ✅ was
verified live today against the StatCan WDS (`getSeriesInfoFromVector` /
`getSeriesInfoFromCubePidCoord` — PID, coordinate and exact English title confirmed; latest
datapoints sanity-checked for CPI all-items, CPI-trim, unemployment rate). `UNVERIFIED` =
plausible source named but not confirmed — do NOT ingest without verification.

**Global caveats (apply throughout):**
1. **CPI is monthly NSA** (2002=100). Same consequences as the UK: MoM/annualized panels carry
   seasonality; the CPI projection model must use same-month-prior-year MoM paces with a UI
   caption (UK precedent). An SA all-items exists (✅ v41690914, PID 18100006) for the headline
   overlay; SA component coverage is thinner — treat SA as supplementary.
2. **BoC preferred cores (CPI-trim/median/common) are YoY-%-only series** — no index exists
   (index-form vectors do not exist; the leads v112593657/8 resolve to nothing, PID 0). They
   ingest as `unit='percent'` and plot as published rates; no MoM/annualized/level panels.
3. **Vector renumbering risk**: three tables checked this run were inactive/stale
   (20100008 retail ends 2022-12; 14100325 vacancies ends 2023-07; 34100066/34100285 permits both
   inactive). Current replacements verified below. The Phase 2 collector must health-check
   PID+title per vector at startup and fail loudly.
4. Base years differ per table (CPI 2002=100, IPPI 2015-ish, GDP chained 2017$) — cross-country
   level charts must use YoY or rebased indices.

**Anchor-table corrections** (prompt leads vs live verification): v41690973 ✅ correct
(CPI all-items, 18100004). v41690914 is NOT ex-food-energy — it is **SA all-items CPI**
(18100006) ✅, useful in its own right; the ex-food-energy index is ✅ **v41691233** (18100004).
v111955442 is NOT CPI-trim — it is **NHPI total** (18100205) ✅, used in Housing. v112593657/8
do not exist; the BoC trio is ✅ v108785715 (trim) / v108785714 (median) / v108785713 (common),
PID 18100256. SEPH is PID **14100223** ✅ (employment + AWE, 2001→current).

---

## 1a. US Model Inventory — reused

The panel-level US inventory is `docs/uk-models-mapping.md` §1a and remains current: since the
UK-run commit `6da70d3`, US pages changed only by the panel-identical Retail/MTS
shared-component refits (in that commit) and nav wiring (`fd22d75`). No panels added/changed.

---

## 1b. US → Canada Series Mapping

### Inflation — CPI page

| US element | Class | Canada equivalent | Notes |
|---|---|---|---|
| CPIAUCSL (headline index) | DIRECT | ✅ v41690973 (18100004, All-items, NSA, 2002=100, 1914→) | SA overlay ✅ v41690914 (18100006) |
| CPILFESL (core index) | DIRECT | ✅ v41691233 (All-items ex food and energy, index form) | Index-form core — full explorer/rates panels work |
| BoC preferred cores (no US analog series; maps to core-rates panel) | DIRECT* | ✅ v108785715 CPI-trim, v108785714 CPI-median, v108785713 CPI-common (18100256, **YoY % only**, 1990→) | *Published rates, not indices — rates-panel only (gate decision b) |
| CPIUFDSL (food) | DIRECT | ✅ v41690974 (Food) | |
| CPIENGSL (energy) | DIRECT | ✅ v41691239 (Energy) | |
| Core goods / core services buckets | DIRECT | ✅ v41691222 Goods, v41691230 Services, v41691231 Services ex shelter | Contribution buckets: food/energy/goods-ex/services via basket weights (18-10-0007 weights table — UNVERIFIED vectors; weights are biennial) |
| CPI divisions (8 Canadian major components) | DIRECT | ✅ v41691050 Shelter, v41691067 HH ops/furnishings, v41691108 Clothing, v41691128 Transportation, v41691153 Health & personal care, v41691170 Recreation/education/reading, v41691206 Alcohol/tobacco/cannabis (+Food above) | Canada-specific detail: ✅ v41691056 Mortgage interest cost, v41691051 Rented accommodation, v41691136 Gasoline |
| Durability split | DIRECT | ✅ v41691223 Durables, v41691224 Semi-durables, v41691225 Non-durables | |
| Distribution panel sub-indices | DIRECT | 18100004 has ~300 Canada-level members — enumerate group-level members in Phase 2 via `getCubeMetadata` (pattern proven above) | Individual vectors UNVERIFIED until enumerated |
| ex-food ✅ v41691232, ex-energy ✅ v41691238 | DIRECT | (additional aggregates) | |

### Inflation — CPI Projections
Same-month-prior-year MoM pace model (UK precedent, NSA) on ✅ v41690973 and ✅ v41691233,
with the visible methodology caption. The BoC trio cannot be projected this way (no index) — omit.

### Inflation — PCE pages
**GAP — omit** (UK precedent). Canada's household consumption deflator is quarterly national-accounts
only; no monthly consumption price index exists.

### Inflation — PPI page

| US element | Class | Canada equivalent | Notes |
|---|---|---|---|
| PPIFIS (final demand) | PROXY | ✅ v1230995983 (18100265, IPPI total, monthly, 1956→) | IPPI covers factory-gate industrial products only — no services/final-demand concept. NSA. |
| PPIFES (core) | PROXY | ✅ v1230995984 (IPPI ex energy and petroleum products) | Exclusion basket differs from US core PPI |
| Sub-groups / explorer | DIRECT | 18100265 NAPCS major groups (~25 members, enumerable) | Individual vectors UNVERIFIED until enumerated; RMPI (raw materials, 18-10-0268) UNVERIFIED as an input-cost analog |

### Growth — NGDP / RGDP pages

| US element | Class | Canada equivalent | Notes |
|---|---|---|---|
| GDPC1 (real GDP) | DIRECT | ✅ v62305752 (36100104, chained 2017$, SAAR, 1961→); QoQ-ann % published ✅ v1594571783 | Quarterly |
| GDP (nominal) | DIRECT | ✅ v62305783 (current prices SAAR) | |
| Real components | DIRECT | ✅ v62305724 HH consumption, v62305731 govt consumption, v62305732 GFCF, v62305733 business GFCF, v62305734 residential structures, v62305741 inventories, v62305745 exports, v62305748 imports, v62305725 goods, v62305729 services, v62305726 durables, v62305728 non-durables | |
| Nominal components | DIRECT | ✅ v62305755 HH, v62305762 govt, v62305763 GFCF, v62305776 exports, v62305779 imports | Additive → client contribution math valid for nominal |
| BEA 1.5.2 published contributions | **DIRECT** | ✅ v79448555 HH, v79448562 govt, v79448563 GFCF, v79448572 inventories, v79448573 exports, v79448576 imports (36100104 "Contributions to percent change, annualized") | **Better than the UK** (which needed an Excel scraper) — contributions are first-class series |
| Monthly GDP (UK-style addition) | DIRECT | ✅ v65201210 all-industries (36100434, chained 2017$, monthly, 1997→) + sectors ✅ v65201211 goods, v65201212 services, v65201263 manufacturing, v65201258 construction, v65201236 mining/oil & gas, v65201368 retail | Same page shape as UK MONTHLY GDP tab |

### Growth — PIO page
**Restructure (UK precedent → quarterly Household Income)**: quarterly household disposable
income & saving rate live in 36-10-0112 (current/capital accounts, households) — **UNVERIFIED**,
resolve in Phase 2 before building. Verified today for the adjacent Consumer Health page instead
(below). If 36-10-0112 verification fails, fold income panels into Consumer Health.

### Growth — Retail page

| US element | Class | Canada equivalent | Notes |
|---|---|---|---|
| RSAFS | DIRECT | ✅ v1446859483 (20100056, total retail sales, SA current $, monthly) | **History starts 2017-01** (NAICS 2022 table); predecessor 20100008 is inactive (ends 2022-12) — gate decision: splice or accept short history |
| Store-type components + contribution | DIRECT | 20100056 NAICS retail sub-industries (enumerable) | Vectors UNVERIFIED until enumerated |
| Real retail | UNVERIFIED | Chained-dollar retail table to be located in Phase 2 | |

### Growth — NPCE/RPCE pages
**PROXY (quarterly)**: consumption by durability exists in the quarterly GDP cube — real ✅
v62305726/62305724 etc. (durables/semi ✅ v62305726, v62305727? — semi-durables ✅ resolved as
v62305727 is UNVERIFIED; verified set: durables v62305726, non-durables v62305728, services
v62305729, goods v62305725). One combined quarterly "Consumption" tab (UK precedent); chained
categories are non-additive — no contribution charts (use the published contribution vectors at
GDP level instead).

### Growth — GDI page
**PROXY**: income-based GDP is quarterly table 36-10-0103 — **UNVERIFIED**, resolve in Phase 2
(compensation, gross operating surplus, mixed income, taxes less subsidies). Slim decomposition,
UK GDP(I) shape. Nominal → client contribution math valid.

### Growth — Consumer Health page

| US element | Class | Canada equivalent | Notes |
|---|---|---|---|
| TDSP/MDSP/CDSP debt service | **DIRECT** | ✅ v1001696813 DSR, v1001696814 mortgage DSR, v1001696815 non-mortgage DSR (11100065, quarterly SA, 1990→) | Canada beats the US here — full DSR decomposition exists (UK had nothing) |
| Card balances | DIRECT | ✅ v1231415614 credit cards outstanding (36100639, monthly SA) | |
| HH net worth | DIRECT | ✅ v62698066 net worth % of disposable income (38100235, quarterly); ✅ v62698064 credit-market debt to disposable income | The debt/income ratio is Canada's flagship household-stress metric |
| UMCSENT sentiment | GAP | CCI (Conference Board of Canada) is private | Omit |
| Delinquencies | GAP | CBA/Equifax data private | Omit |
| GASREGW | DIRECT | ✅ v41691136 CPI gasoline (monthly proxy for pump prices); StatCan 18-10-0001 monthly avg retail gasoline prices UNVERIFIED | |

### Growth — Trade page

| US element | Class | Canada equivalent | Notes |
|---|---|---|---|
| BOPGSTB/BOPTEXP/BOPTIMP | DIRECT | ✅ v87008984 balance, v87008955 exports, v87008839 imports (12100011, merchandise, BoP basis, SA, monthly, 1997→) | **Merchandise only** — services trade is quarterly BoP (36-10-0021 UNVERIFIED); goods panels DIRECT, services panels deferred |
| Goods by category | DIRECT | 12-10-0121 (by NAPCS section) UNVERIFIED — enumerate in Phase 2 | |
| By trading partner (no US panel) | ADD | 12100011 dim 5 principal trading partners (US member enumerable) | Canada-specific: US share of trade panel |

### Labor — CPS page → "Canada LFS"

| US series | Class | Canada equivalent | Notes |
|---|---|---|---|
| UNRATE | DIRECT | ✅ v2062815 (14100287, SA, monthly, 1976→) | True monthly survey (no UK rolling-3m caveat) |
| UNEMPLOY / CLF16OV / employment | DIRECT | ✅ v2062814 unemployment, v2062810 labour force, v2062811 employment, v2062812 full-time, v2062813 part-time | |
| EMRATIO / CIVPART | DIRECT | ✅ v2062817 employment rate, v2062816 participation rate | |
| By-age rates | DIRECT | ✅ v2062842 (15–24), v2062950 (25–54), v2062977 (55+) | |
| U1–U6 | GAP | R1–R8 supplementary rates exist (14-10-0077, UNVERIFIED) | Defer |

### Labor — CES page → "Canada Payrolls & Earnings"

| US element | Class | Canada equivalent | Notes |
|---|---|---|---|
| PAYEMS | PROXY ×2 | ✅ v79310776 SEPH payroll employment (14100223, monthly, 2001→) and LFS employment ✅ v2062811 (1976→) | Gate decision d: SEPH is the NFP-concept match (administrative payroll count, excludes self-employed; ~1-month extra lag); LFS employment MoM change is the market-moving monthly print. Recommend BOTH with badges |
| AHE | PROXY | ✅ v79311153 SEPH average weekly earnings incl overtime | Weekly (not hourly) earnings, all employees; LFS hourly wage rate UNVERIFIED |
| Sector employment | DIRECT | 14100223 NAICS members (goods ✅ member 3, construction 21, manufacturing 34 — vectors UNVERIFIED until resolved) | Explorer feasible |
| AWH hours | PROXY | 14100036 actual hours by industry (monthly, **NSA**) UNVERIFIED; the SA table 14100289 holds only the last 5 months — unusable for history | Badge + NSA caveat if built |

### Labor — Claims page → "Canada EI Beneficiaries"

| US series | Class | Canada equivalent | Notes |
|---|---|---|---|
| ICSA/CCSA weekly claims | PROXY | ✅ v64549353 EI regular beneficiaries (14100011, monthly SA, 1997→) | Monthly stock of beneficiaries, not weekly initial-claim flows; ~2-month lag. Badge required |

### Labor — JOLTS page → "Canada Job Vacancies"

| US series | Class | Canada equivalent | Notes |
|---|---|---|---|
| JTSJOL / openings rate | DIRECT | ✅ v1481212145 job vacancies, v1481212147 vacancy rate (14100432, monthly SA, 2015-04→) | Short history (2015→); predecessor table dead (ends 2023-07) — do not use it |
| Hires/quits/layoffs | GAP | No Canadian JOLTS flows | Omit; Beveridge curve feasible (vacancy rate ✅ vs u-rate ✅) |

### Labor — Productivity page

| US series | Class | Canada equivalent | Notes |
|---|---|---|---|
| OPHNFB | DIRECT | ✅ v1409153 business-sector labour productivity (36100206, quarterly SA, 1981→) | Index 2017=100; same OLS pre-COVID trend model |
| ULCNFB | DIRECT | ✅ v1409159 unit labour cost; compensation/hour ✅ v1409158 | |

### Labor — Projection page
DIRECT port: mechanical U-rate scenarios on ✅ v2062815 / v2062811 / v2062810 (same identity as
US/UK). Scenario steps ±10k/25k/50k per month (Canadian scale).

### Housing

| US element | Class | Canada equivalent | Notes |
|---|---|---|---|
| HOUST starts | DIRECT | ✅ v52300157 CMHC housing starts, all areas, SAAR (34100158, monthly, 1990→) | Canada has real SUPPLY data (unlike UK) — SUPPLY tab returns |
| PERMIT | DIRECT | 34100292 (current table, 2018→; totals by structure type; SA current$ member 5.2) — table ✅ verified live, specific total-residential vectors UNVERIFIED until resolved | Two predecessor permit tables are dead — health-check matters |
| Prices | DIRECT/GAP | NHPI ✅ v111955442 total, v111955443 house-only, v111955444 land-only (18100205, monthly, 1981→). Teranet-NB and CREA MLS HPI: **GAP (private)** | Resale-price coverage limited to NHPI + CPI shelter components |
| Rent | DIRECT | ✅ v41691051 CPI rented accommodation | |
| Mortgage rates / credit | DIRECT | ✅ v41691056 CPI mortgage interest cost; ✅ v1231415620 residential mortgage credit outstanding (36100639 SA); BoC Valet conventional mortgage rates UNVERIFIED (rates side already ingests BoC — reuse, don't duplicate) | |
| New home sales / months' supply | GAP | Not published | Omit |

### Credit (H.8 analog) → "Canada Household Credit"

| US element | Class | Canada equivalent | Notes |
|---|---|---|---|
| H.8 loan aggregates | PROXY | ✅ 36100639 monthly SA: v1231415625 total household credit, v1231415620 mortgage, v1231415611 non-mortgage, v1231415614 credit cards (1990→) | Household credit only (no bank-asset-side C&I/CRE view); PNFC companion table 36100640 UNVERIFIED |
| Loans % of GDP | DIRECT | vs ✅ v62305783 nominal GDP (quarterly step-interp, UK method) | |

### Industrial (G.17 analog)

| US element | Class | Canada equivalent | Notes |
|---|---|---|---|
| INDPRO + hierarchy | PROXY | Monthly GDP goods-producing/manufacturing/mining ✅ (v65201211/v65201263/v65201236) + real manufacturing sales ✅ v123263908 (16100013, 2017$, SA, 2002→) | Canada publishes no IP index; monthly GDP by industry is the standard substitute. Explorer over 36100434 NAICS tree (more vectors enumerable) |

### Fiscal — gate decision (a), honest assessment

Investigated both access paths today:
- **Fiscal Monitor (Dept. of Finance)**: monthly, published as HTML pages + per-month
  "data tables and charts" **ZIP resources on open.canada.ca CKAN** (one dataset per year;
  verified via `package_search` — e.g. dataset f5f4327b… for 2026 with monthly ZIPs). This IS
  programmatically reachable, but it is a per-month ZIP-of-unknown-tables scrape — squarely the
  brittle-scraper class the playbook defers. **Recommend: defer the Fiscal Monitor collector.**
- **StatCan GFS quarterly (10100015, 1990→2026Q1)** ✅ verified: federal revenue v52531053,
  expense v52531064, net operating balance v52531074, net lending/borrowing v52531076,
  consolidated net operating balance v52531017. Plus **monthly central government debt**
  (10100002, 2009-04→2026-03) ✅: v86822802 federal debt (accumulated deficit), v86822808
  market debt payable in CAD.
- **Recommendation: RESTRUCTURE** — a Canada Fiscal category built on quarterly GFS
  (revenue/expense/balance, FY Apr–Mar cumulation works: fiscal quarters align) + monthly debt
  stock; Fiscal Monitor monthly granularity deferred as a follow-up collector. Not a GAP.

---

## 1c. Proposed Canada Page Structure

Hubs already have the CANADA country tab (Phase 0 `CountryCategoryNav`); Canada pages slot in as
`country === 'ca'` branches. Accent suggestion: `#f59e0b` (amber, distinct from US red/UK teal).

| Hub | Canada sections | vs US |
|---|---|---|
| **Inflation** | CPI · CPI PROJECTIONS · IPPI · OTHER (BoC cores + SA-vs-NSA + gasoline/MIC) | No PCE (GAP). BoC core trio gets a dedicated published-rates panel (decision b) |
| **Growth** | GDP (quarterly, with **published contribution charts**) · MONTHLY GDP · RETAIL · TRADE · CONSUMPTION (quarterly) · CONSUMER HEALTH | GDI + PIO fold pending 36-10-0103/0112 verification (Phase 2) |
| **Labor** | LFS · EI BENEFICIARIES · PAYROLLS & EARNINGS (SEPH + LFS) · VACANCIES · PRODUCTIVITY · PROJECTION | Mirrors UK 6-tab shape |
| **Housing** | SUPPLY (starts/permits — returns!) · PRICES (NHPI/rent/MIC) · CREDIT (mortgage credit) | No DEMAND tab (no transactions/sales series — inverse of the UK) |
| **Credit** | HOUSEHOLD CREDIT | 36100639 aggregates + % GDP |
| **Industrial** | MONTHLY GDP BY INDUSTRY (explorer) + real manufacturing sales | PROXY badge |
| **Fiscal** | GFS (quarterly, FY Apr–Mar overlays) · DEBT (monthly) | Restructured per decision (a); Fiscal Monitor deferred |

### Ingestion assessment (Phase 2 preview)
- **One genuinely new collector**: generic StatCan WDS collector (`statcanWds.ts` or extend the
  pattern of `collectors/statcanCollector.ts`, which already speaks WDS for 6 vectors on the
  rates side) with an `ALL_STATCAN_SERIES`-style vector config array, incremental
  `getDataFromVectorsAndLatestNPeriods`, full-table-CSV/`getBulkVectorDataByRange` backfill, and
  a `getSeriesInfoFromVector` startup health check (PID+title match, fail loudly). Everything in
  this doc then becomes config entries — no other new collectors needed for the approved scope.
- **Existing `statcanCollector.ts`** (STIR-side CPI/unemployment) stays untouched; decide in
  Phase 2 whether the new generic collector supersedes it later (out of scope now).
- **Frontend**: all shared components apply (SeriesExplorer, RatesChart, ContribSection for
  nominal GDP, FiscalYearOverlay for FY Apr–Mar GFS cumulation, ProxyBadge). Canada's published
  GDP contribution vectors feed ContribSection-style charts directly as pre-computed rows.

### PROXY caveat text (feeds the country-keyed registry)

- `ippi_headline` — US: PPI Final Demand (goods+services+construction). CA: Industrial Product
  Price Index, factory-gate industrial products only (v1230995983). Caveat: no services or
  final-demand concept; NSA.
- `seph_payrolls` — US: Nonfarm Payrolls (establishment survey, monthly change). CA: SEPH payroll
  employment (administrative payroll count, v79310776). Caveat: excludes self-employed; released
  ~1 month after LFS; level series.
- `lfs_payrolls` — US: Nonfarm Payrolls. CA: LFS employment (household survey, v2062811).
  Caveat: household survey ≠ establishment count; includes self-employment.
- `seph_earnings` — US: Average Hourly Earnings (CES). CA: SEPH average weekly earnings incl.
  overtime (v79311153). Caveat: weekly not hourly; composition effects from hours shifts.
- `ei_beneficiaries` — US: weekly initial/continuing UI claims. CA: monthly EI regular-benefit
  beneficiaries (v64549353). Caveat: monthly stock not weekly flow; ~2-month publication lag;
  EI eligibility rules shift the level.
- `monthly_gdp_ip` — US: Industrial Production index (G.17). CA: monthly real GDP of
  goods-producing industries/manufacturing (36100434). Caveat: value-added GDP concept, not
  gross-output IP; chained dollars.
- `household_credit` — US: Fed H.8 bank credit by loan category. CA: household credit liabilities
  (36100639). Caveat: borrower-side household stock, monthly; no bank-asset C&I/CRE view.
- `boc_core_rates` — US: core CPI index (level+derived rates). CA: BoC CPI-trim/median/common
  published as YoY % only. Caveat: no index exists; MoM/annualized/level views impossible.
- `merch_trade` — US: total goods+services trade (BOP). CA: merchandise trade only (12100011);
  services quarterly and deferred.

---

## Summary & gate decisions

**Counts (panel-concept level):** ~44 DIRECT · 9 PROXY · 12 GAP/omit (PCE ×2 pages, U1–U6,
JOLTS flows, sentiment, delinquencies, new home sales/months' supply, Teranet/MLS resale prices,
hires/quits, weekly claims granularity, services-trade monthly, Fiscal Monitor monthly (deferred
not omitted)). **~60 vectors verified live**; UNVERIFIED items are enumerations inside
already-verified cubes (CPI sub-indices, retail/SEPH/permits/IPPI members) plus four tables to
verify in Phase 2 (36-10-0112 household income, 36-10-0103 income-based GDP, 14-10-0077 R-rates,
12-10-0121 trade by product).

**Decisions needing input:**
- **(a) Fiscal**: accept RESTRUCTURE onto quarterly GFS (10100015) + monthly central-government
  debt (10100002), with the Fiscal Monitor ZIP collector explicitly deferred? (Access verified
  but brittle — per-month ZIPs on CKAN.)
- **(b) BoC core trio page design**: recommend a dedicated "BoC Core Measures" rates panel
  (published YoY lines + badge `boc_core_rates`) on the CPI page, alongside index-form core
  (v41691233) which powers the standard explorer/projection panels. Confirm.
- **(c) Housing composition**: SUPPLY (starts/permits) + PRICES (NHPI/rent/MIC) + CREDIT
  (mortgage credit), NO DEMAND tab (no public transactions series; Teranet/CREA private). Confirm
  omit-don't-stub for DEMAND.
- **(d) Payrolls proxy**: recommend BOTH — SEPH (concept match) and LFS employment (timeliness)
  on one "Payrolls & Earnings" tab, each badged. Confirm.
- **(e) Retail history**: current table starts 2017-01; predecessor (different NAICS basis) is
  dead. Recommend accepting 2017→ history (no splicing across classification bases). Confirm.
- **(f) GDI/PIO fold**: if 36-10-0103/0112 verify cleanly in Phase 2, add GDP(I) and Household
  Income tabs (UK shape); otherwise fold surviving panels into Consumer Health. Pre-approve this
  conditional so Phase 2 doesn't need a re-gate?

---

## Phase 2 Addendum (2026-07-07) — Ingestion Complete

**Decision (f) outcome:** both conditional tables verified as first step — 36-10-0103
(GDP income-based: compensation/GOS/gross mixed income/taxes-less-subsidies/GDP, SAAR, 1961→)
and 36-10-0112 (household accounts: compensation/disposable income/saving rate, SAAR, 1961→).
**Both GDP(I) and Household Income tabs BUILD in Phase 3** as mapped; no fallback needed.

### What was built
- **`server/src/fetchAllStatcanSeries.ts`** — generic StatCan WDS collector, ALL_ONS_SERIES
  pattern: `ALL_STATCAN_SERIES` config of **159 verified vectors** (each entry carries expected
  PID + title substring), `verifyStatcanMetadata()` startup health check that THROWS on any
  PID/title mismatch and blocks sync (vector-renumbering defense — StatCan retired four of the
  candidate tables in the recent past), incremental `getDataFromVectorsAndLatestNPeriods`
  (latestN 6, batches of 40, ~2.5 req/s), backfill via `getBulkVectorDataByRange` with a
  1990 release-date floor (repo precedent from `collectors/statcanCollector.ts` — leaner than
  the playbook's full-table CSV for named vectors; noted deviation).
- Writes to the existing `statcan_observations` table (no schema change). The rates-side
  collector keeps its six codes (CPI_HEADLINE/CPI_XFE/CPI_TRIM/CPI_MEDIAN/CPI_COMMON/UNRATE_CA);
  those vectors are not duplicated — Canada pages read both code sets.
- Route `/api/statcan?code=<CODE>` (`server/src/routes/statcan.ts`); startup + 06:00 cron wiring
  in `index.ts` (health check always precedes sync).
- Verification runner `server/src/scripts/verifyCaIngest.ts`.
- Country-keyed ProxyBadge registry: shared `client/src/data/proxyCaveats.ts` type
  ({us, local, caveat, localTag}), UK registry migrated mechanically (19 entries, zero page
  changes), new `client/src/data/caProxyCaveats.ts` (10 entries — the 9 mapped proxies + the
  lfs/seph payrolls pair split per decision d).

### Verification results
- `verifyCaIngest.ts`: **159/159 series populated, 0 missing**; history floors as mapped
  (CPI items 1914→ where published, GDP 1961→, LFS 1976→, NHPI 1981→, credit 1990→,
  vacancies 2015→, retail 2017→ per decision e).
- Spot-checks — ingested values vs fresh independent WDS pulls (StatCan's own published data),
  all exact: CPI all-items 169.6 (May-26), CPI-trim 2.0%, unemployment rate 6.6%,
  CPI food 202.8, housing starts 261.377k SAAR.
- Live server: startup health check "metadata verified for 159 vectors"; `/api/statcan`
  serving (CA_GDP_R: 261 quarterly observations).

### Deferred (do not ingest without verification)
- **Fiscal Monitor monthly collector** (decision a): access path verified and recorded —
  open.canada.ca CKAN `package_search?q="fiscal monitor"` → one dataset per year (e.g. 2026:
  `f5f4327b-2a09-484a-a518-64ca26405386`) → per-month "data tables and charts" ZIP resources;
  inner table format unexamined. Follow-up collector.
- Retail sub-industry vectors (contribution panel), trade by product section (12-10-0121),
  quarterly services trade (36-10-0021), LFS supplementary unemployment rates R1–R8
  (14-10-0077), LFS hourly wages, hours worked (SA table 14-10-0289 holds only 5 months —
  NSA 14-10-0036 is the only full-history option), pump-price gasoline (18-10-0001),
  PNFC credit (36-10-0640), monthly GDP deeper NAICS detail, IPPI product groups beyond
  total/core.

### Operational note
The long-running `tsx watch` dev server had a stalled file-watcher (WSL inotify) and did not
pick up new code; its worker was replaced with a fresh `tsx watch` process during verification.
If charts ever lag code changes, restart `npm run dev`.
