# UK Economic Data Models — Mapping Document (Phase 1)

Audit of the US Economic Data Models and mapping of every element to a UK equivalent.
Produced 2026-07-07. All ONS CDIDs marked ✅ were verified live against the ONS beta search API
(title + dataset + URI confirmed); all BoE codes marked ✅ were verified live against the IADB CSV
endpoint (data + title confirmed). `UNVERIFIED` = plausible source identified but code not confirmed —
do NOT ingest without verification.

**Transformation glossary** (used throughout; all computed client-side in the US pages):
- `YoY` = v/v₋₁₂−1 (monthly) or v/v₋₄−1 (quarterly) · `MoM`/`QoQ` = v/v₋₁−1
- `annN` = N-period annualized: (v/v₋ₙ)^(12/N)−1 · `MA(n)` = trailing mean
- `YoYΔ` = YoY(t)−YoY(t−n) · `regime` = YoY vs its MA → shading
- `contrib` = (compₜ₋ₗ/parentₜ₋ₗ)·(compₜ/compₜ₋ₗ−1)·100 (weighted contribution, lag 12 or 1)
- `ExplorerE1–E5` = the standard 5-chart explorer block: Level / YoY+regime / YoYΔ+MA / MoM+2MA / annualized-MoM
  (quarterly pages use QoQ variants)

---

## 1a. US Model Inventory

### Hub: /models/inflation

#### CPI (`CPIDashboardPage.tsx`) — FRED via `/api/fred`
| Panel | Series | Transform | Component |
|---|---|---|---|
| Contribution to YoY CPI | CPIAUCSL + CPIUFDSL, CPIENGSL, CUSR0000SACL1E, CUSR0000SASLE (CPILFESL fetched) | contrib (fixed Dec-24 weights: food 13.531, energy 6.921, core goods 21.361, core services 58.187); All-Items YoY overlay | `ContribYoyChart` (custom SVG) + Brush |
| Contribution to MoM CPI | same | contrib lag 1 | Recharts ComposedChart |
| Distribution v1/v2 | 72 CPI sub-indices (`DIST_SERIES_IDS`) | per-series YoY bucketed (wide/narrow), 100% stacked | stacked Area |
| Core / Headline rates | CPILFESL / CPIAUCSL | YoY, ann3, ann6 | ComposedChart ×3 lines |
| Explorer | 100+ series (`cpiSeriesConfig.ts` CPI_ITEMS) | ExplorerE1–E5 + MoM sequential-by-year | ComposedChart set |

#### CPI Projections (`CPIProjectionsPage.tsx`)
| Panel | Series | Transform | Component |
|---|---|---|---|
| Headline / Core projection | CPIAUCSL, CPILFESL | carry-forward model: project index 6m ahead at 1m/3m/6m MoM paces → implied YoY path; 2% reference | `ProjectionSection`, `SummaryBoxes` |

#### PCE (`PCEDashboardPage.tsx`) — BEA NIPA table 2.3.4U via `/api/bea` (line numbers)
| Panel | Series | Transform | Component |
|---|---|---|---|
| Contribution YoY/MoM | lines 1,3,8,13,22,25 | contrib (fixed weights: services .6686, durables .1170, nondurables .2144, NPISH .0296) | `ContribChart` |
| Distribution v1/v2 | 16 sub-lines | per-series YoY bucketed | stacked Area |
| Core / Headline rates | lines 25 / 1 | YoY, ann3, ann6 | ComposedChart |
| Explorer | lines 1–22, 25 (`pceSeriesConfig.ts`) | ExplorerE1–E5 + sequential | ComposedChart set |

#### PCE Projections (`PCEProjectionsPage.tsx`) — same model as CPI projections on BEA lines 1/25.

#### PPI (`PPIDashboardPage.tsx`) — FRED
| Panel | Series | Transform | Component |
|---|---|---|---|
| Contribution YoY/MoM | PPIFIS + PPIDSS, WPSFD413, PPIDES, PPIDFS, PPIDCS (+PPIFES overlay) | contrib (fixed weights) | `PpiContribYoyChart` |
| Sub-category pairs ×5 | services/goods-ex-FE/foods/energy/construction parents + 2–3 components each (WPSFD4xxx) | within-category contrib YoY + MoM | `SubCatChart` |
| PPI / Core PPI trend | PPIFIS, PPIFES | YoY, ann6, ann3 | `PpiTrendChart` |
| Explorer | 18 series (`ppiSeriesConfig.ts`) | ExplorerE1–E5 + sequential | ComposedChart set |

#### Other Inflation (`OtherInflationPage.tsx`)
| Panel | Series | Transform | Component |
|---|---|---|---|
| Inflation Expectations | MICH (FRED), UMich 5y (`/api/umich`), NY Fed SCE 1/3/5y (`/api/sce`) | raw % | `ExpectationsChart` |
| Inflation Metrics | PCETRIM12M159SFRBDAL, CORESTICKM159SFRBATL (raw); CP0000USM086NEST, CPIAUCSL, CPILFESL, PCEPI, PCEPILFE (YoY) | raw / YoY | `InflationMetricsChart` |

### Hub: /models/growth

#### NGDP (`NGDPDashboardPage.tsx`) — 49 FRED series, NIPA 1.1.5 hierarchy, quarterly
- ExplorerE1–E5 (QoQ variants) on any of the 49 (GDP, PCEC, GPDI, FPI, PNFI, PRFI, CBI, NETEXP, EXPGS, IMPGS, GCE, FGCE, SLCE + detail lines).
- 10 `ContribPair` charts (QoQ+YoY twin): GDP→(PCEC,GPDI,NETEXP,GCE); PCE→(services,goods); goods→(durable,nondurable); durable→4; nondurable→4; HH services→7; FPI→(PNFI,PRFI); PNFI→(structures,equipment,IP); equipment→4; IP→3. All contrib computed client-side share-of-parent. Component: `DecompChart` (custom SVG).

#### RGDP (`RGDPDashboardPage.tsx`) — 49 FRED chained-$ series + BEA Table 1.5.2 via `/api/bea/gdp-contrib`
- ExplorerE1–E5 on 49 real series (GDPC1 etc.).
- 12 `GdpContribChart` charts using **BEA-published contributions** (lines 1–60 subset) — NOT client-computed (chained indices not additive).

#### PIO (`PIODashboardPage.tsx`) — ~43 FRED monthly series (NIPA 2.1 personal income & outlays)
- ExplorerE1–E5 (PI, DSPI, PCE, PMSAVE, PSAVERT, RPI, W875RX1 + detail); 3 client-derived series (net interest, transfers-ex-contrib, PI-ex-transfers).
- 4 rate charts (PI, PI-ex-transfers, Real PI, Real PI-ex-transfers): YoY+ann6+ann3.
- 7 contribution groups × (YoY+MoM): PI→5 components; compensation→2; wages→2; private wages→2; asset income→2; govt benefits→6; outlays→3. Component: `PioContribChart`.

