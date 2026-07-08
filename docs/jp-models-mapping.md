# Japan Economic Data Models — Mapping Document (Phase 1)

Produced 2026-07-07 per `docs/country-replication-playbook.md`. Every ✅ item was verified live
today against the e-Stat 3.0 API (`getMetaInfo` → exact table/class titles; one latest
observation sanity-fetched per anchor) or the named non-e-Stat source. `UNVERIFIED` = plausible
source named but not confirmed — do NOT ingest without verification. The appId never appears in
this doc, in logs, or in code.

**Global caveats:**
1. **Core nomenclature is inverted vs the US.** Japan's "core" = **ex fresh food only (energy
   included)** — the BoJ's policy reference. "Core-core" = ex fresh food AND energy — the closest
   US-core analog. Every core panel carries a caption making this unmissable; series codes follow
   domestic convention (CPI_CORE = ex fresh food; CPI_CORECORE).
2. **`lang=E` silently hides most ministry tables.** The 2020-base SNA/IIP/MLIT/commerce tables
   return "does not exist" under `lang=E` — the collector must default to `lang=J` and match
   Japanese class names (Statistics Bureau CPI/LFS tables do carry English).
3. **CPI is monthly NSA with SA variants for the three headline aggregates only** (0901/0902/0906
   in-table). Projections use the NSA same-month-prior-year method (UK/CA precedent) with the SA
   series as overlay context.
4. **Several ministries stopped loading the e-Stat DB** while continuing file publication:
   MLS wages (2020-base never loaded), retail (frozen Jan-2025), housing starts (frozen Dec-2024,
   explicit "use the Excel tables" notice). These are honest GAP/defer calls below — the API data
   exists but is stale, and stale-as-current violates the no-misleading-data rule.
5. Yen scales differ per table and are recorded per series below (¥bn for SNA, ten-thousand
   persons for LFS levels, ¥100M for BoJ lending, ¥thousand for customs trade).
6. e-Stat time codes: monthly `YYYY000M0M` (e.g. 2026000505 = 2026-05); SNA quarterly
   `YYYY000103/000406/000709/001012` — the existing `decodeTimeCode` (chars 6–8 = month) handles
   BOTH correctly (Q1→01, Q2→04…). IIP uses **pseudo-time category codes** (`0500100`=2018-01,
   +200/month, with a weight row `0100100` to exclude) — needs its own decoder.

**Anchor-lead corrections:** 0003427113 ✅ correct (2020-base national CPI). 0002060001 is
employed-persons **levels**, not the SA majors table (no SA LFS DB table exists — verified
absent). 0003427188 (Tokyo advance) **does not exist** — the Tokyo advance is
**`cdArea=13A01` inside 0003427113** (verified: Tokyo has 2026-06 while national tops at
2026-05). statsCodes 00100409 (SNA) and the IIP guesses are invalid — tables were found by
Japanese title search.

---

## 1a. US Model Inventory — reused
`docs/uk-models-mapping.md` §1a remains current: since the Canada run (`3b1c639`) US pages
changed only via nav wiring (`3d8917a`). No panels added/changed.

---

## 1b. US → Japan Series Mapping

### Existing `collectors/estatCollector.ts` (gate item)
Feeds the JPY STIR fundamental panel: 4 series into `estat_observations` — CPI_HEADLINE_JP /
CPI_CORE_JP / CPI_CORECORE_JP (0003427113 cat01 0001/0161/0178) + UNRATE_JP (0003005865, NSA).
All four re-verified live today (table updated 2026-06-26/30). **Recommendation: EXTEND-BY-SIBLING
(Canada precedent)** — a new generic `fetchAllEstatSeries.ts` writes to the same
`estat_observations` table, skips those 4 codes, imports the exported `decodeTimeCode`, and the
rates-side module stays untouched.

### Inflation — CPI page (table ✅ 0003427113, monthly, 2020=100, NSA, area 00000; NATIONAL latest all-items 113.5 May-26)

