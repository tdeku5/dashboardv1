# Germany / France / Italy Economic Data Models — Mapping Document (Phase 1)

Produced 2026-07-08 per `docs/country-replication-playbook.md`. Combined three-country job on the
shared ECB Data Portal + Eurostat source family. Every ✅ was verified LIVE today (exact
dataflow/dataset + key, latest value fetched per country); `UNVERIFIED` = named but not
confirmed — do not ingest. Both APIs are free/no-auth; throttled politely throughout.

**Format decision:** SDMX-CSV for both sources — the existing ECB collector already parses
SDMX-CSV by header name, Eurostat's SDMX 2.1 endpoint emits the same shape
(`TIME_PERIOD,OBS_VALUE,OBS_FLAG`), and multi-country keys (`.DE+FR+IT`) batch three countries
per request. JSON-stat would need a new decoder for no benefit.

**Global findings:**
1. **The job prompt's ECB `ICP` leads are obsolete** — the ICP dataflow was discontinued
   Feb-2026 (documented in `collectors/ecbCollector.ts`). The live flow is `HICP`
   (DSD ECB_ICP3, **2025=100**, DATA_PROVIDER 4D0). Country keys verified on the new flow.
2. **No country-level SA HICP exists on the ECB portal** (SA/4F0 is euro-area-only; verified
   empty for DE under every provider). Country inflation is NSA-primary → the UK
   same-month-prior-year projection precedent applies to all three.
3. **The ECB portal carries the FULL 435-item COICOP tree per country** (12 divisions
   `010000`–`120000`, special aggregates FOOD00/FOODUN/NRGY00/SERV00/GOODS0/IGXE00/
   XEF000/XEFUN0, durability splits, deep sub-items, with titles) — the entire Inflation
   category is a **config-only extension of the existing ECB collector**.
4. **Eurostat publishes GDP growth AND contributions directly** (`CLV_PCH_PRE`/`_SM`/`_ANN` +
   `CON_PPCH_PRE`/`_SM`) — trio GDP pages get published-contribution charts, no client math
   (Canada/Japan precedent).
5. **HICP item weights ARE on Eurostat** (`prc_hicp_inw`, annual per-mille, sums to 1000.0,
   1996→) — CPI contribution panels are feasible for the trio (unlike Japan). Latest weights
   year 2025 (2026 not yet published — forward-fill convention applies).
6. **Flags matter here**: Eurostat carries `b` (break), `p` (provisional), `e` (estimate),
   `d` (definition differs), `u` (low reliability). Verified breaks: DE unemployment 2009-01,
   FR 2003-01 + 2024-01, IT 2004-01; DE LCI 2022-Q1; FR JVS `d` on every obs. The collector
   must store OBS_FLAG and the UI must surface break markers (Phase 3 requirement).
7. **Per-country asymmetries verified** (the DE/FR/IT columns are not interchangeable):
   history starts differ everywhere (GDP: FR 1980 / DE 1991 / IT 1996); s_adj codes differ
   (FR national-accounts employment is SA where DE/IT are SCA; IT fiscal is NSA-only);
   Italy lags one month on IP/construction and one quarter on permits; Italy publishes
   vacancy RATES only.

---

## 1a. US Model Inventory — reused
`docs/uk-models-mapping.md` §1a; zero US panel drift since the Japan run (verified via git log).

