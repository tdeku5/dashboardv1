# Australia Economic Data Models — Mapping Document (Phase 1)

Produced 2026-07-08 per `docs/country-replication-playbook.md`. The eighth and final country.
Every ✅ was verified LIVE today against the ABS Data API (DSD dimension order + codelist
labels + a sanity fetch per anchor); `UNVERIFIED` = named but not confirmed — do not ingest.
No auth; throttled politely.

**Config-first head start:** `server/src/collectors/absCollector.ts` (rates-side AUD model)
already resolved the hardest discovery task empirically and documents it: the complete Monthly
CPI lives in **`CPI` v2.0.0, FREQ=M, ~2023-24=100 base, from 2024-04** (the guide-era `CPI_M`
flow is the DISCONTINUED indicator — confirmed still listed, ignore); quarterly headline in the
same flow from 1948; the RBA-reference quarterly trimmed mean / weighted median in **`CPI_Q`**
(2011-12=100, 1982Q1→, TSEST=20 only). It also established: **ABS rejects the literal `latest`
version — omit the version from data URLs entirely** (a correction to the job prompt); key
orders CPI `MEASURE.INDEX.TSEST.REGION.FREQ` / LF `MEASURE.SEX.AGE.TSEST.REGION.FREQ`; the
`NoRecordsFound` empty convention; and the DSD-codelist-label health-check pattern. The
rates-side module owns 8 codes (AU_CPI_M_HEADLINE/TRIMMED/WGTMED, AU_CPI_Q_HEADLINE/TRIMMED/
WGTMED, AU_UNRATE_SA/TREND) in `au_macro_series` — the econ collector extends by sibling
(Japan precedent), same table, skipping those codes.

**Global findings:**
1. **The dual-frequency CPI availability matrix** (the page-design driver): the MONTHLY slice
   is the superset — 158 original series (11 groups + sub-items + ALL special aggregates) +
   105 SA series (incl. monthly trimmed mean/weighted median, rebased 2024-04=100) — but only
   from 2024-04 (YoY from 2025-04). The QUARTERLY slice carries groups + sub-items (original
   only, long history) in `CPI`, and SA + trimmed/median in `CPI_Q` — **quarterly special
   aggregates (tradables, goods/services, ex-volatile, discretionary) exist in NO flow**;
   those panels are monthly-only by necessity.
2. **Three major discontinuations verified honestly**: Retail Trade (`RT` final data 2025-06 —
   13 months stale; the Monthly Household Spending Indicator `HSI_M` is the live replacement,
   2012-07→), **Weekly Payroll Jobs (final release Jul-2025; its MEEI replacement is
   spreadsheet-only, not on the API)**, and the RPPI (frozen 2021-Q4; Total Value of Dwellings
   `RES_DWELL_ST` is the live quarterly price read, 2011-Q3→).
3. **GFS is a full GAP on the ABS Data API** (1,223 dataflows grepped — no government-finance
   flow exists). No Fiscal category → **the FiscalYearOverlay Jul–Jun parameterization never
   triggers** — the job's flagged shared-component hot spot evaporates.
4. **Published GDP contributions exist** (measure `TCH`, ppt, verified summing to the QoQ
   print) — the Canada/Japan/EU3 no-client-math precedent holds. Published QoQ exists (M2);
   **no through-the-year measure — YoY computed at view layer**.
5. Quirks for the collector: ITGS **imports and the goods balance are stored negative**;
   JV's 2008–09 suspension appears as null-value rows with OBS_STATUS `q` (parser must
   tolerate); `LF_UNDER`'s DSD lives at `DS_LF_UNDER` while data URLs use `LF_UNDER`; building
   approvals are **NSA-only** despite the codelist advertising SA/Trend; TVD carries
   `p`/`r` (preliminary/revised) flags.
6. **ABS explicitly recommends trend over SA** for LF headline rates (±0.2pp SA standard
   error); both verified for every LF measure.

---

## 1a. US Model Inventory — reused
`docs/uk-models-mapping.md` §1a; zero US panel drift since the EU3 run (0 commits).

---

## 1b. US → Australia Mapping