#### Retail (`RetailSalesDashboardPage.tsx`) — 17 FRED series (Census MARTS)
- Contribution YoY/MoM: RSAFS parent + 13 store-type components (`RetailContribChart`).
- Growth rates: RSAFS, RSFSXMV — YoY, ann6, ann3.
- ExplorerE1–E5 on 17 series.

#### NPCE (`NPCEDashboardPage.tsx`) — BEA `/api/bea/npce`, 31 lines (`nPCESeriesConfig.ts`)
- 6 contribution groups × (YoY+MoM) (`NPCEContribChart`); goods-vs-services ratio/level/YoY/MoM; ExplorerE1–E5.

#### RPCE (`RPCEDashboardPage.tsx`) — BEA `/api/bea/rpce`, 31 lines (quantity indexes)
- ExplorerE1–E5; goods-vs-services ratio/level/YoY/MoM. **No contribution charts** (chained quantity indexes non-additive).

#### GDI (`GDIDashboardPage.tsx`) — 24 FRED series (NIPA 1.10), quarterly
- ExplorerE1–E5; 5 contribution groups × (QoQ+YoY): GDI→(compensation, taxes, subsidies−, NOS, CFC); NOS→5; corp profits→2; profits-after-tax→2; CFC→2. Component: `GDIContribChart`.

#### Consumer Health (`ConsumerHealthDashboardPage.tsx`) — 14 FRED series
| Panel | Series | Transform |
|---|---|---|
| Sentiment | UMCSENT | level |
| Delinquency rates | DRCLACBS, DRBLACBS, DRSFRMACBS, DRCRELEXFACBS | level |
| Card delinquencies | DRCCLACBS, DRCCLT100S, DRCCLOBS | level |
| Debt service | TDSP, MDSP, CDSP | level |
| Card balances / HH net worth | RCCCBBALTOT / BOGZ1FL192090005Q | level + YoY(4) + QoQ |
| Gasoline | GASREGW | level |

#### Trade (`TradeDashboardPage.tsx`) — 23 FRED BOP series + 14 Census end-use keys via `/api/census-trade`
- Total/goods/services balances (exp vs −imp vs balance), 3m trailing sums.
- Goods by end-use category (Census): balance/exports/imports by 6 categories.
- Services by category (FRED ITX*/ITM* ×9): balance (`SvcContribChart`), exports, imports.

### Hub: /models/labor

#### CPS (`CPSDashboardPage.tsx`) — FRED
U-3 + MAs; unemployment decomposition by reason (6 LNS13* as % of CLF16OV, stacked); U1–U6; U-3 by age; EMRATIO/participation (headline + prime-age); CLF level + MoM; unemployed vs CLF.

#### Claims (`ClaimsDashboardPage.tsx`) — FRED
ICNSA/ICSA/CCNSA/CCSA level+4wkMA; seasonal by-year overlays; YoY of 4wk MA; week×year percentile heatmaps.

#### CES (`CESDashboardPage.tsx`) — ~70 FRED series
Payrolls decomposition (PAYEMS vs 14 sectors / 3 categories, N-mo diff, `DecompChart`); services/goods/govt sub-decompositions; recent 4-month growth bars; **diffusion index** (% sectors up YoY); sector explorer (level/3Y drawdown/1moΔ/YoY); goods-vs-services employment; AHE explorer ×17 sectors (level/YoY/MoM); AWH explorer ×17; aggregate payrolls (emp×AHE×AWH×4.33) explorer + goods-vs-services.

#### JOLTS (`JOLTSDashboardPage.tsx`) — FRED
Openings/hires/quits/layoffs rates (vs PAYEMS denominator) + MA + change bars; recent 1-mo change; implied NFP (hires−separations vs PAYEMS Δ); Beveridge curve (openings rate vs UNRATE, by year).

#### Productivity (`ProductivityPage.tsx`) — FRED
OPHNFB level + pre-COVID OLS trend; QoQ-ann; YoY. ULCNFB level/QoQ-ann/YoY.

#### Labor Projection (`LaborModelsPage.tsx`) — FRED
U-3 12-mo scenario projection from UNRATE/CE16OV/CLF16OV under 4 payroll-growth scenarios + CLF growth input; heatmap table.

### Hub: /models/housing (`HousingPage.tsx`) — 37 FRED series, 4 sections
- **SUPPLY**: starts/permits/completions/under-construction (total + 1-unit/2-4/5+, stacked level + N-mo Δ); permits−starts & completions−starts spreads; months' supply (MSACSR, HOSSUPUSM673N); res. construction payrolls (CES2023610001); res. construction spending (TLRESCONS); residential investment (PRFI nominal, A011RE1Q156NBEA real share).
- **DEMAND**: new home sales (HSN1F level/YoY/MoM); price-vs-income (MSPNHSUS vs RPI); price-vs-rent (MSPNHSUS vs CUSR0000SEHC).
- **PRICES**: MSPNHSUS, CSUSHPISA, CUSR0000SEHC — level/YoY/MoM.
- **CREDIT**: MORTGAGE30US vs DGS10 vs DFF; mortgage spread; bank RRE loans (RREACBW027SBOG + HELOC/closed-end) level/YoY/MoM.

### Hub: /models/credit (`CreditPage.tsx` → `BankCreditDashboardPage.tsx`) — Fed H.8 via FRED
Loans % of NGDP (TOTLL/GDP); credit creation (N-wk Δ TOTBKCR / GDP); loans by category % NGDP (C&I, RRE, CRE, consumer, other); N-wk change stacked; H.8 explorer (41 rows × 3 bank cohorts ≈ 123 series): level / 52-wk YoY / N-wk %.

### Hub: /models/industrial (`IndustrialProductionPage.tsx` → `IPExplorerDashboardPage.tsx`) — Fed G.17 via FRED
Contributions to IP YoY/MoM (INDPRO + 7 market groups × published weight series); IP explorer (33 series+weight pairs): level / YoY+regime / acceleration / MoM+2MA / ann-MoM.

### Hub: /models/fiscal (`FiscalPage.tsx`)
- **DTS** (`FiscalFlowsPage.tsx`, `/api/fiscal-flows`): cumulative daily net fiscal flows (ΔTGA−Δdebt) multi-FY overlay + 7d MA; YTD-vs-LY stats; withheld employment tax deposits — 12 rolling business-day periods, current vs prior cycle tables with growth-vs-LY.
- **MTS** (`MtsPage.tsx`, `/api/mts/cumulative-balance` + FRED GDP): cumulative monthly surplus/deficit multi-FY overlay; FYTD bars $B and % of GDP.

---

## 1b. US → UK Series Mapping

