# Gaps & Omissions Across the Country Replications — Master Reference

Generated 2026-07-08, after program completion (eight countries live). This document consolidates
what happened to every US panel/series in each replication: shipped directly, substituted,
gapped at the source, omitted by gate decision, deferred, or failed conditional verification.

## Reading Guide

**Status codes (one per matrix cell):**

| Code | Meaning |
|---|---|
| `✓` | DIRECT — an equivalent shipped (a methodology badge/caption may still apply; see §3.4) |
| `P` | PROXY — a substitute shipped, badged from the country's caveat registry |
| `G` | GAP — no equivalent exists at the source (documented) |
| `O` | OMITTED — an equivalent may exist but the panel was omitted; `O*` = omission not individually recorded in the mapping doc (reason not recorded — per the no-reconstruction rule, no reason is invented) |
| `D` | DEFERRED — mapped and viable, on the backlog with a documented access path |
| `F` | FAILED — conditionally pre-approved, failed live verification |
| `—` | N/A — the whole category is absent for that country (see §3.1) |

**Source-of-truth rule:** built from the seven mapping docs and their Phase 2/3 addenda
(`docs/uk-models-mapping.md`, `docs/ca-models-mapping.md`, `docs/jp-models-mapping.md`,
`docs/eu3-models-mapping.md` [DE/FR/IT], `docs/au-models-mapping.md`), cross-checked against the
shipped state (hub section configs, `*ProxyCaveats.ts` registries, collector configs). Where a
plan and the shipped state disagree, **the shipped state wins** — the known cases are the
conditional-verification outcomes (§3.5). PROXY caveat text is quoted verbatim from the
registries. Where a reason was never documented, the entry says *(reason not recorded)*.

**Granularity:** rows are US panels/series-families as inventoried in
`docs/uk-models-mapping.md` §1a. A cell is `✓` only if the concept shipped whole; partial
outcomes are `P` or noted.

DE/FR/IT share one column ("EU3") where identical — the few per-country splits are shown as
`DE/FR/IT` in-cell and detailed in §2.5.

---

## 1. The Master Matrix

### 1.1 Inflation

| US panel / series | US IDs | UK | CA | JP | DE | FR | IT | AU |
|---|---|---|---|---|---|---|---|---|
| CPI headline + core indices (page core) | CPIAUCSL, CPILFESL | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CPI contribution panels (weights) | CPIAUCSL + CPIUFDSL/CPIENGSL/CUSR0000SACL1E/SASLE, fixed Dec-24 weights | ✓ | ✓ | **F** | ✓ | ✓ | ✓ | O* |
| CPI distribution (72 sub-indices) | `DIST_SERIES_IDS` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CPI projections (carry-forward model) | CPIAUCSL, CPILFESL | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| PCE page + core (monthly deflator) | BEA 2.3.4U lines 1–25, PCEPI/PCEPILFE | G | G | G | G | G | G | G |
| PCE projections | BEA lines 1/25 | G | G | G | G | G | G | G |
| PPI headline + core | PPIFIS, PPIFES | P | P | ✓ | D | D | D | ✓ |
| PPI services / final-demand services | PPIDSS | O | G | O* | D | D | D | O* |
| Inflation expectations | MICH, NY Fed SCE 1y/3y/5y, UMich 5y | D | O* | O* | O* | O* | O* | O* |
| Trimmed-mean / sticky CPI | PCETRIM12M159SFRBDAL, CORESTICKM159SFRBATL | G | P | O* | O* | O* | O* | ✓ |

### 1.2 Growth

| US panel / series | US IDs | UK | CA | JP | DE | FR | IT | AU |
|---|---|---|---|---|---|---|---|---|
| Nominal GDP tree (49 series) | GDP, PCEC, GPDI, NETEXP… (NIPA 1.1.5) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Real GDP + published contributions | GDPC1 + BEA 1.5.2 | ✓ / D | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Personal income & outlays (monthly, PIO) | PI, DSPI, PSAVERT… (NIPA 2.1) | P | P | P | P | P | P | P |
| Retail sales + store-type contributions | RSAFS, RSFSXMV + 13 components | ✓ / P | ✓ / O | D | ✓ / O* | ✓ / O* | ✓ / O* | P |
| NPCE / RPCE (monthly consumption ×31 lines) | BEA npce/rpce | P | P | P | O* | O* | O* | P |
| GDI income tree | NIPA 1.10 ×24 (A261RX1Q020SBEA real) | P | ✓ | O | O* | O* | O* | O* |
| Consumer Health — sentiment | UMCSENT | G | G | O | P | P | P | G |
| Consumer Health — delinquencies / debt service / net worth / card balances / gasoline | DRCLACBS…, TDSP/MDSP/CDSP, BOGZ1FL192090005Q, RCCCBBALTOT, GASREGW | G/G/G/P/D | G/✓/✓/P/D | O | O* | O* | O* | O* |
| Trade — totals | BOPTEXP/BOPTIMP/BOPGSTB | ✓ | P | P | ✓ | ✓ | ✓ | ✓ |
| Trade — goods by category (Census end-use) | `/api/census-trade` ×14 | D | D | O | O* | O* | O* | O* |
| Trade — services by category | ITX*/ITM* ×9 | D | D | D | O* | O* | O* | D |