| US element | Class | Japan equivalent (cat01 codes) | Notes |
|---|---|---|---|
| CPIAUCSL | DIRECT | ✅ 0001 All items (rates-side code CPI_HEADLINE_JP) | tab 1=index / 2=MoM / 3=YoY published |
| CPILFESL (core) | DIRECT* | ✅ 0161 "All items, less fresh food" (BoJ core; **energy included**) + ✅ 0178 "less fresh food and energy" (core-core = US-core analog) | *Nomenclature caption mandatory (global caveat 1) |
| SA variants | DIRECT | ✅ 0901 all-items SA, 0902 core SA, 0906 core-core SA (same table) | Headline aggregates only |
| Divisions (10) | DIRECT | ✅ 0002 Food, 0045 Housing, 0054 Fuel/light/water, 0060 Furniture & utensils, 0082 Clothes & footwear, 0107 Medical care, 0111 Transport & communication, 0118 Education, 0122 Culture & recreation, 0145 Miscellaneous | |
| Special aggregates | DIRECT | ✅ 0157 Fresh food, 0167 Energy, 0163 less imputed rent, 0202 Goods, 0220 Services (SA: 0921/0924), 0237/0238/0239 durable/semi/non-durable, 0240 public utilities, 0245–0248 rent detail | |
| Distribution sub-indices | DIRECT | 790 item classes enumerable (L2/L3); ~30-item curated set to resolve in Phase 2 | Codes UNVERIFIED until enumerated |
| Contribution weights | UNVERIFIED | CPI weights (10000-parts) presumed in a companion weights table — one getMetaInfo in Phase 2 | Gate decision (g): conditional pre-approval requested |
| **Tokyo CPI advance** | DIRECT | ✅ same table, **cdArea=13A01** — carries month T while national has T−1 (verified: Tokyo 2026-06 = 112.7) | Decision (a): zero extra collector cost |

### Inflation — CPI Projections
Same-month-prior-year MoM paces on NSA 0001/0161/0178 with the methodology caption; SA series
(0901/0902/0906) plotted as historical overlay only. PCE pages: **GAP — omit** (no monthly
consumption deflator; UK/CA precedent).

### Inflation — PPI page
**UNVERIFIED — defer decision to Phase 2 spike or omit**: Japan's CGPI (corporate goods price
index) is BoJ data (`PR01` family on the BoJ TSDS API, plausible but not verified today). Gate
decision (h): approve a one-table BoJ verification in Phase 2 (build if verified), or omit.

### Growth — GDP (SNA, Cabinet Office via e-Stat ✅; **lang=J only**; unit 10億円 = ¥bn, SAAR-style annualized levels; 1994Q1→)

| US element | Class | Japan equivalent | Notes |
|---|---|---|---|
| GDPC1 real GDP | DIRECT | ✅ 0003109750 cat01=11 (2026Q1 = ¥593.2T ann.) | Chained-2020, SA quarterly |
| Real components | DIRECT | ✅ same table: 12 private consumption, 15 residential inv, 16 private non-resi capex, 17 private inventories, 18 govt consumption, 19 public investment, 22 exports, 23 imports (+31–33 demand aggregates) | |
| Published QoQ/ann/contributions | **DIRECT** | ✅ 0003113542 (tab 13 contribution, 14 QoQ, 15 QoQ-ann, 16 contribution-ann; 2026Q1 +0.5% QoQ / +1.8% ann) | ContribSection fed with published rows (Canada precedent) |
| Nominal GDP + components | DIRECT | ✅ 0003109785 (2026Q1 = ¥675.6T) + rates ✅ 0003113646 | |
| Deflator | DIRECT | ✅ 0003109787 (113.9) + QoQ ✅ 0003113648 | |
| Real NSA (for YoY) | DIRECT | ✅ 0003109766 | |