### Inflation — CPI (flows `CPI` + `CPI_Q`; REGION=50 wtd avg 8 capitals; measures 1=index, 2=QoQ/MoM, 3=YoY published)

| Concept | Class | Series (all ✅) | Notes |
|---|---|---|---|
| Headline CPI | DIRECT | Monthly `1.10001.10.50.M` (102.09 May-26; YoY 4.0%) + quarterly `…Q` (101.7 26Q1, 1948→) — rates-side codes | Dual frequency — decision (a) |
| Core / underlying | DIRECT | **Quarterly trimmed mean (CPI_Q `1.999902.20.50.Q`, 1982Q1→, YoY 3.5%) = the RBA's stated primary reference through ~mid-2027**; weighted median alongside; monthly analogues (999902/999903, 2024-04=100, YoY 3.6%) as the timely read | Canada-boc + Japan-Tokyo framing blend |
| SA all-groups | DIRECT | Monthly INDEX **999901** TSEST=20 (106.52 May-26 — SA is its own INDEX code, not TSEST on 10001); quarterly SA in CPI_Q | Interim-SA caption on monthly |
| 11 groups | DIRECT | Both freqs (M short / Q long): 20001 Food, 20006 Alc&tob, 20002 Clothing, 20003 Housing, 20004 Furnishings, 115486 Health, 20005 Transport, 115488 Communication, 115489 Recreation, 115493 Education, 126670 Insurance&financial | M latest May-26 / Q latest 26Q1 verified per group |
| Sub-items (~14 distribution) | DIRECT | Both freqs: 30014 Rents, 97559 New dwellings, 40055 Electricity, 115524 Gas, 40081 Auto fuel, 40091 Medical svcs, 40080 Motor vehicles, 115529 Insurance, 40090 Tobacco, 114121 Fruit, 114122 Vegetables, 40101/40102 Holiday travel | Distribution panels on QUARTERLY (long history) |
| Special aggregates | DIRECT (M-only) | 102675/102676 Tradables/Non-tradables, 104101/104104 Goods/Services, 104122 ex volatile, 131197 **ex food & energy**, 999904 ex volatile & holiday travel, 132304/132305 Discretionary/Non-discretionary | Monthly-only in any flow — captioned floor |
| PPI | DIRECT | `PPI_FD` `1.TOT.TOT.TOTXE.Q` (138.2 26Q1) + published YoY `3.…` (3.0%) | Key order MEASURE.INDEX.SOURCE.DESTINATION.FREQ; history 1998-Q3→ (resolved at Phase 3 bring-up — an earlier truncated probe suggested 2005-Q2) |
| PCE deflator | GAP | — | UK/CA/JP/EU3 precedent |

### Growth (flows `ANA_AGG`/`ANA_EXP`/`ANA_INC`, `HSI_M`/`HSI_Q`, `ITGS`, `QBIS` — all quarterly SA A$M unless noted; GDP history 1959-Q3→)

| Concept | Class | Series (✅) | Notes |
|---|---|---|---|
| Real GDP + published QoQ | DIRECT | ANA_AGG `M1.GPM.20.AUS.Q` (A$695.9bn/q 26Q1) + `M2…` (+0.3%) | YoY computed at view layer (no published TTY) |
| Nominal GDP / deflator / saving ratio | DIRECT | `M3.GPM…` (736,601) / ANA_EXP `DCH.GPM.SSS…` (105.8, `PCT_DCH` +0.3%) / `M7.HSR…` (6.2) | |
| Expenditure components (real) | DIRECT | ANA_EXP `VCH.{FCE.PHS\|FCE.GGS\|GFC_DWL.PSS\|GFC_PBI.PSS\|XGS.SSS\|MGS.SSS}.20.AUS.Q` | Dwelling investment is Australia's housing-cycle GDP read |
| **Published contributions** | DIRECT | measure `TCH` (ppt; verified sums to QoQ print) — HH cons, govt, private GFCF, dwellings, public GFCF, inventories, exports, imports | Decision (f): YES |
| Compensation of employees | DIRECT | ANA_INC `C.COE.SSS.20.AUS.Q` (360,412; CSV metadata says UNIT NA but scale is A$M — collector notes it) | |
| Consumption monthly | PROXY | `HSI_M` `7.TOT.CUR.20.AUS.M` (A$80.6bn May-26, 2012-07→; published YoY measure 9 = +5.5%) + `HSI_Q` CVM real (`226,539` 26Q1, +2.8% YoY) | Retail Trade DISCONTINUED (final 2025-06) — HSI is the successor; current-prices-only monthly, volumes quarterly; pre-Dec-2018 methodology break noted in OBS_COMMENT |
| Goods trade monthly | DIRECT | `ITGS` `M1.{1000\|2000\|170}.20.AUS.M` (May-26: exp 43,614 / imp **−46,632 stored negative** / bal **−3,018**; 1971-07→, SA) | Services quarterly only (`BOP` `1.180.20.Q` = −9,038) — noted, not paneled v1 |
| Business indicators | DIRECT | `QBIS` `M7/M3/M1.CUR.TOT.TOT.20.AUS.Q` (profits 147,488 / inventories 237,260 / sales) | Proposed 4th Growth tab |
| Monthly GDP / GDI split / consumer health | GAP | — | |