### 1.3 Labor

| US panel / series | US IDs | UK | CA | JP | DE | FR | IT | AU |
|---|---|---|---|---|---|---|---|---|
| Unemployment rate + participation/EPOP | UNRATE, CIVPART, EMRATIO | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| U1–U6 alternative rates | U1RATE…U6RATE | G | D | O* | O* | O* | O* | ✓ |
| Unemployment decomposition by reason | LNS13* ×6 | G | O* | O* | O* | O* | O* | O* |
| Weekly claims | ICSA/ICNSA/CCSA/CCNSA | P | P | G | G | G | G | G |
| Payrolls (NFP) + sector decomposition | PAYEMS + 14 sectors (CES) | P | P | P | P | P | P | P |
| Average hourly earnings ×17 sectors | CES AHE | ✓ | P | P | P | P | P | ✓ |
| Average weekly hours | CES AWH | P | D | D | P | P | P | ✓ |
| JOLTS openings + Beveridge | JTSJOL | ✓ | ✓ | P | P | P | P | P |
| JOLTS hires / quits / layoffs / implied NFP | JTSHIL/JTSQUL/JTSLDL | G | G | G | G | G | G | G |
| Productivity / ULC | OPHNFB, ULCNFB | ✓ | ✓ | D | O* | O* | O* | O* |
| U-3 scenario projection | UNRATE, CE16OV, CLF16OV | ✓ | ✓ | ✓ | O | O | O | ✓ |

### 1.4 Housing

| US panel / series | US IDs | UK | CA | JP | DE | FR | IT | AU |
|---|---|---|---|---|---|---|---|---|
| Starts / permits / completions / under-construction | HOUST*, PERMIT*, COMPUTSA*, UNDCONTSA* | D | ✓ | — | P | P | P | P |
| New home sales / months' supply | HSN1F, MSACSR, HOSSUPUSM673N | P | G | — | G | G | G | O* |
| House prices | MSPNHSUS, CSUSHPISA | ✓ | ✓ | — | ✓ | ✓ | ✓ | P |
| Rents | CUSR0000SEHC | ✓ | ✓ | — | O* | O* | O* | O* |
| Mortgage rates + spread | MORTGAGE30US, DGS10, DFF | P | O* | — | O* | O* | O* | O* |
| Bank residential lending | RREACBW027SBOG + HELOC/closed-end | P | P | — | O* | O* | O* | P |
| Mortgage delinquency | DRSFRMACBS | G | G | — | O* | O* | O* | O* |
| Res. construction payrolls / spending / investment | CES2023610001, TLRESCONS, PRFI | P | O* | — | O* | O* | O* | O* |

### 1.5 Credit / Industrial / Fiscal

| US panel / series | US IDs | UK | CA | JP | DE | FR | IT | AU |
|---|---|---|---|---|---|---|---|---|
| Bank credit (H.8 tree ×3 cohorts, % NGDP) | TOTBKCR, TOTLL + ~123 series | P | P | P | P | P | P | D |
| Industrial production + weighted contributions | INDPRO + G.17 groups/weights | ✓ / D | P | ✓ | ✓ | ✓ | ✓ | G |
| Fiscal — DTS daily flows | `/api/fiscal-flows` (ΔTGA−Δdebt) | G | G | — | G | G | G | — |
| Fiscal — withheld tax deposit cycles | DTS withheld tables | P | D | — | G | G | G | — |
| Fiscal — MTS monthly balance + % GDP | `/api/mts` + GDP | ✓ | P | — | P | P | P | — |

---

## 2. Per-Country Detail (every non-✓ cell)

### 2.1 United Kingdom

Registry: `client/src/data/ukProxyCaveats.ts` (18 entries). Mapping: `docs/uk-models-mapping.md`.