### Growth — Consumption (PIO/NPCE analog)
**PROXY**: FIES household consumption ✅ 0002070001 (monthly, ¥/household, two-or-more-person
households cat02=03, consumption expenditure cat01=059 + 10 categories 060+, income side 019;
May-26 = ¥320,345; 1985→ with a 2000 series break on cat02). **The official real YoY is NOT
API-tabled** — panel shows nominal level/YoY plus a clearly-labeled CPI-deflated real series
(computed, captioned; deflator = CPI less imputed rent 0163 per the Bureau's method). BoJ/Cabinet
consumption activity indices: GAP (file-only).

### Growth — Retail
**DEFER (honest)**: survey is alive (May-26 published) but the e-Stat DB froze at **Jan-2025**
(vintage tables ✅ 0004032483 sales ¥bn / 0004032484 SA index 2020=100, codes recorded). Serving
17-month-stale data as current is misleading — no tab until the e-Stat file/METI Excel collector
follow-up (paths recorded; METI web server needs a browser UA).

### Growth — Trade
**PROXY (source, not concept)**: e-Stat carries only commodity×country detail — **no totals**
(verified). Verified fallback: **Customs CSV `customs.go.jp/toukei/suii/html/data/d41ma.csv`** —
world monthly exports/imports totals, ¥thousand, 1979→, NSA, cp932 + browser-UA + zero-filled
future months to filter (May-26: exp ¥9.50T, imp ¥9.89T, bal −¥0.39T). Small CSV collector
(UK-HPI pattern).

### Growth — GDI / Consumer Health
GDI: SNA income-side quarterly exists (✅ 0003109777 employee compensation nominal SA found);
full decomposition UNVERIFIED — fold compensation into Consumption/Household panels, no GDP(I)
tab for v1. Consumer Health: **GAP-heavy** — no DSR/credit-card/delinquency publications;
Consumer Confidence Survey (Cabinet Office) UNVERIFIED on the API. Omit the tab; BoJ lending
covers the credit side (below).

### Labor (LFS ✅ current on API; Business-Conditions composite table ✅ 0003446462, Cabinet Office, monthly, Jan-1975→, updated 2026-07-07)

| US element | Class | Japan equivalent | Notes |
|---|---|---|---|
| UNRATE | DIRECT* | ✅ 0003005865 cat02=08 (**NSA**, May-26 2.6%) + ✅ 0003446462 cat01=3060 **SA** unemployment (May-26 2.46%) — the only API-native SA series | *NSA labeled; SA overlay from the composite table |
| Participation / employment rates | DIRECT | ✅ 0003005865 cat02=01 / 13 (NSA; May-26 particip 64.6%) | |
| Employment level | DIRECT | ✅ 0002060001 (May-26 = 6,890 万人 = 68.90M; **unit ten-thousand persons**) | NSA |
| By-age rates | DIRECT | ✅ 0002060004 (cat04 age: 00=15+, 01=15–24, 06=25–34, 09=35–44, 12=45–54, 15=55–64; **cat02/cat03 swapped vs 0003005865**) | NSA, 1968→ |
| JTSJOL / JOLTS | PROXY | ✅ 0003446462 cat01=**2090** active job-offers-to-applicants ratio (SA, May-26 = 1.17) + 1030 new job offers (SA, 785,944) | Japan's own market-moving labor gauge |
| PAYEMS payrolls | PROXY | ✅ 0002060001 employed persons (household survey) + ✅ 0003446462 cat01=3020 regular-employment YoY (MLS-derived) | Decision (c): full MLS employment level is file-only |
| AHE wages | PROXY (partial) | ✅ 0003446462 cat01=**3070** contractual cash earnings, **manufacturing only** (2020=100, Apr-26 = 116.1). Full MLS nominal/real wage indices: **API-GAP** — 2020-base never loaded to e-Stat DB; file pipeline (e-Stat file section toukei=00450071 tstat=000001011791 tclass1=000001035519, 長期時系列 CSVs upd 2026-06-24) deferred | Decision (e); bonus-month caveat mandatory |
| ICSA claims | GAP | No weekly claims concept | Omit |
| Productivity | UNVERIFIED | JPC/quarterly productivity not checked | Defer; no tab v1 |
| U-3 projection | DIRECT | Mechanical model on 0003005865 + 0002060001 + labour-force level (same table family) | NSA caption |

### Housing
**DEFER the category (decision d)**: starts table ✅ 0003114496 verified (codes recorded: tab=19
units, cat02 tenure 11 total/12 owned/13 rented/15 built-for-sale; Dec-24 = 62,957 units) but the
**DB froze at 2024-12** with an explicit "use the Excel tables" notice; MLIT property price index
is xlsx-only with changing file IDs; no SA in the DB. Serving frozen data as current is
misleading — no Housing tab until an MLIT Excel collector follow-up (paths recorded).

### Credit
**PROXY — BoJ Time-Series API (✅ verified working, no auth)**: `stat-search.boj.or.jp/api/v1/`
(`getDataCode?db=MD13&code=FAAP@01…`; the site's apostrophe codes split into db+code params —
no %27 needed). Verified: FAAP@01 loans & discounts outstanding (major+regional+shinkin,
**¥100M unit**, May-26 = ¥670.4T), FAAPOBAL1@ YoY +6.2%, deposits FAAPOBRDCD5; 250-series/60k-pt
request limits; **BoJ attribution line required in the UI**. Small BoJ collector (Phase 2).
Rates-side TONA ingestion untouched.

### Industrial (IIP, METI ✅; monthly SA 2020=100; **2018-01→ only** in the current-base tables; lang=J)

| US element | Class | Japan equivalent | Notes |
|---|---|---|---|
| INDPRO | DIRECT | ✅ 0004052177 production (cdCat01=0001000 mining & mfg; Mar-26 = 102.0) | **Pseudo-time codes**: 0500100=2018-01, +200/month; exclude weight row 0100100 |
| Shipments / inventories / ratio | DIRECT | ✅ 0004052178 / 0004052179 / 0004052180 (Mar-26: 99.7 / 96.3 / 102.5) | Industry classes: 0002000 manufacturing + 155 classes enumerable |
| Pre-2018 history | UNVERIFIED | Retired 2010-base tables (frozen 2021) or METI files — linking deferred | 2018→ caption on panels |

### Fiscal
**GAP (decision b)**: verified — MoF publishes nothing via the e-Stat API (receipts & payments,
tax revenues, JGB outstanding are all mof.go.jp HTML/Excel). Omit the Fiscal category for Japan;
the MoF Excel scraper is a possible future follow-up, not forced now.

---

## 1c. Proposed Japan Page Structure (country key `jp`, accent suggestion `#e879f9` pink)

| Hub | Japan sections | vs US |
|---|---|---|
| **Inflation** | CPI (divisions/aggregates/distribution/SA overlay + core-nomenclature captions) · CPI PROJECTIONS (NSA method) · **TOKYO ADVANCE** (13A01: all-items/core/core-core + Tokyo-vs-national gap) · OTHER (goods/services, energy & fresh food, rent components) | No PCE, PPI pending decision (h) |
| **Growth** | GDP (real/nominal SA + **published contributions**) · CONSUMPTION (FIES + labeled CPI-deflated real) · TRADE (customs CSV) | Retail deferred; GDI folded; Consumer Health omitted |
| **Labor** | LFS (u-rate NSA+SA overlay, participation, levels, by-age) · JOB OFFERS (ratio + new offers) · WAGES (mfg contractual earnings + regular-employment YoY; full MLS deferred) · PROJECTION | No claims tab |
| **Industrial** | IIP (production/shipments/inventories/ratio explorer + rates; 2018→ caption) | |
| **Credit** | BANK LENDING (BoJ: loans outstanding + YoY + deposits; attribution line) | |
| **Housing** | **omitted** (decision d) | |
| **Fiscal** | **omitted** (decision b) | |

### Ingestion assessment (Phase 2 preview)
- **New generic e-Stat collector** (`fetchAllEstatSeries.ts`): config entries carry statsDataId +
  filter params + expected class titles; startup getMetaInfo health check resolves/verifies codes
  by title match (fails loudly); `lang=J` default; imports `decodeTimeCode` from the untouched
  rates-side collector (verified to handle both monthly and SNA quarterly codes); IIP needs a
  dedicated pseudo-time decoder + weight-row filter.
- **Two small collectors**: customs trade CSV (d41ma.csv — cp932, browser UA, zero-filter);
  BoJ TSDS API (MD13 lending/deposits).
- Frontend: shared components apply; no FiscalYearOverlay use (Fiscal omitted).

### PROXY caveat text (feeds `jpProxyCaveats.ts`)
- `core_nomenclature` — US: core CPI = ex food & energy. JP: "core" = ex fresh food ONLY (energy
  included; the BoJ's reference); "core-core" = ex fresh food & energy is the US-core analog.
  Caveat: energy swings move Japan's "core" — do not read it as US core.
- `tokyo_advance` — US: (no analog; earliest national print). JP: Ku-area-of-Tokyo CPI publishes
  ~3–4 weeks before the national index and is the market-moving release. Caveat: Tokyo only
  (~7% of national weights); national can diverge.
- `fies_consumption` — US: monthly PCE (economy-wide, deflated by BEA). JP: FIES household survey
  spending per two-or-more-person household, nominal yen. Caveat: survey of ~9k households, NSA,
  volatile; "real" line shown is CPI-deflated by the terminal, not the official real series.
- `lfs_payrolls_jp` — US: Nonfarm Payrolls (establishment survey). JP: LFS employed persons
  (household survey level) + MLS-derived regular-employment YoY. Caveat: no establishment jobs
  count is API-available; household survey includes self-employed.
- `job_offers` — US: JOLTS openings/hires/quits. JP: active job-offers-to-applicants ratio (SA).
  Caveat: ratio of Hello-Work postings to applicants — excludes new graduates and much white-
  collar hiring; no hires/quits flows exist.
- `mfg_earnings` — US: Average Hourly Earnings, all private. JP: contractual cash earnings index,
  manufacturing only (2020=100). Caveat: manufacturing subset; excludes overtime & bonuses —
  summer/winter bonus months (Jun–Jul, Dec) dominate TOTAL earnings and are absent here; full
  Monthly Labour Survey wages are file-only and deferred.
- `boj_lending` — US: Fed H.8 bank credit by category/cohort. JP: BoJ loans & discounts
  outstanding, major+regional+shinkin banks. Caveat: aggregate lending stock only, no borrower-
  category split at this granularity; data provided via the BoJ API (not guaranteed by the BoJ).
- `trade_customs` — US: BOP-basis goods+services trade. JP: customs-clearance goods totals, NSA,
  ¥thousand. Caveat: customs basis ≠ BOP basis; services excluded; strong seasonality (NSA).
- `unemployment_nsa` — US: SA unemployment rate. JP: LFS detail rates are NSA on the API; the SA
  headline comes from the Cabinet Office composite-indicator table. Caveat: NSA panels carry
  seasonal patterns; compare Decembers with Decembers.

---

## Summary & gate decisions

**Counts (panel-concept level):** ~33 DIRECT · 9 PROXY · 15 GAP/defer (PCE ×2, Fiscal category,
Housing category, Retail current, full MLS wages, weekly claims, productivity v1, Consumer
Health, property prices, consumption activity indices, real-FIES official series, SA LFS table,
pre-2018 IIP, sentiment). **~45 series/table-code combinations verified live**; all UNVERIFIED
items carry the concrete next verification step.

**Decisions needing input:**
- **(a) Tokyo CPI advance — recommend INCLUDE** as its own Inflation tab: it is the leading
  print, and it costs nothing (same table, cdArea=13A01, verified one month ahead).
- **(b) Fiscal — recommend GAP/omit** (MoF is HTML/Excel only; verified). No forced scraper.
- **(c) Payrolls — recommend** LFS employed persons + regular-employment YoY (3020) as a
  two-badge pair (Canada precedent), explicitly labeled household-survey vs MLS-derived.
- **(d) Housing — recommend DEFER the category**: starts DB frozen Dec-2024 with an official
  "use the Excel tables" notice; property prices xlsx-only. MLIT Excel collector is the follow-up.
- **(e) Wages — recommend** shipping the WAGES tab with the two API-native series (mfg
  contractual earnings + regular employment) with strong caveats incl. the bonus-month
  distortion, and deferring the full MLS file pipeline (paths recorded).
- **(f) estatCollector.ts — recommend EXTEND-BY-SIBLING**: new generic module, same
  `estat_observations` table, skips the 4 rates-side codes, imports `decodeTimeCode`; rates-side
  pipeline untouched.
- **(g) CPI contribution panel — conditional pre-approval requested** (Canada-(f) style): verify
  the CPI weights table with one getMetaInfo in Phase 2; build the contribution panel if weights
  verify, otherwise omit it (no re-gate).
- **(h) PPI/CGPI — conditional pre-approval requested**: one BoJ-API verification of the CGPI
  (`PR01` family) in Phase 2; add an Inflation CGPI tab if it verifies, otherwise omit.
- **(i) Retail — confirm DEFER** (e-Stat DB 17 months stale; file-only current data).

---

## Phase 2 Addendum (2026-07-08) — Ingestion Complete

### Conditional pre-approval outcomes
- **(h) BoJ CGPI/PPI — VERIFIED, BUILT.** `PR01/PRCG20_2200000000` = "[Producer Price Index]
  All commodities" (BoJ renamed CGPI→PPI in 2022), CY2020=100, monthly, 797 obs (1960→),
  May-26 = 134.5. Ingested as `JP_PPI` → the Inflation PPI tab builds in Phase 3.
- **(g) CPI weights — FAILED, PANEL OMITTED.** No weights classes exist in 0003427113 (grepped
  EN + JP) and no 2020-base weights table is on the API (searched) — the 中分類ウエイト
  publication is Excel-only. The CPI contribution panel is omitted per the pre-approval terms;
  distribution/rates/explorer panels are unaffected.

### What was built
- **`server/src/fetchAllEstatSeries.ts`** — generic e-Stat collector, 103 series:
  CPI ×57 (10 divisions, 14 special aggregates, 5 SA, 31 distribution items — national headline
  trio stays rates-side) + Tokyo advance ×3 (cdArea=13A01) + LFS ×8 + business-conditions
  indicators ×5 + SNA GDP ×26 (real/nominal levels, published QoQ/annualized/contributions,
  deflator) + FIES ×1 + IIP ×5. Per-table `lang` config ('J' for SNA/IIP/FIES); startup
  getMetaInfo health check verifies table title + every class label and THROWS on mismatch,
  distinguishing "alive under lang=J but configured lang=E" from actually-dead; frozen-feed
  staleness warnings per series (thresholds account for quarter-start dating + publication lag);
  IIP pseudo-time decoder (0500100=2018-01, +200/month, weight row excluded); ~2 req/s throttle;
  appId from env, never logged. Backfill = full refetch (e-Stat returns full history per call;
  48,096 rows).
- **`server/src/bojTsCollector.ts`** — BoJ Time-Series API (no auth): JP_PPI, JP_LOANS
  (MD13/FAAP@01, ¥100M), JP_LOANS_YOY, JP_DEPOSITS. Name-match check per fetch (code-drift
  defense). UI attribution line required on consuming panels (in `boj_lending` caveat).
- **`server/src/jpTradeCsv.ts`** — Customs d41ma.csv: Shift-JIS decode, browser UA, combined
  `YYYY/MM` date column, zero-filled future months dropped. JP_TRADE_EXP/IMP/BAL, 569 obs each
  (1979-01→2026-05), stored in estat_observations with source='Customs'.
- **Routes** `/api/estat?code=` + `/api/boj-ts?code=` (registered in index.ts with startup
  syncs + 06:00 cron); `bojts_observations` table + helpers in db.ts;
  `storeEstatObservations` gained an optional `source` param (default 'eStat' — backward
  compatible). **`git diff` confirms zero modifications to `collectors/estatCollector.ts`**
  (decision f honored).
- **`client/src/data/jpProxyCaveats.ts`** — 10 entries (the 9 mapped + `regemp_mls` split from
  the payrolls pair so SEPH-style dual badges work per decision c).

### Verification (`server/src/scripts/verifyJpIngest.ts`)
**110 series checked, 0 missing.** Spot-checks match published values exactly:
CPI all-items May-26 = 113.5 (rates-side); Tokyo advance Jun-26 = 112.7 (confirmed one month
ahead of national); SA unemployment May-26 = 2.46%; real GDP 2026Q1 = ¥593,218.8bn annualized,
QoQ-annualized +1.8%; job-offers ratio 1.17; employed 6,890万; FIES ¥320,345; IIP 102.0;
PPI 134.5; exports ¥9.499T. Health check caught one real config error during bring-up
(LFS cat02 labels are bare characteristics — "Labour force"/"Employment" — the rate meaning
comes from tab=02), fixed and documented in the config comments.

### Deferred (with recorded access paths)
- **Housing category (d)**: starts DB frozen 2024-12 (0003114496, codes recorded) + MLIT
  property-price xlsx (changing file IDs) → MLIT Excel collector follow-up.
- **Full MLS wages (e)**: e-Stat file section toukei=00450071 tstat=000001011791
  tclass1=000001035519 (長期時系列 CSVs, updated 2026-06-24) → file-download pipeline follow-up.
- **Retail (i)**: e-Stat DB frozen Jan-2025; current data via e-Stat files
  (tstat=000001081875 tclass1=000001081879) or METI Excel (needs browser UA).
- **Fiscal (b)**: GAP — MoF is HTML/Excel only (verified; no e-Stat presence).
- **CPI contribution panel (g)**: weights Excel-only (above).
- Available-but-unpaneled (noted for future): 0003446462 also carries Consumer Confidence
  (1060), machinery orders (1040), new-housing floor area (1050), TOPIX, M2 YoY — one config
  line each if ever wanted.
