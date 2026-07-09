# Country Model Replication Playbook

How to replicate the US Economic Data Models for a new country, distilled from the
UK buildout (2026-07, commit `6da70d3`). Written for a future Claude Code session.
Remaining targets: **Canada, Japan, Australia, Germany, France, Italy**.
Companion artifacts: `docs/uk-models-mapping.md` (the mapping-doc template),
`server/src/scripts/verifyUkIngest.ts`, `client/src/data/ukProxyCaveats.ts`.

---

## 1. Overview & Philosophy

**Three phases, hard gates between them:**

1. **Phase 1 — Audit & Mapping** (no code changes): inventory the US models, map every
   element to a target-country equivalent or flag the gap, surface decisions. STOP.
2. **Phase 2 — Ingestion** (server only): collectors/config for approved series, backfill,
   per-series verification. STOP.
3. **Phase 3 — Frontend** (client): pages composed from shared components, badges,
   regression checks on touched US files.

The gates exist because errors compound: a wrong series mapping silently poisons every
downstream chart, and a broken ingest makes frontend debugging unfalsifiable. In the UK
run the Phase 1 gate caught the PCE decision (omit, don't proxy) and the Fiscal
restructure before any code existed; the Phase 2 gate caught a class of silent ingestion
failures (§3 pre-flight) before pages depended on the data.

**Diagnostic-first:** Phase 1 produces only `docs/<country>-models-mapping.md`. No code
until it is approved with explicit answers to the gate decisions.

**"Done" for a country (acceptance template):**
- Mapping doc complete; every US series classified DIRECT/PROXY/GAP; no unverified code ingested
- All ingested series show non-zero rows + current latest dates via a verify script; ≥3 series
  spot-checked against the source website
- Pages render real data under the hub country bars; every PROXY panel badged; deferred
  panels omitted (never stubbed); `tsc --noEmit` clean in both workspaces; vite build clean
- US pages untouched except approved shared-component refits, each refit consumer regression-checked
- Phase addenda appended to the mapping doc (the recovery anchor)

---

## 2. Phase 1 Playbook — Audit & Mapping

### 2.1 US inventory
Do NOT crawl. Anchors: `client/src/App.tsx` (routes), `client/src/pages/modelNav.ts`
(COUNTRIES/CATEGORIES), CLAUDE.md's key-file table. The US inventory already exists in
`docs/uk-models-mapping.md` §1a at panel granularity (panel | series IDs | transformation |
rendering component) — **reuse it verbatim**; re-audit only pages changed since commit
`6da70d3` (`git log --oneline -- client/src/pages/<Page>.tsx`).

### 2.2 Classification
- **DIRECT** — target-country equivalent exists. Record source, code, frequency, methodology
  deltas. UK example: CPIAUCSL → ONS `D7BT` (monthly, but NSA — a delta worth recording).
- **PROXY** — defensible substitute. Name it + the caveat that will become badge text.
  UK example: nonfarm payrolls → PAYE RTI payrolled employees (admin data, excl. self-employed).
- **GAP** — nothing reasonable. Recommend omit / restructure / defer. UK examples: PCE pages
  (omitted — no monthly deflator), DTS daily flows (restructured to monthly PSF).

### 2.3 UNVERIFIED discipline
**Never fabricate a series code.** Every code in the mapping doc is either verified live
(mark ✅ with method) or marked `UNVERIFIED` with the dataset it should live in. UK lessons:
- The pre-existing UK config contained ~17 dead ONS CDIDs and 11 dead BoE codes from earlier
  guide-based work (see memory note *uploaded-guides-often-missing-or-wrong*). Trust only the
  live API.
- ONS search: use exact `cdids=` filter, not free-text `q=` — free text ranks ambiguous CDIDs
  (e.g. `UTIL`) out of the results. Every source has an equivalent trap; find the exact-match
  discovery path first.
- Bulk enumeration beats one-at-a-time guessing: the ONS dataset CSV
  (`/file?uri=.../datasets/consumerpriceindices/current/mm23.csv`, rows 1–2 = Title/CDID)
  enumerated 37 CPI group codes authoritatively. StatCan/e-Stat/ABS/ECB equivalents: the
  collectors' `verifyMetadata` patterns (see §6) resolve codes against live DSDs/codelists.
- Verify **semantics, not just existence**: fetch the title/label and compare to the concept.
  Two UK BoE codes existed but meant different things than their config comments claimed.

### 2.4 Mapping doc contents (template = `docs/uk-models-mapping.md`)
Header with verification method legend + global caveats → §1a US inventory (reused) →
§1b per-model-area mapping tables → §1c proposed page tree + reuse/new-collector estimate →
summary counts + gate decisions. Terse tables, no prose.

### 2.5 Standard gate-decision categories (surface ALL of these, every country)
1. **Proxy-vs-omit calls** for each GAP-adjacent page (UK: PCE omitted)
2. **Structural restructures** where the country's data model differs (UK: Fiscal → PSF)
3. **Component parameterization scope** — largely settled now (§4.1), but confirm any NEW extraction
4. **Deferred sub-scrapers** — brittle Excel/PDF sources to explicitly punt (UK: DLUHC, Ipsos)
5. **Methodology divergences needing UI captions** (UK: NSA CPI → same-month-prior-year projection)
6. **PROXY disclosure text** — caveats drafted in the mapping doc, approved at the gate

### 2.6 Country-specific lookout list (known before Phase 1 runs)
- **Canada**: BoC core measures (CPI-trim/median/common) are published **YoY-only, no raw index**
  on table 18-10-0256 — rate-based panels only (index versions exist behind other vectors; verify
  before use, see `statcanCollector.ts` header). StatCan vectors churn across table restructures —
  re-verify empirically.
- **Japan**: "core" = **ex fresh food** (≠ US core = ex food & energy; the ex-food-and-energy
  concept is "core-core", cat01 `0178`). Tokyo advance CPI leads the national print — decide
  whether it becomes an extra panel. Unemployment NSA. e-Stat time codes need decoding
  (`decodeTimeCode` in `estatCollector.ts`).
- **Australia**: monthly CPI (from 2024-04, dataflow `CPI` v2) vs quarterly (long history; underlying
  measures in `CPI_Q`) — the monthly/quarterly transition runs through ~mid-2027 and quarterly
  **Trimmed Mean remains the RBA's reference**; pages must show both frequencies. The old `CPI_M`
  dataflow is dead (memory note *au-fundamental-model*).
- **Germany/France/Italy**: €STR/policy rates are **shared** (already ingested EA-wide). Two CPI
  families per country: HICP from ECB/Eurostat (cross-comparable; ECB `HICP` dataflow — the old
  `ICP` was discontinued Feb 2026, see `ecbCollector.ts` header) vs national CPI
  (Destatis VPI / INSEE IPC / ISTAT NIC). **No payrolls concept** — labor pages restructure around
  registered unemployment (BA), DARES/INSEE, ISTAT LFS. National fiscal data is quarterly
  Eurostat/national — expect a Fiscal restructure decision like the UK's.

---

## 3. Phase 2 Playbook — Ingestion

### 3.1 Config-first
Check whether an existing generic collector already covers the source before writing anything:
`ALL_ONS_SERIES` (`server/src/fetchAllOnsSeries.ts`), `ALL_BOE_SERIES`
(`server/src/fetchAllBoeSeries.ts`), and `server/src/collectors/{statcan,estat,abs,ecb}Collector.ts`
(each has a `SERIES` array + startup/cron wiring in `server/src/index.ts`). For those, ingestion =
appending verified entries. In the UK run ~130 of ~135 new series were config-only; only three
genuinely new feeds (new API shape or file format) earned collectors (`ukHpi.ts`,
`hmrcReceipts.ts`, `payeRti.ts`). Follow CLAUDE.md's Data Sync Pattern for new collectors
(table in `db.ts` → sync+getter module → route → register → non-blocking startup call).

### 3.2 Verification requirements
- Extend/clone `server/src/scripts/verifyUkIngest.ts`: for every configured series print
  row count + latest date + latest value; print `MISSING — 0 rows` loudly. Run until **0 missing**.
- Spot-check ≥3 headline series against the source website (UK run: D7BT/MGSX/ECY2 matched
  ONS to the decimal). Latest date must be current relative to the release calendar.
- Collectors must fail loudly on empty responses/parse misses (throw, don't warn) — the UK BoE
  bug survived years because failures were silent.

### 3.3 Storage principles
- **Store raw levels/indices**; compute YoY/MoM/annualized at the view layer
  (`client/src/lib/seriesTransforms.ts`). Exception: rates the source publishes ONLY as rates
  (BoC core YoY, published UK AWE growth) — store as published and label the unit.
- `better-sqlite3`, explicit PKs, `INSERT ... ON CONFLICT DO UPDATE` upserts, additive-only schema.
- Full-history-republished sources (Land Registry HPI, HMRC ODS, PAYE xlsx) need no incremental
  logic — re-download and upsert; gate on data age to avoid pointless downloads (`ukHpi.ts` pattern).

### 3.4 Pre-flight checklist for any new source (each item was a real UK bug)
1. **Date floors / all-or-nothing batches**: BoE IADB errors the ENTIRE multi-series request if
   `Datefrom` predates its floor (~1963) or if ANY code is invalid — and returns an HTML error
   page with HTTP 200. Monthly BoE data was silently empty since inception. → Before batching,
   test each code individually with a short date range; test the full batch with the production
   start date; treat non-CSV responses as errors.
2. **Dead/mislabeled inherited codes**: verify every pre-existing config entry for the country
   (existence AND title) before building on it. Grep the config for that country and run the
   verify script first.
3. **Discovery fragility**: if code→URI resolution goes through a search endpoint, use the
   exact-match parameter, and pin what happens for ambiguous strings. Prefer the collectors'
   `verifyMetadata`/first-run label-check pattern (ABS/e-Stat/StatCan) — it fails the sync when
   a code's label no longer matches the expected concept.

### 3.5 Deferral discipline
Defer (don't half-build): brittle Excel/PDF scrapers, codes still UNVERIFIED, sources needing
credentials not yet in `.env`. Every deferral goes in a **Phase 2 addendum** to the mapping doc
with the concrete unlock (URL verified, dataset named) — see the UK addendum's deferred list.

---

## 4. Phase 3 Playbook — Frontend

### 4.1 Shared components (parameterize, never copy)
Country-ready components (extracted from US pages in the UK run; consume `{date,value}[]`
regardless of source):
- `client/src/components/charts/SeriesExplorer.tsx` — the 5-chart E1–E5 explorer block
  (`frequency: 'monthly'|'quarterly'`)
- `client/src/components/charts/RatesChart.tsx` — YoY / annualized-N growth section
- `client/src/components/charts/ContribSection.tsx` — diverging stacked-bar contribution
  (feed it `ContribRow[]`; `buildContribSeries` in `seriesTransforms.ts` is for **additive
  current-price series only** — never chained-volume)
- `client/src/components/charts/FiscalYearOverlay.tsx` — multi-FY cumulative overlay
  (fiscal calendar parameterized via `monthLabels` + 1-based `periodIndex`)
- `client/src/lib/seriesTransforms.ts` — transforms, formatters, `TICK/TOOLTIP_STYLE/BRUSH_STYLE`
Exemplar page composing all of it: `client/src/pages/UKCPIContent.tsx`. If a country needs a
US-inline component not yet extracted, extract-and-refit the canonical US page (the
`<StirStripPage />` pattern), never fork. Current US consumers: `RetailSalesDashboardPage.tsx`,
`MtsPage.tsx`.

### 4.2 ProxyBadge
`client/src/components/ProxyBadge.tsx` + registry `client/src/data/ukProxyCaveats.ts`
(`{us, uk, caveat}` per key). Badge every panel consuming a PROXY series; text lives ONLY in the
registry, sourced from the mapping doc's caveat column. **Recommended for new countries:** create
a sibling per-country registry (`caProxyCaveats.ts`, …) with the same `ProxyCaveat` shape rather
than one country-keyed mega-file — the `uk` field name generalizes poorly; rename the fields to
`us`/`local`/`caveat` in new registries and pass through the same `<ProxyBadge>` (it renders
whatever caveat object it's given once the field is named consistently; adjust the component's
prop type if you rename fields — that is an approved parameterization, not a fork).

### 4.3 Rules
- **Omit-don't-stub**: deferred/GAP panels are not rendered at all — no empty states, no
  "coming soon" placeholders inside pages (UK: Housing has no SUPPLY tab, not a disabled one).
- **Methodology captions**: any model whose math differs from the US version carries a visible
  caption (UK: "Projection: same-month prior-year MoM pace (1y / 2y avg / 3y avg), NSA" on
  `UKCPIProjectionsContent.tsx`). Scenario tools are labeled "not a forecast".
- **Wiring**: no new routes — add a `country === '<key>'` branch with its own section bar +
  lazy imports in each hub (`InflationPage`, `LaborMarketPage`, `GrowthPage`, `FiscalPage`,
  `HousingPage`, `CreditPage`, `IndustrialProductionPage`). Keep UK/US section state separate
  (shared state breaks the other country's branch on switch-back). UK accent color `#14b8a6`;
  pick a distinct accent per country.

### 4.4 US-regression protocol
Track every US page refit onto a shared component as you go; after the refactor check ALL of
them, not a sample. Evidence stack used for the UK (no browser exists in this WSL env):
strict `tsc` + vite production build + the SSR smoke suite
`client/src/pages/renderSmoke.test.tsx` (`cd client && npx vitest run src/pages/renderSmoke.test.tsx`
— vitest is hoisted from the server workspace). Add every new country page to that suite.
Finish with a `git status`/`git diff --stat` scope check: US-file diffs must be exactly the
approved refits + hub wiring, nothing incidental.

### 4.5 Rendering pitfalls
- Keep all series keyed by ISO `YYYY-MM-01` dates — then lexicographic sort is chronological and
  no quarter-label comparator is needed. If you must sort labels like "2024 Q1", compare
  numerically year-then-quarter (`quarterCompare` — implement it; do not sort labels as strings).
- CVM/chained-volume categories are **not additive**: no summing, no client-computed
  contributions, no stacked charts (UK: `UKConsumptionContent.tsx` states this in its subtitle).
  Contributions for real GDP need published-contributions data.
- TypeScript strict, no `any` (recharts tooltip/label props need local prop types —
  see `FiscalYearOverlay.tsx` and the LabelList typing in `UKFiscalPSFContent.tsx`).
- Multi-series charts align by date-union `Map`s with nulls for missing dates (exemplar pattern).

---

## 5. Session & Context Management

**UK run shape:** one session ran all three phases with the gates as user turns. Rough effort:
Phase 1 ≈ a few hours wall-clock (7 parallel read-only agents for the US inventory + ~10 rounds
of live code verification); Phase 2 ≈ similar (config edits + 3 collectors + debugging the two
pre-existing sync bugs); Phase 3 was the largest (shared-component extraction + 2 US refits by
the main session, then 6 parallel agents each building 2–4 page files from a spec + exemplar,
then hub wiring + verification by the main session). The parallel-agent split works because page
files are disjoint; the main session owns all shared files (components, hubs, configs).

**Recovery anchors:** the mapping doc + its phase addenda + the phase-approval messages are
sufficient for a fresh session to resume any phase without re-auditing. Keep them current: append
an addendum at the END of each phase (what shipped, what was deferred and why, bugs found).

**Stopping at a clean boundary:** if context runs low, finish the current file/page, run
`tsc --noEmit`, and write a state summary containing: phase + step, files complete vs pending
(exact paths), verified-but-not-yet-ingested codes, decisions already taken, and the next
concrete action. Put durable cross-country lessons in auto-memory
(see `memory/uk-data-ingestion.md` for the shape).

---

## 6. Per-Country Quick-Reference Stubs

Verified identifiers below come from the working collectors in `server/src/collectors/` —
everything else is **to be verified in Phase 1**. Each collector header documents its
empirically-resolved IDs and warns that prior guide docs were wrong; read it before extending.

### Canada — StatCan WDS (no auth) + Bank of Canada Valet (no auth)
- Working: `statcanCollector.ts` → CPI headline `v41690973` (NSA index, table 18-10-0004),
  CPI ex-food-energy `v41691233`, BoC core CPI-trim `v108785715` / median `v108785714` /
  common `v108785713` (all **YoY-only**, table 18-10-0256), unemployment `v2062815` (SA, 14-10-0287).
- Gotchas: BoC core = rates not indices (rate-based panels; possible index vectors
  `v1481215116`/`v1481215115` noted in the collector header — verify); vectors churn on table
  restructures — resolve empirically, never from guides. LFS is a true monthly survey (unlike UK).
- Phase 1 to verify: GDP by industry (36-10-0434), retail (20-10-0008), IPPI, SEPH payrolls,
  housing (CMHC starts, Teranet/CREA), fiscal (Fiscal Monitor — likely a UK-style restructure).

### Japan — e-Stat (requires `ESTAT_APP_ID` in `.env`) + BoJ / Cabinet Office
- Working: `estatCollector.ts` → CPI statsDataId `0003427113` (headline cat01 `0001`, core-ex-fresh-food
  `0161`, core-core `0178`), unemployment `0003005865` (NSA). Time codes need `decodeTimeCode`;
  throttle ~3 req/s.
- Gotchas: core definitions differ from US (§2.6); Tokyo advance CPI; many key releases
  (Tankan, machinery orders) live outside e-Stat.
- Phase 1 to verify: GDP (Cabinet Office SNA), IP (METI), labour cash earnings (MHLW), trade
  (customs), fiscal (MoF).

### Australia — ABS SDMX (no auth)
- Working: `absCollector.ts` → monthly CPI flow `CPI` keys `1.10001.10.50.M` (headline),
  `1.999902.20.50.M` (trimmed), `1.999903.20.50.M` (weighted median); quarterly `1.10001.10.50.Q`
  (flow `CPI`) and `CPI_Q` for quarterly trimmed/median; unemployment flow `LF` key
  `M13.3.1599.20.AUS.M`. First-run DSD label verification is built in (`verifyMetadata`) — reuse it.
- Gotchas: monthly/quarterly CPI dual-track through ~mid-2027, quarterly trimmed mean is the RBA
  reference; URLs omit dataflow versions (ABS rejects `latest`); dead `CPI_M` dataflow trap.
- Phase 1 to verify: national accounts, retail trade, WPI (wages), labour account, housing
  (CoreLogic is private — expect GAPs), fiscal.

### Germany / France / Italy — ECB+Eurostat (no auth) · Destatis GENESIS (registration) · INSEE (no auth) · ISTAT
- Working: `ecbCollector.ts` → euro-area HICP headline/core/supercore + EA unemployment from the
  ECB `HICP` dataflow (post-Feb-2026 migration; old `ICP` is discontinued — header documents the
  key shape). Per-country HICP series exist in the same dataflow family (swap the `U2` area code)
  — verify keys empirically.
- Gotchas: shared €STR/policy path (already in `overnight_rates`); national-CPI vs HICP duality
  (pick HICP as primary for cross-country comparability, national CPI on an "Other" tab); no
  payrolls concept — restructure labor around registered unemployment/LFS; Destatis GENESIS needs
  a registered user token; fiscal is quarterly Eurostat (`gov_10q_ggnfa`-family — verify).
- Phase 1 to verify: everything beyond HICP/unemployment — Destatis (VPI, IP `42153`-family,
  Ifo is private), INSEE BDM series, ISTAT SDMX.

---

## Closing Addendum (2026-07-08) — Program Complete: Eight Countries

US, UK, Canada, Japan, Germany, France, Italy, Australia — every country in the nav is live.
The consolidated deferred-items backlog lives in `docs/au-models-mapping.md` (Phase 3 addendum),
and the full gap/omission fate of every US panel across all seven replications is in
`docs/gaps-and-omissions.md` (master matrix + per-country detail).
Lessons from the final run worth carrying to any future source integration:

1. **Derive tolerances, don't tune them.** Australia's GDP contributions-sum assertion failed
   honestly (99/159 quarters) until the missing statistical-discrepancy component was added and
   the tolerance DERIVED from first principles (nine values published to 0.1pp → 0.45pp
   worst-case envelope; observed worst 0.40). A tuned tolerance would have hidden the missing
   component. Assertions should encode arithmetic, not vibes.
2. **Dual-frequency design (the AU CPI pattern).** When one concept lives at two frequencies on
   different bases: distinct series codes + a frequency column at the schema layer; [MONTHLY]/
   [QUARTERLY] tags in every panel title; levels never share an axis across bases (rates are
   base-invariant and may overlay); long-history panels key off the long series; the young
   series carries its floor caption everywhere it appears.
3. **Dead feeds are a first-class mapping outcome.** Three live ABS discontinuations (Retail
   Trade, Payroll Jobs, RPPI) each changed a page's shape. The pattern held in Japan (MLS/
   retail/housing frozen DB) and the EU (dead ICP dataflow). Always check the LATEST period,
   not just series existence — and encode staleness thresholds so tomorrow's discontinuation
   announces itself.
4. **Inputs determine the model's frequency.** The labor-projection tab was omitted for the EU3
   (quarterly inputs) and built for Australia (monthly inputs) — one principle, applied twice,
   recorded once.
5. **Rates-side collectors are reconnaissance.** Every country's hardest discovery question had
   already been answered empirically by the small rates-side collector (JP time codes, EU dead
   dataflow + migration, AU dual-frequency flows + version-URL quirk). Read the sibling first.
6. **Preserve fallback coverage synthetically.** With no contentless country left, the nav's
   coming-soon path would have silently lost test coverage — a vi.mocked synthetic country
   (navFallback.test.tsx) keeps the future-country path exercised.