- **PCE pages — GAP.** US: BEA 2.3.4U monthly deflator + core (feeds PCE + PCE Projections
  pages). Mapping: "No UK monthly consumption deflator… Recommend: omit both PCE pages.
  Quarterly household-consumption deflator could be derived (ABJQ/ABJR) but adds little vs
  CPI/CPIH." Gate decision 1 confirmed omit; CPIH fills the broader-than-CPI slot on Other.
- **PPI headline/core — PROXY** (PPIFIS/PPIFES → JVZ7/GBBV). Caveats verbatim: *"UK PPI covers
  manufacturing output only — no services or final-demand concept. NSA."* / *"Manufacturing
  scope only; exclusion basket differs (also excludes beverages/tobacco). NSA."*
- **PPI services (PPIDSS) — OMITTED.** "UK Services PPI is quarterly, separate dataset — omit
  or add later as quarterly panel (codes UNVERIFIED)."
- **Inflation expectations — DEFERRED.** US: MICH/SCE monthly. UK: BoE/Ipsos Inflation
  Attitudes Survey, quarterly Excel (stable URL verified in the Phase 2 addendum; collector not
  built per approval scope). Registry caveat: *"Quarterly not monthly; survey methodology
  differs. Not yet ingested — deferred."*
- **Trimmed-mean / sticky CPI — GAP.** "Not published for UK."
- **RGDP published contributions — DEFERRED.** BEA-1.5.2 analog exists as ONS quarterly-accounts
  Excel tables (not CDIDs); the Excel-scraper extension is on the deferred list. UK RGDP shipped
  without quarterly contribution charts (CVM non-additive → client math forbidden).
- **PIO → "Household Income" — PROXY** (quarterly restructure). Caveat: *"Quarterly only — no
  UK monthly personal-income release exists."*
- **Retail store-type contributions — PROXY.** Caveat: *"Contributions computed from value
  shares are approximate; volume indices are chain-linked"* (official weights live in the
  bulletin, not the API).
- **NPCE/RPCE → "Consumption" — PROXY** (one quarterly Consumer Trends page replaces two
  monthly pages). Caveat: *"Quarterly not monthly; national-accounts basis; real (CVM) splits
  are not additive."*
- **GDI — PROXY** (slim GDP(I) decomposition). Caveat: *"Slimmer decomposition; no UK real GDI
  equivalent is published"* (A261RX1Q020SBEA has no analog).
- **Consumer Health**: UMCSENT — GAP ("GfK consumer confidence is private"); delinquencies —
  GAP ("UK Finance arrears data is member-only"); TDSP/MDSP/CDSP — GAP ("Not published monthly
  for UK"); net worth — GAP ("ONS household balance sheet is annual"); card balances — PROXY
  (LPMBI2O family), caveat: *"Covers all unsecured consumer credit (cards + loans +
  overdrafts), not credit cards alone"*; gasoline — DEFERRED (DESNZ weekly road-fuel CSV,
  unverified feed).
- **Trade by end-use — DEFERRED.** Caveat (registry, panel unshipped): *"Category taxonomies
  differ (SITC sections vs end-use); not yet ingested — deferred."* Services-by-category detail
  also deferred (quarterly BoP dataset).
- **U1–U6 — GAP** ("No UK U-series"; duration-based substitute CDIDs unverified/deferred).
  **Decomposition by reason — GAP** ("LFS publishes duration, not reason shares").
- **Claims — PROXY** (claimant count). Caveat: *"Monthly not weekly; no initial/continuing
  split; Universal Credit policy changes distort the level over time."*
- **Payrolls — PROXY** (PAYE RTI). Caveat: *"Differs in coverage (excludes self-employed) and
  methodology (admin data vs survey); latest month provisional."*
- **Hours — PROXY** (YBUS aggregate). Caveat: *"Aggregate hours level, not per-worker sector
  averages; LFS rolling 3-month basis."*
- **JOLTS flows — GAP** ("No UK hires/quits/layoffs flows exist; redundancies (BEAO) proxy
  layoffs only" — the implied-NFP panel omitted with them).
- **Housing SUPPLY — DEFERRED** (gate decision 4: ship Housing without SUPPLY; DLUHC quarterly
  Excel starts/completions on the backlog). **New home sales / months' supply — GAP → PROXY
  substitution**: caveat *"Approvals lead completed transactions; no UK new-home-sales or
  months'-supply series exists"* (mortgage approvals LPMVTVX serve as DEMAND).
- **Mortgage rates — PROXY.** Caveat: *"UK mortgages fix for 2–5 years, not 30; 'effective'
  series mix new business and outstanding stock."* **Mortgage delinquency — GAP** (UK Finance
  arrears private). **Res-construction payrolls/spending — PROXY** per mapping (ONS construction
  output; shipped within the restructured sections).