Classification: **DIRECT** (UK equivalent exists), **PROXY** (defensible substitute, caveat noted), **GAP** (no reasonable equivalent — recommendation given). ✅ = code verified live today. Datasets: MM23 = consumer price inflation; MM22/PPI = producer prices; LMS/UNEM/EMP = labour market; QNA/PN2/UKEA = quarterly national accounts; MGDP = monthly GDP; DRSI = retail sales; DIOP = index of production; IOS1 = index of services; MRET/PNBP = trade/BoP; PUSF = public sector finances; CT = consumer trends.

**Global frequency/methodology caveats (apply throughout):**
1. UK CPI/PPI are **NSA-only** — MoM, annualized-N-month, and MoM-carry-forward projections will show seasonal noise the US SA versions don't. YoY panels unaffected. Recommend YoY-first layouts and 12-month-lag transforms for UK inflation pages.
2. UK LFS data are **rolling 3-month averages** published monthly (e.g. "Mar–May") — MoM math operates on overlapping windows.
3. ONS quarterly CVM (chained volume) series are **non-additive** → real contribution charts must use ONS-published contributions, never client-computed shares (same rule as existing `ons_gdp_contributions`).

### Inflation — CPI page

| US series | Class | UK equivalent | Notes |
|---|---|---|---|
| CPIAUCSL (headline index) | DIRECT | ✅ `D7BT` MM23, monthly NSA | YoY twin ✅ `D7G7` |
| CPILFESL (core index) | DIRECT | ✅ `DKC6` MM23 (ex energy, food, alcohol, tobacco) | YoY twin ✅ `DKO8`; UK core definition differs slightly (also ex alcohol/tobacco) |
| CPIUFDSL (food) | DIRECT | ✅ `D7BU` (CPI 01 food & non-alc bev) | UK div 01 excludes restaurants (11) like US |
| CPIENGSL (energy) | DIRECT | ✅ `DK9T` (CPI: Energy special aggregate) | |
| CUSR0000SACL1E (core goods) | DIRECT | ✅ `D7F4` (CPI: Goods) minus food/energy via special aggregates | Exact "goods ex food & energy" special-aggregate index exists in MM23; specific CDID UNVERIFIED — fallback: goods `D7F4` + energy/food weights ✅ `A9F3`/`CHZR` |
| CUSR0000SASLE (core services) | DIRECT | ✅ `D7F5` (CPI: Services) | UK services ≈ core services (energy sits in goods) |
| Contribution weights (fixed Dec-24) | DIRECT | CPI weight CDIDs, time-varying (✅ `CHZR` div-01 pattern; ✅ `A9ES`/`A9ET`/`A9F3` special-agg weights) | Better than US fixed weights — use published annual weights |
| 72 distribution sub-indices | DIRECT | MM23 COICOP class-level indices (✅ pattern confirmed: `D7E5` = 05.6.1 index) | Full CDID list enumerable from MM23 download; individual codes UNVERIFIED until enumerated |
| 100+ explorer items (`CPI_ITEMS`) | DIRECT | 12 divisions ✅ `D7BU D7BV D7BW D7BX D7BY D7BZ D7C2 D7C3 D7C4 D7C5 D7C6 D7C7` + goods ✅ `D7F4`, services ✅ `D7F5`, energy ✅ `DK9T`, CPIH ✅ `L522`/`L55O`, RPI ✅ `CHAW`/`CZBH` | Division annual-rate twins follow `D7G8`+ pattern ✅; monthly-rate `D7JH`+ ✅ |
| CPI Projections model | DIRECT | Same carry-forward model on ✅ `D7BT` / `DKC6` | **Caveat:** NSA MoM paces embed seasonality — either project with same-month-last-year rates or flag clearly |

### Inflation — PCE pages

| US element | Class | UK equivalent | Notes |
|---|---|---|---|
| PCEPI + 22 lines + core (BEA 2.3.4U monthly) | GAP | No UK monthly consumption deflator | **Recommend: omit both PCE pages.** Quarterly household-consumption deflator could be derived (ABJQ/ABJR) but adds little vs CPI/CPIH. CPIH (✅ `L522`) already fills the "broader-than-CPI" slot on the Other page |
| PCE Projections | GAP | — | Omit |

### Inflation — PPI page

| US series | Class | UK equivalent | Notes |
|---|---|---|---|
| PPIFIS (final demand) | PROXY | ✅ `JVZ7` (output: net sector output, manufactured products, MM22/PPI) | UK PPI covers manufacturing output only — no "final demand services" concept. NSA. |
| PPIFES (core) | PROXY | ✅ `GBBV` (output: core manufactured products ex food/bev/tob/petroleum) | |
| PPIDSS (services) | GAP | UK Services PPI is quarterly, separate dataset | Omit or add later as quarterly panel (codes UNVERIFIED) |
| WPSFD413 etc. (goods detail) | DIRECT | MM22/PPI CDIDs per CPA product division (✅ pattern: `GD6Y` output total ex duty; `JVZ8` all manufacturing ex duty) | Full division list enumerable from MM22; individual codes UNVERIFIED |
| Input-cost side (no US panel) | ADD | ✅ `K646` input NSI all manufacturing incl CCL; ✅ `K645` fuel; group indices ✅ `FSQ6`/`FSQ7`; domestic/imported splits ✅ `GHAE`/`GHCI` pattern | UK convention pairs output PPI with input PPI — recommend adding an input panel the US page doesn't have |
| Sub-category contribution weights | PROXY | Net-sector weights published in bulletin only (not CDIDs) | UNVERIFIED — either scrape bulletin weights or show sub-index YoY/MoM panels without contribution stacking |

### Inflation — Other page

| US series | Class | UK equivalent | Notes |
|---|---|---|---|
| MICH / SCE 1y/3y/5y expectations | PROXY | BoE/Ipsos Inflation Attitudes Survey (1y/2y/5y), quarterly | Excel download only, no API — UNVERIFIED; quarterly vs monthly |
| PCETRIM12M159SFRBDAL (trimmed mean) | GAP | Not published for UK | Omit |
| CORESTICKM159SFRBATL (sticky CPI) | GAP | Not published for UK | Omit |
| CP0000USM086NEST (US HICP) | DIRECT | UK CPI **is** the UK HICP; add euro-area HICP comparator via FRED `CP0000EZ19M086NEST` | Cross-country panel: UK CPI vs EA HICP vs US CPI, all already fetchable |
| (new) RPI/CPIH wedge | ADD | ✅ `CZBH` RPI YoY vs `D7G7` CPI YoY vs `L55O` CPIH YoY | UK-specific: RPI–CPI wedge matters for gilts/linkers |

### Growth — NGDP page