### Labor (flows `LF` / `LF_UNDER` / `LF_HOURS` / `LF_AGES` / `JV` / `WPI`; LF monthly SA+trend, 1978→)

| Concept | Class | Series (✅, SA + trend verified each) | Notes |
|---|---|---|---|
| Unemployment rate | DIRECT | rates-side AU_UNRATE_SA/TREND (4.36% implied May-26) | Decision (b): trend emphasized per ABS guidance |
| Employed (total/FT/PT), unemployed, labour force, participation, emp-pop | DIRECT | LF `M3/M1/M2/M6/M9/M12/M16.3.1599.{20\|30}.AUS.M` (employed 14,738.8k; particip 66.66%) | **LF employment IS the jobs story — Payroll Jobs is DEAD** (final release Jul-2025; MEEI replacement spreadsheet-only). Decision (c). |
| Underemployment / underutilisation | DIRECT | LF_UNDER `M23/M24/M21…` (5.87% / 10.22% / 904.2k) | Australia-specific strength — own tab |
| Hours worked | DIRECT | LF_HOURS `M18.3.1599.TOT.20.AUS.M` (2,010,382k hrs; 1978-07→) | |
| Youth u-rate | DIRECT | LF_AGES `M13.3.1524.{20\|30}.AUS.M` (10.39%) | |
| JOLTS analog | PROXY | JV `M1.7.TOT.20.AUS.Q` (329.5k SA 26Q2, 1979-Q2→) | 2008–09 suspension = null rows w/ OBS_STATUS `q`; quarterly; no flows |
| Wages | DIRECT | WPI `1.THRPEB.7.TOT.20.AUS.Q` (160.4 26Q1, 1997-Q3→) + **published YoY/QoQ** (`3.…` 3.3% / `2.…` 0.8%) | Key order MEASURE.INDEX.SECTOR.INDUSTRY.TSEST.REGION.FREQ; AWE too coarse (biannual) — noted, not used |
| U-3 projection | DIRECT | Mechanical model on monthly SA u-rate + LF levels (all inputs monthly — unlike EU3) | PROJECTION tab builds |
| Weekly claims | GAP | — | |

### Housing (thin, honest)

| Concept | Class | Series (✅) | Notes |
|---|---|---|---|
| Building approvals | DIRECT* | `BA_GCCSA` `1.1.9.TOT.100.10.AUS.M` total 16,955 May-26 + private houses `…110…` 10,970 + ex-houses `…850…` (1983/1986→) | ***NSA ONLY** — SA/Trend advertised in codelists but return NoRecordsFound; panels use 12-month sums / same-month YoY with caption |
| Prices | PROXY | `RES_DWELL_ST` `5.AUS.Q` mean dwelling price **A$1,111.1k** 26Q1 (2011-Q3→, `p`/`r` flags) + `1.AUS.Q` total stock value A$12.77T | RPPI frozen 2021-Q4 (kept out); CoreLogic private = GAP. Level-not-index caveat. Decision (d). |
| Lending | DIRECT | `LEND_HOUSING` `FIN_VAL.NEWCOMMITS.DV8368.TOTDWELL.TOT.{DV5167\|DV5168}.20.AUS.Q` — owner-occupier A$61.4bn / investor A$41.5bn 26Q1 (2002-Q3→, SA) | Quarterly only (monthly discontinued) |
| Transactions / starts | GAP | — | (Dwelling starts exist in a construction flow — UNVERIFIED, deferred) |