- **Credit — PROXY** (Bankstats). Caveat: *"Monthly not weekly; no large/small-bank cohort
  split; sector definitions differ from H.8 categories."*
- **Industrial contribution panel — DEFERRED** (weights live in the bulletin; explorer shipped).
- **Fiscal**: DTS — GAP ("No daily UK Treasury cash data") → PSF restructure; withheld-tax
  cycles — PROXY (HMRC receipts), caveat: *"Monthly not business-day; cash-receipt timing
  differs from accrual measures in PSF."*

### 2.2 Canada

Registry: `client/src/data/caProxyCaveats.ts` (9 keys + the boc_core_rates panel). Mapping:
`docs/ca-models-mapping.md`.

- **PCE pages — GAP** ("UK precedent — Canada's household consumption deflator is quarterly
  national-accounts").
- **PPI — PROXY** (IPPI). Caveats verbatim: *"No services or final-demand concept;
  manufacturing products only. NSA."* / *"Exclusion basket differs from the US core
  (energy/petroleum only, food remains included)."* **PPI services — GAP** (IPPI has no
  services concept).
- **Trimmed-mean analog — PROXY** (the BoC preferred-core trio panel, decision b). Caveat:
  *"No index form exists — published rates are plotted directly; MoM, annualized and level
  views are impossible."*
- **Inflation expectations — OMITTED** *(reason not recorded — listed among Phase 3 omissions
  without an individual entry).*
- **Retail store-type contributions — OMITTED** (Phase 3 scope: "retail store-type
  contributions" in the omitted list; retail sub-industries deferred). Retail headline shipped
  with the 2017 NAICS-break caption (decision e: no splicing).
- **PIO → Household Income — PROXY** (quarterly household sector accounts; caption notes the US
  page is monthly). **NPCE/RPCE → Consumption — PROXY** (same quarterly basis).
- **Consumer Health**: UMCSENT — GAP ("CCI (Conference Board of Canada) is private");
  delinquencies — GAP ("CBA/Equifax data private"); debt service — **DIRECT and better than
  the US** (Canada publishes the full DSR); net worth — DIRECT (NW-to-disposable-income);
  card balances — PROXY (household_credit registry): *"Borrower-side household stock; no
  bank-asset view (C&I/CRE lending not covered); monthly not weekly"*; gasoline — DEFERRED
  ("pump prices" on the deferred list).
- **Trade — PROXY** (merchandise only). Caveat: *"Services trade is quarterly and not included;
  balances differ from the total-trade concept."* By-product/partner and quarterly services
  detail — DEFERRED.
- **U1–U6 — DEFERRED** ("R1–R8 supplementary rates exist (14-10-0077, UNVERIFIED) — Defer").
  **By-reason decomposition — OMITTED** *(reason not recorded)*.
- **Claims — PROXY** (EI beneficiaries). Caveat: *"Monthly stock of recipients, not weekly
  claim flows; ~2-month publication lag; EI eligibility rules shift the level."*
- **Payrolls — PROXY ×2** (decision d, the two-badge precedent): SEPH — *"Concept-match to NFP
  but excludes self-employed and is released ~1 month after the LFS"* — and LFS — *"Household
  survey ≠ establishment payroll count; includes self-employment. Not the same measure as SEPH
  above."*
- **AHE — PROXY** (SEPH weekly earnings): *"Weekly not hourly earnings; moves with hours-worked
  composition as well as wages."* **Hours worked — DEFERRED** (on the Phase 2 deferred list;
  LFS hourly wages likewise).
- **JOLTS flows — GAP** ("No Canadian JOLTS flows"; the Beveridge curve shipped from the
  vacancy rate).
- **Housing**: new home sales / months' supply — GAP ("Not published"); resale price indices —
  GAP ("Teranet-NB and CREA MLS HPI: private") with NHPI shipped as the new-construction read
  and **no DEMAND tab** (decision c); mortgage-rate panel — OMITTED *(reason not recorded;
  mortgage interest cost ships as a CPI component)*; delinquency — GAP; res-construction
  payroll/spending — OMITTED *(reason not recorded)*.
- **Credit — PROXY** (household credit; caveat above). PNFC/business credit deferred.
- **Industrial — PROXY** (monthly GDP by industry). Caveat: *"Value-added GDP concept in
  chained dollars, not a gross-output production index."*