| US element | Class | UK equivalent | Notes |
|---|---|---|---|
| GDP (nominal, quarterly) | DIRECT | ✅ `YBHA` QNA £m CP SA | |
| PCEC | DIRECT | ✅ `ABJQ` household consumption CP SA | |
| GPDI / FPI | DIRECT | `NPQS` GFCF nominal (already ingested & rendered by `UKNominalGDPContent`) | Real twin ✅ `NPQT` |
| NETEXP / EXPGS / IMPGS | DIRECT | ✅ `IKBJ` balance / `IKBH` exports / `IKBI` imports (CP SA) | |
| GCE | DIRECT | `NMRP` govt consumption CP SA (already ingested, `UKNominalGDPContent`) | Real twin `NMRY` in use |
| 40+ detail lines (durables sub-splits etc.) | PROXY | UK expenditure detail is thinner at monthly/quarterly CDID level | Build 2-level hierarchy (GDP → C/I/G/X/M → 4–6 sub-lines) instead of 49-line NIPA tree |
| Client-computed nominal contributions | DIRECT | Same math valid (current prices are additive) | |

### Growth — RGDP page

| US element | Class | UK equivalent | Notes |
|---|---|---|---|
| GDPC1 | DIRECT | ✅ `ABMI` CVM SA £m; QoQ ✅ `IHYQ`; YoY ✅ `IHYR` | |
| Real components | DIRECT | ✅ `ABJR` household; ✅ `NPQT` GFCF; ✅ `NPEL` business investment; ✅ `IKBK`/`IKBL` trade CVM; govt real (UNVERIFIED) | |
| BEA 1.5.2 published contributions | PROXY | ONS publishes expenditure contributions to GDP growth in the quarterly-accounts dataset (Excel tables, not CDIDs) | Extend the existing `ons_gdp_contributions` Excel-scraper pattern; UNVERIFIED table structure |
| Explorer on 49 real series | PROXY | Reduced hierarchy (~12–15 verified CVM series) | CVM non-additivity note in UI |

### Growth — Monthly GDP (no US analog page; absorbs existing UK Growth page)

| Element | Class | UK series | Notes |
|---|---|---|---|
| Monthly real GDP | DIRECT | ✅ `ECY2` index / `ECYX` MoM (MGDP) | Existing page already renders this + `ons_gdp_contributions` |
| Sector indices | DIRECT | ✅ `S2KU` services (IOS1); ✅ `K222` production, `K22A` manufacturing (DIOP); construction monthly (UNVERIFIED) | Feed the ExplorerE1–E5 block |

### Growth — PIO page

| US element | Class | UK equivalent | Notes |
|---|---|---|---|
| PI/DSPI/PCE monthly income & outlays tree (~43 series) | GAP as monthly | **Restructure → quarterly "UK Household Income" page**: ✅ `NRJR` RHDI CVM SA; ✅ `IHXY` RHDI per head; ✅ `KHI9` RHDI growth; ✅ `DGD8` saving ratio; ✅ `DTWM` compensation of employees; ✅ `KAB9`/`KAI7` AWE levels | No UK monthly personal-income release. Quarterly sector accounts cover the concept |
| Contribution groups ×7 | GAP | Omit (source detail is quarterly Excel) | Rate charts (YoY/ann) on the series above replicate the page's right column |

### Growth — Retail page (absorbs existing UK Retail Sales page)

| US element | Class | UK equivalent | Notes |
|---|---|---|---|
| RSAFS / RSFSXMV | DIRECT | ✅ `J5EK` volume inc fuel SA / ✅ `J467` ex fuel (DRSI) | UK headline is volume; value twins exist in DRSI (UNVERIFIED) |
| 13 store-type components + contribution | PROXY | DRSI sector volume indices (predominantly food, non-food, non-store, fuel — CDIDs enumerable, UNVERIFIED); weights in bulletin only | Contribution chart needs bulletin weights (scrape) or switch to sector YoY panels |
| ExplorerE1–E5 | DIRECT | DRSI series tree | |

### Growth — NPCE/RPCE pages

| US element | Class | UK equivalent | Notes |
|---|---|---|---|
| 31 BEA monthly consumption lines (nominal + real) | PROXY | **Quarterly** Consumer Trends: real total ✅ `ABJR`; durable ✅ `UTID`; semi-durable ✅ `UTIT`; non-durable ✅ `UTIL`; services ✅ `UTIP`; nominal total ✅ `ABJQ` (nominal splits UNVERIFIED, exist in CT) | One combined "UK Consumption" page (quarterly) instead of two monthly pages; goods-vs-services ratio/level/YoY panels port directly |
| NPCE contribution charts | DIRECT (nominal only) | Nominal CT lines are additive | Real contributions: GAP (CVM) — omit, matching US RPCE page which already has none |

### Growth — GDI page

| US element | Class | UK equivalent | Notes |
|---|---|---|---|
| GDI + 24-line income tree | PROXY | GDP(I) quarterly: ✅ `DTWM` compensation; ✅ `CGBZ` gross operating surplus (✅ `IHXM` % of GDP); mixed income + taxes-less-subsidies (UNVERIFIED, QNA) | Slimmer 4–5 line income decomposition; nominal → client contribution math valid |
| A261RX1Q020SBEA real GDI | GAP | Not published | Omit |

### Growth — Consumer Health page

| US series | Class | UK equivalent | Notes |
|---|---|---|---|
| UMCSENT | GAP | GfK consumer confidence is private | Omit or manual-entry later |
| Delinquency rates (DRxx) | GAP | UK Finance arrears data is member-only | Omit; nearest public: mortgage possessions/arrears in FCA/MoJ quarterly Excel (UNVERIFIED) |
| TDSP/MDSP/CDSP debt service | GAP | Not published monthly for UK | Omit |
| RCCCBBALTOT card balances | PROXY | ✅ `LPMBI2O` consumer credit outstanding £m SA; flow ✅ `LPMB3PS`; growth ✅ `LPMB4TC` (BoE) | |
| BOGZ1FL192090005Q net worth | GAP | ONS household balance sheet is annual | Omit |
| GASREGW gasoline | PROXY | DESNZ weekly road fuel prices CSV (gov.uk) — UNVERIFIED | |
| (new) saving ratio / real wages | ADD | ✅ `DGD8`; real AWE ✅ `A3WW`/`A2FA` | Fills the gap left by omitted US panels |

### Growth — Trade page

| US element | Class | UK equivalent | Notes |
|---|---|---|---|
| BOPTEXP/BOPTIMP/BOPGSTB | DIRECT | ✅ `IKBH` exports / `IKBI` imports / `IKBJ` balance (CP SA, monthly in MRET) | Also CVM twins ✅ `IKBK`/`IKBL`/`IKBM` |
| BOPGTB goods balance | DIRECT | ✅ `BOKI` | |
| BOPSTB services balance | DIRECT | ✅ `IKBB` services exports; services imports/balance CDIDs UNVERIFIED (same family) | |
| Census goods by end-use ×14 | PROXY | UK trade in goods by SITC section (MRET dataset, CDIDs enumerable — UNVERIFIED) | Category set differs (SITC vs end-use) |
| Services by category ×18 | PROXY | Quarterly only (BoP dataset: ✅ pattern `FJSR` travel balance, `FJRP` transport) | Monthly US → quarterly UK |

### Labor — CPS page → "UK LFS"