### Fiscal — **GAP (decision e)**
Verified: no GFS dataflow among all 1,223 on the API; quarterly GFS is spreadsheet-only,
monthly Finance statements are documents. Omit the category (nav fallback). **No Jul–Jun
FiscalYearOverlay work needed.**

### Credit — **DEFER (decision g)**
Money/credit aggregates are RBA-only (statistical table D2 CSV). A defensible RBA-fallback
case, but it means a new non-API collector for one tab — recommend DEFER for v1 with the D2
path recorded; housing lending (above) covers the credit-adjacent story.

### Industrial — **omit as a category**
Australia publishes no monthly industrial production index. QBIS (profits/inventories/sales)
covers the business-cycle read as a Growth tab; `ANA_IND_GVA` (quarterly GVA by industry)
noted as available-but-unpaneled.

### Sentiment — GAP
Westpac–MI consumer and NAB business surveys are private; no ABS sentiment flow (grepped).

---

## 1c. Proposed Page Structure (country `au`, accent `#facc15` gold)

| Hub | Sections | Notes |
|---|---|---|
| **Inflation** | CPI (dual-frequency — layout below) · CPI PROJECTIONS (quarterly long-history NSA-original method + monthly-pace overlay note) · PPI · OTHER (monthly-only aggregates: tradables, goods/services, discretionary, ex-volatile, ex food & energy — floor captioned) | |
| **Growth** | GDP (published TCH contributions, components incl. dwelling investment, deflator, saving ratio) · SPENDING (HSI monthly nominal + published YoY + quarterly real) · TRADE (ITGS goods; services-quarterly note) · BUSINESS (QBIS profits/inventories/sales) | |
| **Labor** | LABOUR FORCE (u-rate trend+SA, participation, emp-pop) · EMPLOYMENT (employed FT/PT, hours) · UNDERUTILISATION (underemployment/underutilisation/youth) · VACANCIES (JV) · WAGES (WPI + real-wage vs CPI) · PROJECTION | |
| **Housing** | APPROVALS (monthly NSA, 12m-sum view) · PRICES & LENDING (TVD mean price + OO/investor lending) | |
| **Fiscal / Credit / Industrial** | **omitted** — nav fallback (no stubs) | decisions e/g + IP-nonexistence |

### The Inflation CPI page layout (decision a — the dual-frequency centerpiece)
1. **Monthly headline panel** (top): M all-groups NSA YoY + SA (999901) MoM-annualized lines,
   RBA 2–3% target band shading + 2.5% midpoint reference. Caption: "Complete Monthly CPI —
   Australia's primary headline measure since Nov-2025; index from Apr-2024, YoY from
   Apr-2025; SA uses interim methods (short history)."
2. **RBA policy-reference panel** (the centerpiece, Canada-boc × Japan-Tokyo blend):
   QUARTERLY trimmed mean + weighted median published YoY (CPI_Q, 1982→) as the thick lines,
   monthly trimmed-mean YoY overlaid thin. Caption + badge: "The quarterly trimmed mean
   remains the RBA's stated primary underlying-inflation reference during the monthly
   transition (through ~mid-2027) — 40+ years of history vs the monthly measure's <2."
3. Monthly groups YoY (11 groups, toggleable — floor caption).
4. Distribution ×2 on QUARTERLY sub-items (long history).
5. Explorer on QUARTERLY groups + sub-items (1948/1972→), monthly headline included for
   comparison.