- **Fiscal**: DTS — GAP → quarterly GFS restructure (decision a: "honest assessment… Not a
  GAP" for the concept, but no daily analog); withheld-tax cycles — DEFERRED (the monthly
  Fiscal Monitor collector, CKAN path recorded); MTS-analog — PROXY (quarterly GFS cadence vs
  the US monthly MTS, Apr–Mar FY overlays).

### 2.3 Japan

Registry: `client/src/data/jpProxyCaveats.ts` (10 entries). Mapping: `docs/jp-models-mapping.md`.

- **CPI contribution panels — FAILED (decision g).** Conditionally pre-approved; verification
  found the 2020-base CPI weights exist in NO e-Stat flow (Excel-only publication). Panel
  omitted per the pre-approval terms; recorded in the Phase 2 addendum. *(This is the
  conditional-failure case sometimes misattributed to Canada — Canada's weights table
  18-10-0007 verified and its contribution panels shipped.)*
- **PCE pages — GAP** (no monthly consumption deflator; UK/CA precedent).
- **PPI — DIRECT via decision (h)**: BoJ `PR01` verified (the renamed CGPI), shipped on the
  Industrial page with the BoJ attribution line. PPI-services (BoJ SPPI) — OMITTED *(reason not
  recorded)*.
- **Inflation expectations / trimmed-mean analogs — OMITTED** *(reasons not recorded — not
  individually mapped)*.
- **Retail — DEFERRED** (honest call: the e-Stat DB froze at Jan-2025 while the survey lives;
  "serving 17-month-stale data as current is misleading"; file/METI-Excel paths recorded).
- **PIO / NPCE / RPCE → Consumption — PROXY** (FIES household survey). Caveat: *"Survey of ~9k
  households, NSA and volatile; the 'real' line shown is CPI-deflated by the terminal (official
  real series is file-only)."*
- **GDI — OMITTED** (mapping: income-side decomposition UNVERIFIED beyond compensation —
  "fold compensation into Consumption/Household panels, no GDP(I) tab for v1").