| US series | Class | UK equivalent | Notes |
|---|---|---|---|
| UNRATE | DIRECT | ✅ `MGSX` (16+, SA) | Rolling 3-month |
| UNEMPLOY / CLF16OV | DIRECT | ✅ `MGSC` unemployed level; economically-active level (CDID UNVERIFIED; GB-only ✅ `YCIB` exists, UK version enumerable from LMS) | |
| U1–U6 | GAP | No UK U-series | Substitute: unemployment by duration (LMS CDIDs UNVERIFIED) |
| Decomposition by reason (LNS13*) | GAP | LFS publishes duration, not reason shares | Restructure panel → duration decomposition |
| By-age rates | DIRECT | ✅ `MGWY` 16–24 SA; 25–49/50+ (UNVERIFIED, LMS) | |
| EMRATIO / CIVPART | DIRECT | ✅ `LF24` employment rate 16–64; ✅ `LF2S` inactivity 16–64; ✅ `MGRZ` employment level | UK convention: inactivity, not participation |
| (new) redundancies / hours | ADD | ✅ `BEAO` redundancies; ✅ `YBUS` total weekly hours | |

### Labor — Claims page → "UK Claimant Count"

| US series | Class | UK equivalent | Notes |
|---|---|---|---|
| ICSA/ICNSA/CCSA/CCNSA weekly | PROXY | ✅ `BCJD` claimant count level (SA, monthly); ✅ `BCJE` rate | Monthly not weekly; no initial/continuing split. Heatmap/4-wk-MA panels don't port; seasonal by-year overlay + YoY do. **Caveat:** claimant count ≠ unemployment (UC policy effects) |

### Labor — CES page → "UK Earnings & Payrolls"

| US element | Class | UK equivalent | Notes |
|---|---|---|---|
| PAYEMS + 14 sector employment | PROXY | HMRC PAYE RTI payrolled employees, monthly, incl. sector splits — published via ONS/HMRC dataset (Excel/API UNVERIFIED) | The flagship UK monthly payrolls series; must verify feed shape in Phase 2 |
| AHE ×17 sectors | DIRECT | AWE sector series (EMP dataset): whole economy ✅ `KAB9` (total, £) / `KAI7` (regular); index ✅ `K54U`/`K54L`; sectors ✅ `K5DL` services, `K5DU` manufacturing, `K5DX` construction (full sector list enumerable) | Growth-rate CDIDs published directly: ✅ `KAC3` total 3m YoY, `KAI9` regular 3m YoY, ✅ `KAF5` single-month YoY; real ✅ `A3WW`/`A2FA` |
| AWH hours ×17 | PROXY | ✅ `YBUS` total actual weekly hours (whole economy); sector hours (UNVERIFIED) | |
| Diffusion index | PROXY | Compute from workforce-jobs or PAYE sector series once verified | |
| Aggregate payrolls (emp×AHE×AWH) | PROXY | PAYE RTI publishes total pay directly (UNVERIFIED) | Use published series rather than synthesizing |

### Labor — JOLTS page → "UK Vacancies"

| US series | Class | UK equivalent | Notes |
|---|---|---|---|
| JTSJOL openings | DIRECT | ✅ `AP2Y` vacancies (thousands, SA, monthly — 3m avg) | |
| Openings rate / Beveridge curve | DIRECT | Vacancy rate (per 100 jobs, CDID UNVERIFIED) or compute AP2Y/(AP2Y+MGRZ); vs ✅ `MGSX` | |
| JTSHIL/JTSQUL/JTSLDL hires/quits/layoffs | GAP | No UK JOLTS flows | ✅ `BEAO` redundancies as layoffs proxy; omit hires/quits and implied-NFP panel |
| Vacancies by industry | PROXY | ONS X06 table (Excel, UNVERIFIED) | |

### Labor — Productivity page

| US series | Class | UK equivalent | Notes |
|---|---|---|---|
| OPHNFB | DIRECT | ✅ `LZVB` output per hour, whole economy SA (PRDY, quarterly) | Same OLS pre-COVID trend model ports |
| ULCNFB | DIRECT | UK unit labour costs (PRDY, CDID UNVERIFIED) | |

### Labor — Projection page

| US element | Class | UK equivalent | Notes |
|---|---|---|---|
| U-3 scenario model (UNRATE, CE16OV, CLF16OV) | DIRECT | Same arithmetic on ✅ `MGSX`, ✅ `MGRZ`, active-level CDID (UNVERIFIED) | Scenarios in ±10k–50k/mo employment terms |

### Housing

| US element | Class | UK equivalent | Notes |
|---|---|---|---|
| Starts/permits/completions/under-construction (+unit splits) | PROXY | England house-building starts & completions, quarterly DLUHC Excel (UNVERIFIED); EPC-based new-supply quarterly | No monthly, no permits concept (planning approvals quarterly, HBF/DLUHC). Slimmer SUPPLY section |
| Months' supply / new home sales | GAP | Not published | Substitute: HMRC monthly property transactions (UNVERIFIED, gov.uk CSV) + ✅ `LPMVTVX` mortgage approvals as DEMAND |
| Res. construction payrolls/spending | PROXY | Construction output: new housing, monthly (ONS construction dataset, CDIDs UNVERIFIED) | |
| PRFI residential investment | PROXY | GFCF dwellings, quarterly (QNA CDID UNVERIFIED) | |
| MSPNHSUS / CSUSHPISA / CUSR0000SEHC prices | DIRECT | **UK HPI via Land Registry API** ✅ (tested: `landregistry.data.gov.uk/data/ukhpi/region/{region}/month/{yyyy-mm}` JSON — averagePrice, SA, by property type, annual change); rents: ONS Price Index of Private Rents, monthly (CDID UNVERIFIED) | New source + collector; Nationwide/Halifax GAP (private) |
| Price/income, price/rent spreads | DIRECT | UK HPI vs AWE ✅ `KAB9`; UK HPI vs PIPR | Same spread math |
| MORTGAGE30US, DGS10, DFF | DIRECT | Quoted mortgage rates ✅ `IUMBV34` (2y 75% LTV) / `IUMBV42` (5y 75%) / `IUMTLMV` (revert-to); ✅ `IUDBEDR` Bank Rate; 10y gilt from existing tv_series/BoE | UK fixes are 2y/5y not 30y |
| Effective rates / bank RRE loans | DIRECT | ✅ `CFMHSDE` effective secured-lending rate; net secured lending + gross lending (LPM CDIDs UNVERIFIED, Bankstats Table A5) | |
| DRSFRMACBS mortgage delinquency | GAP | UK Finance arrears private | Omit |

### Credit (H.8) → "UK Money & Credit" (BoE Bankstats)