### Ingestion assessment
One NEW module: `fetchAllAbsSeries.ts`, sibling of `collectors/absCollector.ts` — same
`au_macro_series` table (has `frequency` column — the dual-frequency discipline is already
schema-native), same DSD-label health check + omit-version URLs + NoRecordsFound handling,
extended with: OBS_STATUS capture (TVD p/r, JV q), null-row tolerance (JV suspension), the
negative-imports note, staleness thresholds (HSI/ITGS monthly ~75d; quarterly ~230d; approvals
~100d). No RBA collector (decision g). ~70 series estimated.

### PROXY caveat text (feeds `auProxyCaveats.ts`)
- `dual_freq_cpi` — US: one monthly CPI. AU: monthly CPI is the headline target measure
  (since Nov-2025) while the QUARTERLY trimmed mean remains the RBA's stated primary
  underlying reference through ~mid-2027. Caveat: the two frequencies are separate series on
  different bases; monthly history begins Apr-2024.
- `monthly_cpi_floor` — caption text: index from Apr-2024, YoY from Apr-2025; long-history
  panels use the quarterly series.
- `interim_sa` — monthly SA/trimmed/median use interim seasonal methods on <2 years of data.
- `hsi_consumption` — US: retail sales / PCE. AU: Monthly Household Spending Indicator
  (bank-transaction + administrative data; replaced the discontinued Retail Trade survey
  mid-2025). Caveat: current prices only at monthly frequency (volumes quarterly);
  methodology differs pre-Dec-2018.
- `lf_jobs` — US: Nonfarm Payrolls. AU: LFS employed persons (household survey). Caveat: the
  STP payroll-jobs series was discontinued Jul-2025; no establishment jobs count is
  API-available (the MEEI successor is spreadsheet-only).
- `jv_vacancies` — US: JOLTS with flows. AU: quarterly Job Vacancies survey. Caveat: no
  hires/quits; survey suspended 2008-09 (gap in the series); ~2-month lag.
- `tvd_prices` — US: Case-Shiller / FHFA indices. AU: ABS mean dwelling price (level, A$k,
  quarterly). Caveat: a mean price level, not a constant-quality index — composition shifts
  move it; the official RPPI was discontinued 2022; daily/monthly indices (CoreLogic) are
  private.
- `approvals_nsa` — US: permits SAAR. AU: building approvals published original-only on the
  API. Caveat: NSA — compare same months; the 12-month-sum view is the trend read.
- `lending_quarterly` — housing loan commitments are quarterly (monthly discontinued).
- `trend_vs_sa` — ABS recommends trend estimates over SA for LFS headline rates (±0.2pp SA
  standard error); panels emphasize trend with SA alongside.

---

## Summary & gate decisions

**Counts:** ~44 DIRECT · 5 PROXY · 12 GAP/defer (fiscal, sentiment ×2, payroll jobs, PCE,
claims, monthly IP, CoreLogic index, monthly lending, retail (discontinued), services trade
monthly, Credit v1, dwelling starts UNVERIFIED). ~55 flow/key combinations live-verified;
zero fabrications.

**Decisions:**
- **(a) Inflation dual-frequency layout — as proposed above** (monthly headline + quarterly
  RBA-reference centerpiece + long-history panels on quarterly).
- **(b) Unemployment: trend emphasized, SA alongside in the same panel** (both lines, trend
  thick) per ABS guidance — no toggle complexity; `trend_vs_sa` caveat.
- **(c) Payrolls: no two-badge pair — Payroll Jobs is dead** (verified). LF employment is the
  jobs story with the `lf_jobs` caveat; MEEI spreadsheet pipeline recorded as follow-up.
- **(d) Housing prices: TVD mean-price level** (quarterly, 2011→) with the level-not-index
  caveat; RPPI stays out (frozen 2021-Q4); CoreLogic GAP.
- **(e) Fiscal: GAP — omit the category** (verified: nothing on the API). No FiscalYearOverlay
  work.
- **(f) GDP contributions: published (`TCH`) — build the panel.**
- **(g) RBA fallback cases: NONE for v1** — recommend deferring the D2 credit-aggregates case
  (new non-API collector for one tab); path recorded.
- **(h) Discovered:** propose a BUSINESS tab (QBIS, verified) under Growth; propose a
  PROJECTION tab under Labor (all inputs monthly, unlike EU3); Industrial omitted as a
  category (no IP index exists); PPI_FD history-floor resolution folded into Phase 2 bring-up.