- **Consumer Health — OMITTED** ("GAP-heavy — no DSR/credit-card/delinquency publications;
  Consumer Confidence Survey UNVERIFIED on the API. Omit the tab"). Consumer confidence later
  verified available in the composite-indicator table — recorded as available-but-unpaneled.
- **Trade — PROXY** (Customs CSV totals; e-Stat holds only commodity×country detail). Caveat:
  *"Customs basis ≠ BOP basis; services excluded; strongly seasonal (NSA) — compare like
  months."* Commodity-detail panels — OMITTED (available in-source, unpaneled); services —
  DEFERRED (BOP quarterly verified, unpaneled).
- **Weekly claims — GAP** ("No weekly claims concept"). **JOLTS flows — GAP** (no
  hires/quits; the job-offers ratio has no flow dimension).
- **Payrolls — PROXY** (LFS employed persons + MLS-derived regular-employment YoY). Caveats:
  *"Household survey includes self-employed; no establishment jobs count is API-available in
  Japan"* and *"A derived MLS series (2020 base): YoY rate only, no level; full MLS employment
  data is file-only and deferred."*
- **AHE — PROXY (partial)** (manufacturing-only contractual earnings). Caveat: *"Manufacturing
  subset; excludes overtime and bonuses — summer/winter bonus months (Jun–Jul, Dec) dominate
  total pay and are invisible here. Full Monthly Labour Survey wages are file-only and
  deferred."* **Hours — DEFERRED** (same MLS file pipeline).
- **JOLTS openings — PROXY** (有効求人倍率). Caveat: *"Ratio of Hello-Work postings to
  applicants — excludes new graduates and much white-collar hiring; no hires/quits flows
  exist."*
- **Productivity — DEFERRED** ("JPC/quarterly productivity not checked — defer; no tab v1").
- **U1–U6 / by-reason — OMITTED** *(reasons not recorded)*.
- **Housing — category N/A** (decision d): the starts DB froze at 2024-12 with an official
  "use the Excel tables" notice; the MLIT property price index is xlsx-only with changing file
  IDs; CoreLogic-style private indices aside, no live API path. MLIT Excel collector on the
  backlog.
- **Credit — PROXY** (BoJ lending). Caveat: *"Aggregate lending stock only, no
  borrower-category split. Data via the BoJ Time-Series Data Search API; content not
  guaranteed by the Bank of Japan."*
- **Fiscal — category N/A** (decision b): verified — MoF publishes nothing via the e-Stat API
  (receipts & payments, tax revenues, JGB outstanding are all mof.go.jp HTML/Excel). No forced
  scraper.

### 2.4 Germany / France / Italy (EU3)

Registry: `client/src/data/eu3ProxyCaveats.ts` (8 shared entries + per-country overrides via
`eu3Caveat(key, cc)`). Mapping: `docs/eu3-models-mapping.md`. Statuses are identical across the
trio except where noted in §2.5.

- **PCE pages — GAP** (no monthly consumption deflator; the established precedent).
- **PPI — DEFERRED** ("PPI exists as `sts_inpp_m` — UNVERIFIED, out of proposed scope v1").
- **Inflation expectations / trimmed-mean analogs — OMITTED** *(reasons not recorded; the
  consumer survey's price-trend sub-questions were noted as available)*.
- **Retail store-type contributions — OMITTED** *(reason not recorded; headline + ex-fuel
  shipped)*.
- **PIO — PROXY (partial)**: no Household-Income tab; the concept's pieces shipped across
  tabs (saving rate on Sentiment, compensation of employees on GDP). **NPCE/RPCE — OMITTED**
  *(reason not recorded — no consumption tab; retail volume is the monthly consumption read)*.
  **GDI — OMITTED** *(reason not recorded; D1 compensation shipped inside the GDP page)*.
- **Consumer Health — PROXY** (the harmonized survey family substitutes the sentiment slot).
  Caveat: *"Harmonized EU panels — not the national market-movers (ifo/ZEW, INSEE climat,
  ISTAT fiducia), which are separate surveys with different panels and timing."* Delinquencies/
  debt-service/net-worth panels — OMITTED *(reasons not recorded)*.
- **Trade by category — OMITTED** (partner/product splits exist in the same dataset — recorded
  as future extensions, unpaneled). **Services trade — OMITTED** *(reason not recorded)*.
- **Weekly claims — GAP** (no concept). **JOLTS flows — GAP** (*"Quarterly, ~2-quarter
  publication lag, no hires/quits flows"*).
- **Payrolls — PROXY** (national-accounts employees, decision d). Caveat: *"Quarterly not
  monthly; domestic concept counts cross-border workers at the workplace; national-accounts
  sourced, not a survey print. Chosen over the LFS series for longer history and no survey
  breaks."*
- **AHE / hours — PROXY** (Labour Cost Index; hours in the same national-accounts dataset).
  Caveat: *"Quarterly; includes taxes minus subsidies on labour (D1_D4_MD5), not pure wages;
  business economy only."*
- **JOLTS openings — PROXY** (vacancy rate; per-country splits in §2.5).
- **Productivity — OMITTED** *(reason not recorded)*. **Labor projection — OMITTED (decision
  i)**: "quarterly inputs under-determine a monthly mechanical model" — no false-precision
  projections.
- **Housing**: permits — PROXY, caveat: *"Index form only — no absolute dwelling counts exist
  in the dataset; quarterly cadence"*; transactions/new-home-sales — GAP ("transactions/
  inventory coverage is thin" — nothing mapped); rents/mortgage-rates/housing-credit/
  delinquency panels — OMITTED *(reasons not recorded; the page shape is PRICES + PERMITS by
  decision c)*.
- **Credit — PROXY** (ECB BSI, decision h verified). Caveat: *"Two borrower sectors only
  (households / NFCs); outstanding stocks are NSA; growth rates are the ECB's adjusted
  (flows-based) measures."*
- **Fiscal**: DTS — GAP; withheld-tax cycles — GAP (no cash-flow analog at any cadence);
  MTS-analog — PROXY (quarterly ESA restructure, decision b). Caveat: *"Quarterly accrual
  accounting, not cash flows; strong within-year seasonality — use the trailing-4Q view for
  trend. No daily/monthly analog exists."*

### 2.5 EU3 per-country splits

- **Vacancies**: FR — *"France: series starts 2011-Q2 and carries a definition-differs flag on
  every observation (coverage: establishments with 10+ employees)"*; IT — *"Italy: rate only —
  no vacancy levels are published; series starts 2016"* (levels: source GAP); DE — *"Germany:
  cleanest of the three — levels also published, history from 2006."*
- **Employment proxy**: FR — *"France: seasonally adjusted only (no calendar adjustment) where
  Germany/Italy are SCA."*
- **Fiscal**: IT — *"Italy: NSA only — no seasonally adjusted variant exists; the trailing-4Q
  view is the primary read"*; DE — recent quarters provisional (p-flags).
- **Permits**: DE — *"Germany: 24 observations are Eurostat estimates (e-flag) — marked on the
  chart."*
- **Factory orders (US durable-goods-orders adjacency) — OMITTED for DE (decision f)**:
  confirmed extinct on Eurostat (orders datasets discontinued 2012, none disseminated); the
  only source is Destatis GENESIS (registration-gated) — "a fourth integration for one panel
  fails the cost test." FR/IT: no concept (GAP).

### 2.6 Australia

Registry: `client/src/data/auProxyCaveats.ts` (10 entries). Mapping: `docs/au-models-mapping.md`.

- **CPI contribution panels — OMITTED** *(reason not recorded — CPI weights were not pursued in
  the AU mapping; no gate decision exists either way)*.
- **PCE pages — GAP** (established precedent). **PPI services — OMITTED** *(reason not
  recorded; PPI_FD by-industry detail exists unexplored)*.
- **Trimmed-mean / underlying analogs — DIRECT, and the page centerpiece**: the quarterly
  trimmed mean + weighted median ARE Australia's official underlying measures. Caveat
  (disclosure on the panel): *"Watch the quarterly print for policy; the monthly line has <2
  years of history and interim SA."*
- **Inflation expectations — OMITTED** *(reason not recorded; Melbourne Institute survey is
  private)*.
- **Retail — PROXY** (the survey is dead): US RSAFS → Monthly Household Spending Indicator.
  Caveat: *"Current prices only at monthly frequency (volumes are quarterly); methodology
  differs before Dec-2018."* Retail Trade (`RT`) verified discontinued (final data 2025-06).
  PIO/NPCE/RPCE map onto the same HSI substitute plus the GDP page's saving ratio/COE.
- **GDI — OMITTED** *(reason not recorded; COE shipped inside the GDP page)*.
- **Consumer Health — GAP** for sentiment (Westpac–Melbourne Institute and NAB are private;
  verified: no ABS sentiment dataflow among all 1,223); other consumer-health panels — OMITTED
  *(reasons not recorded)*.
- **Trade by category — OMITTED** (rich commodity detail verified available in ITGS,
  unpaneled). **Services — DEFERRED** (BOP quarterly, verified but unpaneled v1).
- **U1–U6 — DIRECT, and better**: Australia publishes underemployment and underutilisation
  rates as first-class series (own tab).
- **Weekly claims — GAP** (no concept). **JOLTS flows — GAP** (survey has no flow dimension).
- **Payrolls — PROXY** (the second dead feed): US PAYEMS → LFS employed persons. Caveat: *"The
  STP Weekly Payroll Jobs series was discontinued Jul-2025 (its MEEI successor is
  spreadsheet-only) — the two-source payrolls pattern used elsewhere does not apply; no
  establishment jobs count is API-available."* (Decision c: no frozen-panel resurrection.)
- **JOLTS openings — PROXY** (quarterly JV survey). Caveat: *"No hires/quits flows; the survey
  was suspended 2008-09 (a real gap in the series); ~2-month publication lag."*
- **Productivity — OMITTED** *(reason not recorded; GDP-per-hour exists in ANA_AGG, unpaneled)*.
- **By-reason decomposition — OMITTED** *(reason not recorded)*.
- **Housing**: approvals — PROXY (permits-analog, NSA-only): *"NSA — compare same months; the
  12-month-sum view is the trend read"*; prices — PROXY (third dead feed — the RPPI froze at
  2021-Q4): *"A mean price LEVEL, not a constant-quality index — composition shifts move it.
  The official RPPI was discontinued 2022 (frozen at 2021-Q4); daily/monthly indices
  (CoreLogic) are private"*; lending — PROXY (quarterly commitments): *"housing loan
  commitments are quarterly (monthly discontinued)"*; new-home-sales/rents-panel/mortgage-rate/
  delinquency/construction panels — OMITTED *(reasons not recorded; the page shape is
  APPROVALS + PRICES & LENDING)*.
- **Credit — DEFERRED (decision g)**: money/credit aggregates are RBA-only (statistical table
  D2 CSV — a new non-API collector for one tab); recommended defer, path recorded.
- **Industrial — GAP as a category**: "Australia publishes no monthly industrial production
  index" — QBIS profits/inventories cover the business-cycle read as a Growth tab instead.
- **Fiscal — category N/A (decision e)**: verified — no GFS dataflow among all 1,223 on the ABS
  Data API; quarterly GFS is spreadsheet-only, monthly Finance statements are documents.

---

## 3. Structural & Cross-Cutting Notes

### 3.1 Whole-category outcomes
- **Fiscal absent: JP + AU** — for different reasons: Japan's MoF publishes only HTML/Excel
  (nothing on the e-Stat API); Australia's ABS Data API carries no GFS dataflow at all
  (spreadsheet-only). Both were verified negatives, not assumptions.
- **Housing absent: JP** — both feeds frozen/file-only (starts DB frozen 2024-12 with an
  official "use the Excel tables" notice; property-price index xlsx-only).
- **Industrial absent: AU** — no IP index exists in Australia (QBIS business indicators serve
  the cycle read under Growth).
- **Credit absent: AU (deferred)** — RBA-only source, decision g.
- Every absence is served by the nav's coming-soon fallback with test coverage (real-country
  absent-category cases + the synthetic-country case in `navFallback.test.tsx`).