| US element | Class | UK equivalent | Notes |
|---|---|---|---|
| TOTBKCR/TOTLL + H.8 tree ×3 cohorts | PROXY | BoE Money & Credit: M4 growth ✅ `LPMVQJW`; consumer credit ✅ `LPMB3PS`/`LPMBI2O`/`LPMB4TC`; secured lending, lending to PNFCs/SMEs (LPM/LPQ CDIDs enumerable from Bankstats — UNVERIFIED individually) | No large/small-bank cohort split. Explorer over a curated ~30-series Bankstats list |
| Loans % of NGDP | DIRECT | BoE stocks vs ✅ `YBHA` (quarterly interp.) | Same ratio math |

### Industrial (G.17) → "UK Index of Production"

| US element | Class | UK equivalent | Notes |
|---|---|---|---|
| INDPRO + 33 series & weight pairs | DIRECT | ✅ `K222` production; ✅ `K22A` manufacturing; sub-sector indices (DIOP, enumerable — UNVERIFIED); weights in bulletin (UNVERIFIED) | Explorer ports fully; contribution panel needs bulletin weights or ONS-published contributions (Excel) |

### Fiscal

| US element | Class | UK equivalent | Notes |
|---|---|---|---|
| DTS daily flows (ΔTGA−Δdebt) | GAP | No daily UK Treasury cash data | **Restructure**: UK Fiscal = monthly PSF, FY (Apr–Mar) cumulative overlays reuse the multi-FY chart pattern |
| Withheld tax deposits (12-period cycle tables) | PROXY | HMRC monthly tax receipts by head (gov.uk CSV/Excel, UNVERIFIED) — monthly not business-day | Same current-vs-prior-cycle table at monthly grain |
| MTS surplus/deficit | DIRECT | ✅ `DZLS` PSNB ex £m monthly (alt ✅ `J5II`); current budget ✅ `DZLT`; net investment ✅ `DZLW` | Cumulative-FY overlay identical, FY = Apr–Mar |
| FYTD % of GDP | DIRECT | ✅ `JNVA` borrowing % GDP (or vs ✅ `YBHA`) | |
| (new) debt stock | ADD | ✅ `HF6W` PSND ex £bn / ✅ `HF6X` % GDP / ✅ `KSE6` £m; gross debt ✅ `JMEQ` | US pages lack a debt panel; worth adding |
| (new) cash requirement | ADD | ✅ `RURQ` PSNCR / ✅ `RUUW` CGNCR monthly | Closest UK concept to DTS cash-flow framing |
| (new) receipts | ADD | ✅ `AHHY` total PS taxes & NICs monthly NSA | Headline receipts overlay |

### Mapping totals

- **DIRECT:** ~48 mapped concepts (all headline CPI/RPI/CPIH, divisions, GDP N+R+monthly, retail headline, trade, LFS core, AWE, vacancies, productivity, HPI, BoE rates/credit, PSF) — 60 individually verified codes (54 ONS CDIDs + 8 BoE + Land Registry endpoint)
- **PROXY:** ~20 (PPI scope, claimant count, PAYE payrolls, consumer trends quarterly, GDP(I), Bankstats explorer, housing supply, HMRC receipts, trade categories)
- **GAP:** ~14 (PCE pages, trimmed-mean/sticky, U1–U6, JOLTS flows, GfK, delinquencies, debt service, net worth, new home sales, DTS daily, real GDI, Nationwide/Halifax, UK Finance arrears, SCE)

---

## 1c. Proposed UK Page Structure

### Existing UK infrastructure (verified in codebase — reuse, do not rebuild)

The project already has far more UK plumbing than "UK Growth + UK Retail":

- **Generic ONS collector**: `server/src/onsApi.ts` + `fetchAllOnsSeries.ts` — 110+ CDIDs in `ALL_ONS_SERIES` auto-synced (startup + 06:00 cron) into `ons_observations`/`ons_series_meta`; served by `/api/ons?cdid=&dataset=`; client helper `client/src/lib/ons.ts`. **Adding a series = adding one line to `ALL_ONS_SERIES`.**
- **Generic BoE collector**: `boeApi.ts` + `fetchAllBoeSeries.ts` — grouped `ALL_BOE_SERIES` (rates, gilts, FX, money, mortgages, consumer credit, mortgage/effective rates) → `boe_observations`; served by `/api/boe?series=`; client helper `lib/boe.ts`. Already contains `IUDBEDR IUDSOIA LPMBI2O IUMBV34 IUMBV42 IUMTLMV LPMVTV*` + more.
- **ONS Excel scraper**: `onsMonthlyGDPContribs.ts` → `ons_gdp_contributions` (mom/yoy/3m3m) with archive backfill — the template for any bulletin-Excel source (quarterly GDP contributions, PPI weights, housing starts).
- **UK pages already live** (inside `GrowthPage` country=`uk` tabs, shared CSS `UKGrowthCharts.module.css`): `UKNominalGDPContent` (YBHA + expenditure/COICOP/GFCF/income splits), `UKRealGDPContent` (ABMI + CVM splits), `UKMonthlyGDPContent` (ECY2 + sector subs + published contributions), `UKRetailContent` (J5EK/J467 + sector real/nominal pairs), `UKTradeContent` (BOKI/IKBK/IKBL).
- **UK fundamental panel** (`UKFundamentalModelPanel` on STIR page) already implements the CPI carry-forward projection server-side (`/api/uk/fundamental/:tab` — cpi/core_cpi/labor/growth). Out of scope to change, but its projection logic is the seed for the UK CPI Projections page.

### Page tree (country=`uk` within existing hub structure)

The model hubs already have a country bar (`modelNav.tsx` COUNTRIES, `us` active, others "coming soon"). UK pages slot in as `country === 'uk'` branches — same pattern `GrowthPage` already uses — rather than new top-level routes.

| Hub | UK sections | Verdict vs US |
|---|---|---|
| **Inflation** | CPI · CPI PROJECTIONS · PPI · OTHER | Replicates 1:1 minus the two PCE pages (GAP). CPI page: contribution (division indices × weight CDIDs), distribution (COICOP classes), explorer, rates. OTHER = RPI/CPIH/EA-HICP comparison + RPI-CPI wedge + BoE/Ipsos expectations (deferred if scrape is ugly) |
| **Growth** | NGDP · RGDP · MONTHLY GDP · RETAIL · TRADE (all **existing — extend**) + CONSUMPTION (new, quarterly CT) · HOUSEHOLD INCOME (new, PIO-analog) · GDP(I) (new, slim) · CONSUMER HEALTH (new, restructured) | Existing 5 tabs get the ExplorerE1–E5 block + rate charts added to match US depth; 4 new tabs |
| **Labor** | LFS · CLAIMANT COUNT · EARNINGS & PAYROLLS · VACANCIES · PRODUCTIVITY · PROJECTION | Mirrors US 6-page structure; CES→Earnings & Payrolls (AWE + PAYE RTI), Claims→Claimant Count (monthly), JOLTS→Vacancies (no flows) |
| **Housing** | Single page, sections SUPPLY · DEMAND · PRICES · CREDIT | Same shell; SUPPLY slimmer (quarterly starts/completions + construction output), DEMAND = approvals + transactions, PRICES = UK HPI + rents, CREDIT = BoE quoted/effective rates + secured lending |
| **Credit** | MONEY & CREDIT | H.8 analog on BoE Bankstats: aggregates % NGDP, N-month flows, curated ~30-series explorer (no bank-size cohorts) |
| **Industrial** | IOP EXPLORER | 1:1 port on DIOP series tree; contribution panel only if weights sourced |
| **Fiscal** | PSF (monthly) · RECEIPTS (HMRC, phase-2 stretch) | Restructured: no DTS. PSF = PSNB cumulative FY(Apr–Mar) overlays (reuses MTS multi-FY pattern), debt stock, PSNCR/CGNCR; RECEIPTS = HMRC monthly tax heads with current-vs-prior-cycle table (DTS-tax-table analog) |