---

## Phase 2 Addendum (2026-07-08) — Ingestion Complete

### What was built
- **`server/src/fetchAllAbsSeries.ts`** — generic ABS collector, sibling of the untouched
  rates-side `collectors/absCollector.ts` (imports its exported `parseTimePeriod`; duplicates
  the small DSD-labels helper to keep that module byte-identical; skips its 8 codes): **108
  series across 16 DSDs** — CPI monthly ×21 (SA all-groups + 11 groups + 9 monthly-only
  aggregates), CPI quarterly ×25 (11 groups + 13 sub-items + CPI_Q SA all-groups), PPI ×3,
  GDP ×21 (aggregates + components + deflator + COE + **9 published TCH contributions incl.
  the enumerated public-GFCF `GFC.GSS`, inventories `IST.SSS`, and statistical discrepancy
  `SDE.SSS`**), HSI ×3, ITGS trade ×3, QBIS ×2, LF family ×18 (SA + trend), JV, WPI ×3,
  housing ×7. Same `au_macro_series` table — its `frequency` column makes the dual-frequency
  discipline schema-native. OBS_STATUS captured via a guarded additive migration (TVD p/r
  and monthly-CPI r flags confirmed stored). Omit-version URLs; NoRecordsFound handling;
  JV null-row tolerance; per-series staleness thresholds (quarter-start dating allowed for).
- Route `/api/abs?code=` (serves obs_status); startup + cron wiring;
  `client/src/data/auProxyCaveats.ts` (10 entries incl. the transition nomenclature).

### Verification (`server/src/scripts/verifyAuIngest.ts` — exits non-zero on failure)
**116 series (108 econ + 8 rates-side), 0 missing, 0 assertion failures.** Spot-checks match
Phase 1 exactly: monthly CPI all-groups 102.09 May-26; quarterly trimmed mean 26Q1 (177 obs
from 1982-Q1); unemployment trend 4.36% May-26; GDP QoQ +0.3%; WPI 160.4; vacancies 329.5k;
approvals 16,955; mean dwelling price A$1,111.1k; trade balance −A$3,018M. Dual-frequency
assertion: no series mixes frequencies. **TCH contributions-sum assertion (decision f,
permanent): 159 quarters, worst |Δ| = 0.40pp, tolerance 0.45pp** — the exact worst-case
rounding envelope of nine components published to 0.1pp; the initial 0.25 tolerance failed
honestly until the statistical-discrepancy component was added and the envelope derived.

### Bring-up catches (health check + zero-row check earning their keep)
1. Nine label/dimension mismatches on first run — incl. the agent-documented `LF_UNDER`
   PARM_ITEM dimension name and ABS's exact "Goods Credit/Debit" phrasing.
2. **ITGS stored zero rows silently-loudly**: the quarterly-hardcoded `ana()` shorthand fed
   monthly periods to the quarterly parser — every period dropped. Caught by the zero-row
   error; trade series now carry explicit `freq: 'M'` defs with a comment.
3. QBIS sales (M1) exists per-industry only — no TOT aggregate — dropped from config;
   the BUSINESS tab runs on profits + inventories.

### Deferred (paths recorded)
RBA D2 credit aggregates (rba.gov.au/statistics/tables/csv/d2-data.csv — new non-API
collector; decision g); MEEI employee-jobs spreadsheet pipeline (abs.gov.au monthly
publication; decision c context); dwelling starts (construction flow — UNVERIFIED);
services trade panels (BOP quarterly, verified but unpaneled v1).

---

## Phase 3 Addendum (2026-07-08) — Frontend Complete. Program Complete.