### Existing ECB collector (config-first confirmation)
`server/src/collectors/ecbCollector.ts` — 7 euro-area series (HICP headline/core/supercore
NSA + SA + UNRATE_EA) → `ecb_observations`, feeding the EU rates fundamental model.
**Plan: additive config extension only** — country series appended to the same config array,
zero changes to the EA series or the module's fetch/parse logic (already generic). The Eurostat
collector is NEW (`fetchAllEurostatSeries.ts`, same config-array + health-check pattern; the
health check hits each dataset's SDMX metadata and fails loudly on dimension-code mismatch).

---

## 1b. US → Trio Mapping (DE / FR / IT columns)

Notation: ✅=verified live · P=PROXY · G=GAP. ECB keys are `{flow}/{key}`; Eurostat keys are
`{dataset}/{key}` in the dataset's dimension order.

### Inflation — HICP (ECB `HICP` flow, monthly NSA, 2025=100; source: config-only ECB extension)

| Concept | DE | FR | IT | Key pattern |
|---|---|---|---|---|
| Headline index | ✅ 102.54 May-26 | ✅ 102.71 | ✅ 103.60 | `HICP/M.{cc}.N.000000.4D0.INX` |
| Core (ex energy, food, alc & tob — US-core analog) | ✅ | ✅ | ✅ | item `XEF000` |
| Ex energy & unprocessed food (ECB "core") | ✅ | ✅ | ✅ | item `XEFUN0` |
| 12 COICOP divisions | ✅ | ✅ | ✅ | items `010000`…`120000` |
| Special aggregates (energy, food, unproc. food, services, goods, NEIG, durability) | ✅ | ✅ | ✅ | NRGY00/FOOD00/FOODUN/SERV00/GOODS0/IGXE00/IGXEDU/IGXEND/IGXESD |
| Distribution sub-items (~30 curated from 435) | ✅ tree confirmed | ✅ | ✅ | 4–6 digit COICOP; exact set resolved in Phase 2 config |
| SA variants | G — no country SA on the portal | G | G | NSA-primary; UK projection precedent |
| Weights (contribution panels) | ✅ 2025: CP01 130.88‰ | ✅ 147.16‰ | ✅ 181.43‰ | Eurostat `prc_hicp_inw/A.CP{01..12}.{geo}` (annual, forward-fill) |
| National CPI (VPI/IPC/NIC) | not needed | not needed | not needed | Decision (a): HICP-primary |
| PCE / PPI | G (PPI exists as `sts_inpp_m` — UNVERIFIED, out of proposed scope v1) | G | G | |

### Growth — GDP (Eurostat `namq_10_gdp`, quarterly; s_adj=SCA all three)

| Concept | DE | FR | IT | Key pattern |
|---|---|---|---|---|
| Real GDP + 5 components (P31_S14_S15, P51G, P3_S13, P6, P7) | ✅ 1991Q1→, 2026Q1 GDP €907.9bn/q (`p` since 2022) | ✅ 1980Q1→, €665.0bn | ✅ 1996Q1→, €490.5bn | `Q.CLV20_MEUR.SCA.{item}.{geo}` |
| Published QoQ / YoY | ✅ +0.3 | ✅ −0.1 | ✅ +0.3 | units `CLV_PCH_PRE` / `CLV_PCH_SM` (+`CLV_PCH_ANN`) |
| **Published contributions** | ✅ | ✅ | ✅ | units `CON_PPCH_PRE` / `CON_PPCH_SM` |
| Nominal GDP | ✅ €1,142.2bn | ✅ €757.3bn | ✅ €573.3bn | `Q.CP_MEUR.SCA.B1GQ.{geo}` |
| Deflator | ✅ 125.8 | ✅ 113.9 | ✅ 116.9 | `Q.PD20_EUR.SCA.B1GQ.{geo}` |
| Compensation of employees (D1) | ✅ SA | ✅ SA | ✅ **SCA** | `Q.CP_MEUR.{SA|SCA}.D1.{geo}` — s_adj per country |
| Monthly GDP | G | G | G | no concept |

### Growth — Retail / Trade / Sentiment / Household

| Concept | DE | FR | IT | Key pattern |
|---|---|---|---|---|
| Retail volume (`sts_trtu_m`, SCA, 2021=100) | ✅ 1994→, 101.5 May-26 (`p`) | ✅ 1999→, 107.9 (`e`) | ✅ 2000→, 98.0 | `M.VOL_SLS.G47.SCA.I21.{geo}` (+`G47_X_G473` ex fuel) |
| Goods trade monthly (`ei_eteu27_2020_m`, SA, €M, 2002→) | ✅ bal +13,607 Apr-26 | ✅ −6,786 | ✅ +4,741 | `M.{BAL_RT|EXP|IMP}.MIO-EUR-SA.WORLD.ET-T.{geo}` |
| Consumer confidence (`ei_bsco_m`, SA, 1985→) | ✅ −14.6 Jun-26 | ✅ −19.3 | ✅ −22.2 | `M.BS-CSMCI.SA.BAL.{geo}` |
| ESI + industry confidence (`ei_bssi_m_r2`, SA, 1980/85→) | ✅ 91.5 / −13.5 | ✅ 92.5 / −7.8 | ✅ 99.1 / −6.4 | `M.BS-ESI-I.SA.{geo}` / `M.BS-ICI-BAL.SA.{geo}` |
| Household saving rate (`nasq_10_ki`, SCA, quarterly) | ✅ 19.14 26Q1 | ✅ 17.52 25Q4 (lags 1Q) | ✅ 10.82 | `Q.PC.SCA.SRG_S14_S15.S14_S15.{geo}` |

### Labor (u-rates via ECB `LFSI`; detail via Eurostat)

| Concept | DE | FR | IT | Key pattern |
|---|---|---|---|---|
| Unemployment rate (SA, monthly) | ✅ 3.8 May-26 | ✅ 8.2 | ✅ 5.0 | ECB `LFSI/M.{cc}.S.UNEHRT.TOTAL0.15_74.T` |
| Youth u-rate + levels (`une_rt_m`, SA) | ✅ 7.0 / 1,656k (1991→, b@2009) | ✅ 21.3 / 2,642k (1983→, b@2003+2024) | ✅ 15.1 / 1,278k (1983→, b@2004) | `M.SA.Y_LT25.PC_ACT.T.{geo}` / `M.SA.TOTAL.THS_PER.T.{geo}` |
| **Payrolls proxy — employees, national accounts** (`namq_10_a10_e` SAL_DC) | P ✅ 42,220k SCA (1991→) | P ✅ 27,083k **SA** (1980→) | P ✅ 20,728k SCA (1995→) | `Q.THS_PER.TOTAL.{s_adj}.SAL_DC.{geo}` — recommended over lfsi_emp_q (longer history, no LFS breaks) |
| Total employment + hours | ✅ EMP_DC 45,859k; hours ✅ | ✅ (SA persons; SCA hours) | ✅ | same dataset, `EMP_DC` / unit `THS_HW` |
| Job vacancy rate (`jvs_q_nace2`, B-S) | P ✅ 2.6 SA (2006→; levels too) | P ✅ 2.3 (2011Q2→, **`d` on every obs**) | P ✅ 1.9 (2016→, **rate only** — levels G) | `Q.{NSA|SA}.B-S.TOTAL.JVR.{geo}` |
| Wage growth — Labour Cost Index (`lc_lci_r2_q`) | P ✅ 122.9 + published YoY 3.0% (1996→, b@2022) | P ✅ 116.8 / 1.8% (2008→) | P ✅ 111.6 / 2.9% (2000→) | `Q.SCA.I20.B-S.D1_D4_MD5.{geo}` + `Q.CA.PCH_SM…` |
| Weekly claims / JOLTS flows / U-3 projection | G | G | G | no concepts; projection omitted (decision i) |

### Industrial (Eurostat `sts_inpr_m` / `sts_copr_m`, SCA, 2021=100)

| Concept | DE | FR | IT | Key pattern |
|---|---|---|---|---|
| IP headline (B-D) + manufacturing (C) | ✅ 91.8/92.6 May-26 (1991→) | ✅ 103.7/104.6 (1990→) | ✅ 94.9/95.0 **Apr-26 — lags 1 mo** (1990→) | `M.PRD.{nace}.SCA.I21.{geo}` |
| MIGs (intermediate/capital/consumer) | ✅ | ✅ (COG flag `i`) | ✅ | `MIG_ING`/`MIG_CAG`/`MIG_COG` |
| Construction (`sts_copr_m`) | ✅ 92.7 (1991→) | ✅ 90.6 (1990→) | ✅ 142.8 Apr-26 (1995→; superbonus-era level is real) | `M.PRD.F.SCA.I21.{geo}` |
| Factory orders (durable-goods analog) | **G on Eurostat** (confirmed: new-orders datasets discontinued 2012, none disseminated). Destatis GENESIS national fallback exists (registration) | G (no concept) | G | Decision (f) |

### Housing (quarterly; thin by design)

| Concept | DE | FR | IT | Key pattern |
|---|---|---|---|---|
| House price index (`prc_hpi_q`, NSA) | ✅ 153.4 26Q1 +1.4% YoY (2005→) | ✅ 126.7 +0.1% (2005→) | ✅ 119.2 +5.2% (**2010→**) | `Q.TOTAL.I15_Q.{geo}` + published YoY `RCH_A` |
| Building permits — dwellings (`sts_cobp_q`, index only) | ✅ 61.1 26Q1 (1994→, **24 obs `e`-flagged**) | ✅ 79.2 (1994→) | ✅ 98.4 **25Q4 — lags 1Q** (2000→) | `Q.BPRM_DW.CPA_F41001_X_410014.{NSA|SCA}.I21.{geo}` — note the `_X_410014` cpa gotcha; no absolute counts exist |
| Transactions / inventory / DSR | G | G | G | |

### Fiscal (Eurostat quarterly government finance — restructure, not GAP)

| Concept | DE | FR | IT | Key pattern |
|---|---|---|---|---|
| Net lending B9 + revenue TR + expenditure TE (`gov_10q_ggnfa`, S13) | ✅ NSA+SCA (2002→); B9 −4.4% GDP 25Q4 | ✅ NSA+SA+SCA (1995→); −2.1% | ✅ **NSA ONLY** (1999→); +1.4% (Q4 seasonal) | `Q.{MIO_EUR|PC_GDP}.NSA.S13.{item}.{geo}` — NSA is the only common denominator; trailing-4Q sums at view layer |
| Maastricht debt (`gov_10q_ggdebt`, 2000→) | ✅ 63.5% GDP | ✅ 116.2% | ✅ 137.1% | `Q.GD.S13.{MIO_EUR|PC_GDP}.{geo}` — dim order differs from ggnfa (unit after sector) |
| Daily/monthly cash flows (DTS/MTS analog) | G | G | G | quarterly accrual ESA only |

### Credit
Country-level MFI bank lending exists on the ECB portal (`BSI` dataflow) but is **UNVERIFIED** —
surfaced as conditional decision (h) rather than guessed.

---

## 1c. Proposed Page Structure — one shared shape, per-country config

The trio bet holds: **all three countries share one tab structure**; the only divergences are
caption/caveat-level (flags, history starts, IT lags), not page-shape-level. Fiscal builds for
all three (no per-country GAP). Suggested accents: DE `#a3e635` lime · FR `#60a5fa` blue ·
IT `#34d399` emerald.

| Hub | Trio sections (identical for de/fr/it) | Notes |
|---|---|---|
| **Inflation** | HICP (contribution via weights, divisions, aggregates, distribution, explorer, EA reference overlay per decision g) · HICP PROJECTIONS (NSA method + caption) · OTHER (goods/services, energy & food, durability) | config-only ECB extension + weights |
| **Growth** | GDP (published contributions) · RETAIL · TRADE · SENTIMENT (ESI + consumer/industry confidence + saving rate, per decision e) | |
| **Labor** | UNEMPLOYMENT (SA headline + youth + levels, break markers) · EMPLOYMENT (payrolls-proxy pair: employees SAL_DC + total EMP_DC + hours) · VACANCIES · LABOUR COSTS (LCI + published YoY) | no claims/projection |
| **Industrial** | IP (headline/mfg/MIGs) · CONSTRUCTION | factory orders per decision (f) |
| **Housing** | PRICES (HPI + published YoY) · PERMITS (index form, flags surfaced) | thin by design |
| **Fiscal** | BALANCE (B9/TR/TE, %GDP + trailing-4Q view) · DEBT | quarterly-only caption; IT NSA caveat |
| **Credit** | pending decision (h) | |

### PROXY caveat registry (country-keyed with shared text — no triplication)
Structure: `eu3ProxyCaveats.ts` exporting shared entries plus a thin per-country override map
(the existing `ProxyCaveat` type unchanged). Shared: `employment_proxy` (national-accounts
employees vs NFP; quarterly not monthly; domestic concept includes cross-border workers),
`lci_wages` (quarterly labour-cost index vs monthly AHE; includes taxes-minus-subsidies),
`fiscal_quarterly` (accrual ESA quarterly vs US daily/monthly cash; strong seasonality),
`permits_index` (index form only, no absolute counts), `sentiment_survey` (DG-ECFIN harmonized
panels differ from ifo/ZEW/INSEE/ISTAT national surveys), `hicp_projection_nsa`. Per-country
overrides: `vacancies` (FR: 10+-employee coverage + `d`-flag on all obs, 2011→; IT: rate only,
2016→; DE: clean + levels), `employment_proxy` s_adj note (FR SA vs DE/IT SCA), `unemployment
breaks` (country-specific break dates), DE `permits_e_flags`.

---

## Summary & gate decisions

**Counts (panel-concept level):** DE ✅37 DIRECT / 4 PROXY / 11 GAP · FR ✅36 / 4 / 12 ·
IT ✅35 / 4 / 13 (GAP lists share: PCE ×2, PPI v1, monthly GDP, weekly claims, JOLTS flows,
projection, daily fiscal, housing transactions/DSR, factory orders (FR/IT no concept), IT
vacancy levels, SA HICP). ~120 series/key/country combinations verified live; zero fabrications.

**Decisions:**
- **(a) HICP-primary — CONFIRM.** Full COICOP tree + weights available; national CPIs add no
  needed concept and would triple sources.
- **(b) Fiscal — quarterly RESTRUCTURE for all three** (verified; no GAP country). IT NSA-only
  caveat + trailing-4Q view; quarterly-cadence caption.
- **(c) Housing — PRICES + PERMITS for all three**; index-form permits with flags surfaced;
  no DEMAND/transactions anywhere.
- **(d) Payrolls proxy — `namq_10_a10_e` employees (SAL_DC)** as the NFP analog (longer
  history, no LFS breaks), with total employment + hours alongside; per-country s_adj in
  config (FR=SA, DE/IT=SCA). `lfsi_emp_q` not used.
- **(e) Sentiment — INCLUDE** the harmonized DG-ECFIN family (ESI/consumer/industry, 1980s→,
  verified) as a Growth SENTIMENT tab — the free alternative to ifo/ZEW; caveat in registry.
- **(f) German factory orders — recommend OMIT.** Confirmed extinct on Eurostat; the only
  source is Destatis GENESIS (registration + a fourth integration for one panel — against the
  shared-source bet). Documented as a future follow-up.
- **(g) EA aggregate overlays — recommend YES, zero cost:** the euro-area HICP series already
  in `ecb_observations` (rates-side) render as reference lines on the country HICP trio panels.
  No new ingestion; read-only reuse.
- **(h) Credit — conditional pre-approval requested** (Japan-(h) style): verify ECB `BSI`
  country MFI-lending keys in Phase 2; build a thin BANK LENDING tab if they verify, else omit.
- **(i) Labor projection tab — recommend OMIT for the trio** (employment/labour-force inputs
  are quarterly; a monthly mechanical projection would be under-determined vs the UK/CA/JP
  versions). Surface-level decision, cheap to add later if wanted.

---

## Phase 2 Addendum (2026-07-08) — Ingestion Complete

### Conditional (h) outcome — BSI VERIFIED, thin Credit BUILDS
First Phase 2 step: `BSI/M.{cc}.N.A.A20.A.1.U2.{2250|2240}.Z01.E` (loans outstanding to
households / NFCs, €M) + `…A.I….Z01.A` (published annual growth) verified live for all three
(DE HH €2,110bn May-26, +2.18% YoY). Ingested as `{CC}_LOANS_HH/NFC` + `_YOY` — 12 series.

### What was built
- **ECB collector extension (config-only, additive)**: +168 country series appended to the
  existing `SERIES` array — per country: 51 HICP items (headline + XEF000/XEFUN0 + 12 COICOP
  divisions + 9 special aggregates + 27 distribution sub-items; e-COICOP 2 has no tobacco
  item), UNRATE, 4 BSI lending. `git diff` proof: 61 insertions / 3 modified lines (type-union
  widening `'mio_eur'`, two comments) — **the seven euro-area rates-model entries are
  byte-identical and their rows untouched**. A 150ms polite throttle was added to the fetch
  loops (config went 7 → 175 series). Base check for decision (g): rates-side EA HICP rows are
  on the same 2025=100 base as the new country rows (103.07 Jun-26) — level overlays safe.
- **`server/src/fetchAllEurostatSeries.ts`** — NEW generic Eurostat collector: 64 geo-batched
  defs = 192 series (GDP + published growth/contributions ×3, fiscal ggnfa NSA + ggdebt,
  labour detail + payrolls proxy with per-country `keyByGeo` s_adj overrides (FR=SA), LCI +
  published YoY, IP + MIGs, construction, retail, trade, sentiment, saving rate, HPI +
  published YoY, permits SCA+NSA, 12 HICP division weights). SDMX-CSV, `DE+FR+IT` multi-geo
  keys (3 countries per request), ~2 req/s. **Health check**: per dataset, asserts the live
  JSON-stat dimension-id ORDER against config (`gov_10q_ggdebt` really does order unit after
  sector — the assertion guards against silent reorders that would misassign every code) +
  title match; throws loudly. **OBS_FLAG captured to schema** (`eurostat_observations` table).
  Frozen-feed staleness warnings per series (weights threshold set for annual Jan-1 stamping).
- Routes `/api/eurostat?code=` (serves obs_flag per row); `/api/ecb` reused for country ECB
  series. Startup + 06:00 cron wiring. `client/src/data/eu3ProxyCaveats.ts`: 8 shared caveats
  stored once + 7 per-country overrides via `eu3Caveat(key, cc)`.

### Verification (`server/src/scripts/verifyEu3Ingest.ts`)
**360 series (168 ECB + 192 Eurostat), 0 missing/mismatched.** Spot-checks match Phase 1
published values exactly: HICP May-26 DE 102.54 / FR 102.71 / IT 103.60 (June prints since
arrived: 102.32/102.38/103.70); u-rates 3.8/8.2/5.0; real GDP 2026Q1 €907,884.4M/€665,033.7M/
€490,496.4M; debt 63.5/116.2/137.1 %GDP; trade balances +13.6/−6.8/+4.7 €bn; ESI 91.5/92.5/
99.1; HPI 153.4/126.67/119.2. History floors confirmed per country (FR GDP 185 quarters from
1980 vs IT 121 from 1996). **Flag inventory stored and queryable**: `b` breaks (DE 7 / FR 4 /
IT 2 obs), DE permits `e` ×24, DE fiscal/GDP `p` ×1,292, FR JVS `d` ×62 — the Phase 3
break-marker surfacing has real data behind it.

### Deferred (recorded)
German factory orders (decision f — Destatis GENESIS, registration-gated); national CPIs
(decision a — not needed); labor projection tabs (decision i); PPI `sts_inpp_m` (v1 scope);
2026 HICP weights (not yet published — forward-fill 2025); IT vacancy levels (not published).