### New collectors needed vs reuse

| Work item | Type | Effort driver |
|---|---|---|
| ~120 new ONS CDIDs (verified list above + enumerations) | **Config only** — extend `ALL_ONS_SERIES` | Enumerate remaining UNVERIFIED CDIDs (CPI classes, PPI divisions, DRSI sectors, DIOP sub-sectors, PUSF receipts, LMS detail) |
| ~25 new BoE codes | **Config only** — extend `ALL_BOE_SERIES` | Most housing/credit codes already present |
| Land Registry UK HPI collector | **New module** (`ukHpi.ts`) | JSON API verified live; new table `uk_hpi` |
| HMRC tax receipts collector | **New module**, gov.uk CSV/Excel | UNVERIFIED feed shape — Phase 2 spike |
| PAYE RTI payrolled employees | **New module or ONS dataset** | UNVERIFIED — check if X09-style CDIDs exist before building Excel parser |
| DLUHC housing starts/completions | **New Excel scraper** (reuse `onsMonthlyGDPContribs` pattern) | Quarterly, low urgency — can defer |
| Quarterly GDP expenditure contributions | **Extend Excel-scraper pattern** | For RGDP contribution charts (CVM non-additive) |
| BoE/Ipsos expectations | **New Excel scraper** | Defer-able |

### Frontend components: reuse vs parameterize

- All US chart building blocks (ExplorerE1–E5, contribution SVG charts, rate charts, multi-FY overlay) are **inline per page** — nothing is imported cross-page. Phase 3 must extract parameterized components (per the `StirStripPage` pattern) rather than copy: priority extractions = Explorer block (used ~10×), contribution chart (5 variants that are near-identical), multi-FY overlay (DTS/MTS duplicate), rates chart (YoY/ann3/ann6, used ~8×).
- UK pages then compose these with `fetchOnsSeries`/`fetchBoeSeries` instead of `fetchFredSeries` — suggest a thin `SeriesSource` adapter so components take `{date,value}[]` and don't care about origin.
- Existing `UK*Content` pages keep their current charts and gain the shared explorer/rate blocks (extend, not rewrite).

---

## Phase 1 summary & open decisions

**Counts:** ~82 mapped concepts → **48 DIRECT / 20 PROXY / 14 GAP**. 60+ series codes individually verified live (54 ONS CDIDs, 8 BoE IADB codes with titles, Land Registry HPI endpoint); ~25 more already proven in production via `ALL_ONS_SERIES`. All remaining unknowns are explicitly marked UNVERIFIED with the dataset they live in.

**Top 5 decisions needed before Phase 2:** *(answered 2026-07-07 — see Phase 2 addendum at the bottom)*
1. **PCE pages** — omit entirely (recommended), or build a quarterly household-consumption-deflator substitute?
2. **UK Fiscal shape** — accept the restructure (PSF monthly FY-overlays + debt panel, HMRC receipts as the DTS-tax-table analog, no daily-flows chart)? HMRC feed is a Phase 2 spike with UNVERIFIED format.
3. **Component parameterization scope** — Phase 3 wants Explorer/contribution/rates/multi-FY extracted from US pages into shared components. This touches (but should not visibly change) US pages. OK, or prefer UK-side copies (violates the no-fork guidance but zero US risk)?
4. **Housing SUPPLY section** — quarterly-only DLUHC starts/completions requires a new Excel scraper for a thin panel. Build in Phase 2, or ship Housing without SUPPLY first?
5. **Projections seasonality** — UK CPI is NSA; the US MoM-carry-forward projection model will embed seasonal noise. Project with same-month-last-year MoM paces instead (recommended), or port the US model unchanged for consistency?

---

## Phase 2 Addendum (2026-07-07) — Ingestion Complete

Decisions applied: PCE omitted · Fiscal = PSF restructure · shared-component extraction approved (Phase 3) · Housing ships without SUPPLY · CPI projection uses same-month-prior-year MoM paces (UI-labeled) · PROXY panels require `<ProxyBadge>` (caveat registry: `client/src/data/ukProxyCaveats.ts`).

### What was ingested
- **ONS**: `ALL_ONS_SERIES` grown to 304 CDIDs (~130 added), all verified live. New families: CPI division indices D7BU–D7C7 + 37 group-level (XX.Y) indices + special aggregates (D7F4/D7F5/DK9T/DK9J/DK9O) + all weights (CHZR–CJUW divisions; A9EW/A9F3/A9ER/ICVI/ICVH aggregates); PPI post-redesign (JVZ8, GBBV, GD6Y, K646, K645, FSQ6/7 + division samples); LFS detail (YBUS, BEAO, MGXB, YBVW, MGSF, LF2K, MGTS); AWE levels/indices/growth (KAI7, KAI9, KAF5, A2FA, K54U/L, K552/553, K54W/X, K5DL/DU/DX); productivity + ULC (LZVB, DMWN, DMWO, LNNL); household income (NRJR, IHXY, KHI9, DGD8, IHXM, L8GG); consumer trends (UTID/UTIT/UTIL/UTIP); trade totals + services (IKBJ/H/I/M, IKBB/C/D/E/F); PSF (DZLS, J5II, DZLT, DZLW, HF6W, HF6X, RURQ, RUUW, AHHY, JNVA, JMEQ). **0 missing at verification.**
- **BoE**: +LPMVQJW, LPMVTVX, LPMB3PS, LPMB4TC, CFMHSDE. **0 missing (45 codes).**
- **New collectors** (+ tables + routes + startup/cron): `ukHpi.ts` → `uk_hpi` → `/api/uk-hpi` (Land Registry full-file CSV, 6 regions, 1968→present); `hmrcReceipts.ts` → `hmrc_receipts` → `/api/hmrc-receipts` (44 tax heads, Apr 2017→); `payeRti.ts` → `paye_rti` → `/api/paye-rti` (payrolled_employees, median/mean/aggregate_pay, Jul 2014→).
- Verification runner: `server/src/scripts/verifyUkIngest.ts`. Spot-checks D7BT (142.4, 2026-05), MGSX (4.9, 2026-03), ECY2 (103.3, 2026-04) all match ONS source exactly.