### Pages shipped (country `au`, accent #facc15; 15 content files, four categories)
- **Inflation**: CPI — the dual-frequency showcase: every panel title carries a [MONTHLY] or
  [QUARTERLY] tag; monthly headline (NSA + interim-SA) under the RBA 2–3% band with the
  Apr-2024 floor caption; the **quarterly trimmed-mean RBA-reference panel as the centerpiece**
  (thick quarterly lines 1983→, monthly trimmed mean as a thin dashed overlay, transition
  caption + badge); quarterly long-history headline; monthly groups; distribution + explorer on
  quarterly (levels never mixed across bases — rates only) · CPI PROJECTIONS (quarterly SA
  paces — the monthly is too young, captioned) · PPI (published rates; **history corrected to
  1998-Q3** against the live source) · OTHER (the monthly-only special aggregates incl. XFE
  flagged as the US-core analog, all floor-captioned)
- **Growth**: GDP (ABS-published TCH contributions — server-side sum assertion guards them —
  incl. dwelling investment; saving-ratio panel) · SPENDING (HSI monthly nominal + published
  YoY + quarterly real, all badged, Retail-Trade-successor caption) · TRADE (debits convention
  handled: |imports| displayed, balance keeps its true sign) · BUSINESS (profits + inventories;
  per-industry-only sales omitted, captioned)
- **Labor**: LABOUR FORCE (trend thick / SA thin on every rate panel per ABS guidance, ±0.2pp
  caption) · EMPLOYMENT (lf_jobs badges + the payroll-jobs-discontinuation line verbatim) ·
  UNDERUTILISATION (Australia's distinctive slack measures + youth) · VACANCIES (**the 2008-09
  survey suspension renders as a real 5-quarter break**, connectNulls off; Beveridge curve) ·
  WAGES (WPI published rates + real-wage panel) · PROJECTION (monthly SA inputs — the decision-h
  contrast with the EU3 omit: inputs determine the model's frequency)
- **Housing**: APPROVALS (12-month-sum primary view for the NSA-only feed) · PRICES & LENDING
  (TVD mean price with the level-not-index + RPPI-frozen captions and a DYNAMIC "latest quarter
  preliminary" caption keyed off the stored p-flag; OO/investor lending)
- **Fiscal, Credit, Industrial: no tabs, no stubs** — nav fallback, asserted in tests.

### Regression & test results
- Shared components: ONE touch — `buildDistribution` gained an optional `lag` param (default 12
  preserved; +3/−1 lines). Consumers UKCPIContent/CACPIContent/JPCPIContent/EU3HICPContent/
  AUCPIContent all pass in the smoke suite. **FiscalYearOverlay: zero diff lines** (the (e)
  cancellation held). US/UK/CA/JP/EU3 content pages: zero diffs.
- Suite **151/151** across three files: the AU coming-soon assertions flipped to real-page +
  absent-category assertions; 7 new AU nav cases (branch, categoryPath, invalid-tab fallback,
  underutilisation/business/prices-lending deep links, absent-Industrial); **synthetic fallback
  coverage** in new `navFallback.test.tsx` (vi.mocks a ZZLAND entry into COUNTRIES so the
  coming-soon path keeps real coverage with no contentless country left); 16 AU smoke renders.
  tsc strict clean both workspaces; vite build clean; all ~80 consumed codes live-verified by
  the build agents.

### Program completion — consolidated deferred backlog (all eight countries)
| Item | Country | Path |
|---|---|---|
| MLIT housing Excel collector | JP | mapping doc Phase 2 addendum |
| Full MLS wages file pipeline | JP | e-Stat files toukei=00450071 |
| Retail (file-only current data) | JP | e-Stat files / METI Excel (browser UA) |
| MoF fiscal scraper | JP | mof.go.jp HTML/Excel |
| Destatis factory orders | DE | GENESIS-Online (registration) |
| 2026 HICP weights swap | DE/FR/IT | prc_hicp_inw when published (forward-fill until) |
| PPI (sts_inpp_m) | DE/FR/IT | UNVERIFIED — one dataset check |
| RBA D2 credit aggregates | AU | rba.gov.au csv tables (new non-API collector) |
| MEEI employee-jobs pipeline | AU | ABS monthly publication spreadsheets |
| Dwelling starts | AU | ABS construction flow (UNVERIFIED) |
| Fiscal Monitor monthly | CA | open.canada.ca CKAN per-month ZIPs |
| UK quarterly housing supply | UK | DLUHC Excel |
| Services-trade panels | JP/AU | BOP quarterly (verified, unpaneled) |