### 3.2 Fiscal restructures — and what none of them cover
UK (monthly PSF + HMRC receipts), Canada (quarterly GFS + monthly federal debt), EU3 (quarterly
ESA accounts + Maastricht debt) each restructured Fiscal to the country's honest shape.
**No country has a DTS analog**: daily Treasury cash flows (ΔTGA−Δdebt) and business-day
withheld-tax cycle tables exist nowhere outside the US. The nearest analogs by cadence: UK
monthly (PSNCR/CGNCR noted as the closest cash-flow framing), CA/EU3 quarterly, JP/AU none.

### 3.3 The payrolls concept exists nowhere outside the US
No country publishes an NFP-style monthly establishment jobs count on an API. Substitutes:
UK — PAYE RTI payrolled employees (admin tax data); CA — SEPH payroll count + LFS employment
(the two-badge pair); JP — LFS employed persons + MLS-derived regular-employment YoY (full MLS
file-only); DE/FR/IT — national-accounts employees (SAL_DC, quarterly); AU — LFS employed
persons only (the STP payrolls series is dead; MEEI successor spreadsheet-only). Likewise
**JOLTS hires/quits/layoffs flows exist nowhere** — every country is openings/vacancies-only.

### 3.4 Methodology badges on DIRECT panels
Some `✓` cells carry registry-backed disclosure badges that are not substitutions: UK
`lfs_rolling` (3-month windows) and `vacancy_rate` (computed rate); JP `core_nomenclature`
(Japan's "core" = ex fresh food only), `tokyo_advance`, `unemployment_nsa`; EU3
`hicp_projection_nsa`; AU `dual_freq_cpi`, `monthly_cpi_floor`, `interim_sa`,
`trimmed_mean_reference`, `trend_vs_sa` (ABS recommends trend over SA).

### 3.5 Conditional verifications & discrepancy notes
Shipped-state cross-check found the mapping docs and reality aligned except the known
conditional outcomes: **JP (g) CPI weights FAILED** (contribution panel omitted — the one `F`
in the matrix); JP (h) PPI verified → shipped; CA (f) GDP/Household-Income tables verified →
shipped; EU3 (h) BSI lending verified → shipped; AU PPI shipped with its **history floor
corrected live to 1998-Q3** (an earlier truncated probe had suggested 2005-Q2 — the shipped
caption follows the live source). Note: Canada's CPI-weights contribution panels shipped
normally (weights table 18-10-0007 verified) — the weights failure was Japan's.

### 3.6 Frozen/dead feeds that drove honest defers
JP: MLS wages (2020-base never loaded to the API), retail DB (frozen Jan-2025), housing starts
DB (frozen Dec-2024). AU: Retail Trade survey (final 2025-06), Weekly Payroll Jobs (final
Jul-2025), RPPI (frozen 2021-Q4). EU: the ECB `ICP` dataflow (discontinued Feb-2026, migrated
pre-EU3). Every collector carries staleness thresholds so the next one announces itself.

### 3.7 Deferred backlog
The consolidated 13-item backlog lives in `docs/au-models-mapping.md` (Phase 3 addendum) —
not duplicated here. Matrix cells each item would flip on completion: MLIT housing Excel →
JP Housing row `—`→builds; JP MLS wages pipeline → JP AHE `P(partial)`→fuller / hours `D`→`✓`;
JP retail files → JP Retail `D`→`✓`; JP MoF scraper → JP Fiscal `—`→restructure; Destatis
factory orders → DE factory-orders `O`→`✓`; EU3 PPI check → DE/FR/IT PPI `D`→likely `✓`;
2026 HICP weights → caption refresh only; RBA D2 → AU Credit `D`→`P`; AU MEEI pipeline → AU
payrolls `P`→two-badge; AU dwelling starts → AU Housing supply depth; CA Fiscal Monitor → CA
withheld-tax `D`→`P`; UK DLUHC → UK starts/permits `D`→`P`; JP/AU services trade → `D`→`P`.
UK-only extras (Phase 2 addendum): BoE/Ipsos expectations, RGDP-contributions Excel scraper,
SITC trade, PAYE industry splits, DESNZ fuel prices.