### Pre-existing bugs found & fixed (UK infra only, no US changes)
1. **BoE monthly sync never worked**: `dateFrom '01/Jan/1960'` predates the IADB floor and the IADB errors the ENTIRE request → every monthly LPM/IUM series had 0 rows since inception. Fixed to `01/Jan/1980` (verified). The IADB also fails whole requests containing ANY invalid code — 11 invalid codes removed (see notes in `fetchAllBoeSeries.ts`); several surviving codes had wrong concept comments (LPMVTXK is secured-lending outstanding, not PNFC; LPMBI2O is consumer credit outstanding, not gross mortgage lending) — corrected.
2. **ONS URI discovery** used free-text `q=` search → ambiguous CDIDs (UTIL, ADJE, ADJS) failed. Switched to exact `cdids=` filter in `onsApi.ts`.
3. **17 dead ONS CDIDs** in the pre-existing config (404, never had rows): retail sector splits J5DP/J5DT/J5DV/J5DX/J5E2/J5E6/J5EL/J459/J45D/J45F/J45P/J5C8, J5HQ/J5HR/J5KS, A4GL, K230, DFEE/DLWC/DLWR/DFDI/DLWN. Replaced with verified codes (EAPT/EAPV/EAPU/EAPX/EAPY/EAPW/JO5A; EAQW/EAQY/EAQX/EARA/EARB/J5BI/JO2G; ED3H; K23T; TLPX/L62U) or removed with notes where no verified replacement exists yet.

### Deferred / UNVERIFIED (do not ingest without verification)
- BoE codes: M4 lending level, net mortgage lending flow, credit-card/other-consumer-credit splits, PNFC lending, household deposits (all had invalid codes; need verified replacements from Bankstats)
- GFCF nominal levels: dwellings, other buildings, IP products; transport equipment CVM — the surviving pre-audit GFCF block labels are unverified (flagged in config)
- Retail deflator YoY splits (compute implied from value/volume instead); internet value index
- Trade in goods by SITC section; quarterly services-trade by category detail
- PAYE RTI industry splits (sheets 23–26 — collector currently ingests UK-level sheets 1–4)
- BoE/Ipsos Inflation Attitudes Survey (stable URL verified: `bankofengland.co.uk/-/media/boe/files/inflation-attitudes-survey/long-run.xlsx` — collector not built per approval scope)
- Quarterly GDP expenditure contributions Excel scraper (for RGDP contribution charts; QNA bulletin confirms the table exists)
- DLUHC housing starts/completions (deferred per decision 4); DESNZ road fuel prices; PIPR rents (use D7CE/D7GQ CPI rents meanwhile); unemployment-by-duration CDIDs; vacancies by industry (X06); workforce jobs by sector

---

## Phase 3 Addendum (2026-07-07) — Frontend Complete

### Shared components extracted from US pages (decision 3)
- `client/src/lib/seriesTransforms.ts` — transforms/formatters/chart constants (from RetailSalesDashboardPage inline helpers, frequency-parameterized)
- `client/src/components/charts/`: `SeriesExplorer` (E1–E5 block), `RatesChart` (YoY/annN), `ContribSection` + `ContribBarChart` (diverging stacked SVG), `FiscalYearOverlay` (multi-FY cumulative, FY-calendar-parameterized), `QuickSelectRow`, `ChartKit.module.css`
- `client/src/components/ProxyBadge.tsx` — PROXY chip + hover tooltip fed from `ukProxyCaveats.ts` (18 entries)

**US consumers of refactored components (regression list):** `RetailSalesDashboardPage.tsx` (SeriesExplorer + RatesChart ×2 + ContribSection ×2) and `MtsPage.tsx` (FiscalYearOverlay). Other US pages were NOT migrated (their inline implementations untouched) — migrating them is optional follow-up. Regression evidence: strict tsc clean, vite production build clean, SSR smoke renders pass (`client/src/pages/renderSmoke.test.tsx`, 23 tests: both US pages + all UK components); no browser exists in this WSL environment, so pixel-level verification was not possible — extraction was verbatim-with-parameters and CSS values copied exactly.

### UK pages shipped (all under the existing hub country bars, `country === 'uk'`)
- **Inflation**: CPI (contribution w/ published weights, 37-group distribution, rates, explorer) · CPI PROJECTIONS (same-month-prior-year MoM paces ×1y/2y-avg/3y-avg, visible methodology caption per decision 5) · PPI (badged proxy) · OTHER (CPI/CPIH/RPI + wedge + rents)
- **Growth** (added tabs): CONSUMPTION (quarterly CT, no CVM summing/contribution) · HOUSEHOLD INCOME · GDP(I) (nominal contribution via shared ContribSection) · CONSUMER HEALTH
- **Labor**: LFS · CLAIMANT COUNT · EARNINGS & PAYROLLS (PAYE RTI + AWE) · VACANCIES (incl. Beveridge curve) · PRODUCTIVITY (incl. pre-COVID OLS trend) · PROJECTION (scenario arithmetic, labeled)
- **Housing**: DEMAND / PRICES / CREDIT — NO SUPPLY tab (decision 4)
- **Credit**: MONEY & CREDIT (M4, lending stocks/flows, % of NGDP)
- **Industrial**: IOP EXPLORER (17 DIOP series)
- **Fiscal**: PSF BORROWING (Apr–Mar FY cumulative overlays via FiscalYearOverlay, debt, PSNCR, receipts) · HMRC RECEIPTS (FY overlay + tax-head panels, all badged)

### Proxy registry reconciliation (pre-build step)
Registry (16 entries at approval) covered every shipping PROXY panel except two — added `hours_worked` and `vacancy_rate` (plus `consumer_credit` found during build). The "20 PROXY" concepts not in the registry are all deferred/omitted items (services-trade detail, RGDP published contributions, Housing SUPPLY family, vacancies-by-industry, IoP weights, DESNZ fuel) that ship no panels.

### Panels omitted (deferred data — no placeholders built)
UMich/GfK sentiment, delinquencies, debt service, HH net worth (Consumer Health); JOLTS hires/quits/layoffs + implied-NFP (Vacancies); Housing SUPPLY entirely; BoE/Ipsos expectations (Other Inflation); RGDP quarterly contribution charts (needs the deferred ONS Excel scraper); trade-by-SITC panels; credit-card/other-credit splits, PNFC lending, HH deposits (Money & Credit); IoP contribution panel; PAYE industry splits.

### Optional follow-ups
Migrate remaining US explorer/contribution pages onto the shared components; add SeriesExplorer blocks to the pre-existing UK NGDP/RGDP/Monthly/Retail/Trade tabs; resolve deferred collectors (Phase 2 addendum list); fix pre-audit GFCF label mismatches flagged in `fetchAllOnsSeries.ts`.
