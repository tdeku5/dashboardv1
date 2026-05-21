# SOFR Forward Pricing — Summary Table Methodology

This document describes how the Summary Table on the **US → Rates → Forward Pricing → 3M SOFR** tab is computed. It traces every value back to its source (database row, configuration constant, or derived calculation) and points at the specific files/lines that produce it. No proposed changes — pure documentation of the current implementation.

---

## 1. Overview

The Summary Table shows the **implied policy-rate path** that 3-Month SOFR (SR3) futures prices are pricing in, one row per upcoming FOMC meeting. The first row is **Overnight Cash** (today's policy lower bound); subsequent rows show, for each future FOMC meeting in the visible window, the implied policy rate after that meeting, the step change in basis points, the cumulative change from spot, and probability-style summaries of each move.

Data sources:

| Input | Source |
| --- | --- |
| SR3 futures prices (per-contract close) | SQLite `tv_series` table, symbols `SR3{H,M,U,Z}{year-digit}` |
| Current O/N SOFR | SQLite `series_observations` table, `series_id = 'SOFR'` (FRED) |
| Current EFFR (used to derive policy lower bound) | SQLite `series_observations` table, `series_id = 'DFF'` (FRED) |
| FOMC meeting calendar | Hardcoded constant `CB_MEETINGS.FED` in `server/src/cbMeetings.ts` |
| Market configuration (anchor, alignment flag) | `STIR_MARKETS[marketKey='SR3']` in `server/src/stirRegistry.ts` |

The "implied policy path" is constructed by:

1. Identifying the **reference quarter** for each visible SR3 contract (CME convention: 3rd Wed of `delivery_month − 3` inclusive, to 3rd Wed of `delivery_month` exclusive).
2. Reading each contract's observed implied rate `R = 100 − price`.
3. Solving a **cross-contract day-weighted least-squares system** for the per-FOMC-meeting rate change `Δ_m`, treating each meeting's `Δ_m` as a single value that affects every subsequent contract proportionally to the days of overlap.
4. Adding a constant **SOFR-to-policy spread** (= the 20-day median of `floor(EFFR, 25bp) − SOFR`) to convert implied SOFR rates into implied policy lower-bound rates.
5. Rendering the rates and a few derived quantities as table columns.

The implementation uses a **simple-average model** of contract settlement (`avg = Σ d_i r_i / D`) inside the LSQ solver — not the full compounded settlement formula. The compounded formula is implemented elsewhere in the lib but is only exercised in unit tests and in the legacy per-contract equal-split path used by non-SOFR markets. See §9 for the implication.

---

## 2. Data inputs

### 2.1 SR3 futures contract prices

- **Source**: SQLite `tv_series` table.
- **Symbol format**: `SR3` + CME month code (`H`=Mar, `M`=Jun, `U`=Sep, `Z`=Dec) + single year digit (e.g. `SR3M6` = June 2026 delivery, `SR3H7` = March 2027). The year-digit-to-year mapping lives in `server/src/tvFutures.ts:78-86`: digit `5` → 2025, digit `0` → 2030 (`digit >= 5 ? 2020 + digit : 2030 + digit`).
- **Units**: futures price (e.g. `96.585`); implied rate is `100 − price` in percent.
- **Freshness**: each contract's latest close at-or-before the request's `asOfTs`. The server picks `asOfTs` as either an explicit query parameter (`?date=YYYY-MM-DD`) or the latest timestamp seen across any symbol with the `SR3%` prefix (see `server/src/tvFedWatch.ts:200-219`).
- **If missing**: `getContractPrice` returns `null` and that contract is silently skipped in the LSQ (`server/src/tvFedWatch.ts:570-571`). If no SR3 prices exist at all the function returns an empty response.

> **Naming note.** Several places in the codebase (and the methodology spec) refer to `tv_ohlcv`. The live SR3 data is actually in `tv_series` (`tv_ohlcv` exists in the schema but the FedWatch code path doesn't query it).

### 2.2 Current O/N SOFR

- **Source**: `series_observations` table, `series_id = 'SOFR'` (FRED daily fixing).
- **Units**: percent (e.g. `3.50`).
- **Freshness**: latest available calendar date. The spread calculation reads the **most recent 20 rows** ordered by `date DESC` (`server/src/tvFedWatch.ts:298-302`); the most recent is also reported as "spot" in the spread-source string.
- **If missing**: `resolveSpread` returns `{ spread: 0, spreadSource: '' }` and the SOFR-to-policy translation becomes a no-op (`server/src/tvFedWatch.ts:307-309`). The Summary Table still renders, but using raw SOFR-implied rates instead of policy-translated rates.

### 2.3 Current Fed policy lower bound

- **Source**: derived. The code reads the latest `DFF` (daily fed funds effective) observation and floors it to the 25 bp grid:
  ```ts
  policyLower = Math.floor(DFF / 100 / BPS_STEP) * BPS_STEP
  // where BPS_STEP = 0.0025 (decimal), defined in lib/fedwatch.ts
  ```
  This appears in two places: `server/src/tvFedWatch.ts:236-242` (for setting the LSQ anchor) and `:303-310` (for the spread calculation).
- **Units**: decimal (e.g. `0.035` = 3.50%).
- **If missing**: `getTvFedWatch` falls back to whatever the `STIR_MARKETS.SR3.anchorSource` reads (currently FRED `SOFR` itself, see §2.4); the per-meeting calculation continues using `rawAnchor` instead of the floor-of-EFFR value.

### 2.4 Anchor rate (passed through to the LSQ as `proxyAnchor`)

- **Source**: configured per market in `STIR_MARKETS`. For SR3:
  ```ts
  anchorSource: { type: 'fred', seriesId: 'SOFR' }
  ```
  (`server/src/stirRegistry.ts:65`)
- The handler reads it via `getAnchorRate` (`server/src/tvFedWatch.ts:120-131`) and stores it as `rawAnchor` (decimal). `rawAnchor` is then surfaced as `currentEFFR` in the response — the field name is historical (the same code path serves Fed Funds where it would actually be EFFR).
- For SR3 the **tree anchor** (`anchorRate`) is overridden to `floor(DFF, 25bp)` (the policy lower bound) so the matrix aligns with the policy grid (see §4). The original SOFR anchor is preserved as `proxyAnchor` and used for the "CURRENT SOFR" banner display.

### 2.5 FOMC meeting calendar

- **Source**: hardcoded constant `CB_MEETINGS.FED` in `server/src/cbMeetings.ts:8-18`.
- **Format**: ISO date strings (single date per meeting; two-day meetings use the announcement day).
- **Coverage at the time of writing**: 2025-01-29 through 2027-12-15. Past meetings are filtered out by `meetings.filter(m => m > resolvedDate)` (`server/src/tvFedWatch.ts:253`).
- **If missing**: empty `CB_MEETINGS.FED` would short-circuit `getTvFedWatch` to an empty response (`:194-196`). There's no live ingestion — the calendar is maintained by editing the file.

### 2.6 Configuration: market entry for SR3

`server/src/stirRegistry.ts` defines:

```ts
{
  marketKey: 'SR3',
  country: 'US',
  displayName: '3M SOFR',
  shortName: 'SOFR',
  rateLabel: 'CURRENT SOFR',
  tickerPrefix: 'SR3',
  cadence: 'quarterly',
  yearDigits: 1,
  anchorSource: { type: 'fred', seriesId: 'SOFR' },
  centralBank: 'FED',
  proxyToPolicySpreadSource: { type: 'live-sofr-policy' },
  policyAlignment: 'shift-tree',
}
```

The two flags that drive SR3-specific behaviour are `proxyToPolicySpreadSource: 'live-sofr-policy'` (triggers the 20-day-median spread) and `policyAlignment: 'shift-tree'` (triggers the cross-contract LSQ path and the policy-units rate display).

---

## 3. Reference quarter definition

The reference-quarter logic is in `server/src/lib/sr3Settlement.ts`.

### 3.1 Convention

For an SR3 contract with delivery month $X$ (a year + month index), the **reference quarter** is

$$
\text{RQ} = [\,\text{3rdWed}(X - 3 \text{ months})\;\text{inclusive},\;\;\text{3rdWed}(X)\;\text{exclusive}\,)
$$

— i.e. the 3rd Wednesday of the month three months before delivery (inclusive) up to but not including the 3rd Wednesday of the delivery month. This matches the CME contract spec.

### 3.2 3rd-Wednesday calculation

`thirdWednesday(year, monthIndex)` (`server/src/lib/sr3Settlement.ts:32-37`):

```ts
const first = new Date(Date.UTC(year, monthIndex, 1))
const day = first.getUTCDay()           // 0=Sun … 3=Wed
const offset = (3 - day + 7) % 7        // days from the 1st to the 1st Wednesday
return new Date(Date.UTC(year, monthIndex, 1 + offset + 14))
```

All dates are UTC; there is no timezone handling beyond UTC.

### 3.3 Day enumeration and weighting

`referenceQuarter(deliveryYear, deliveryMonthIndex)` (`server/src/lib/sr3Settlement.ts:57-101`) enumerates every calendar day in $[\,\text{start},\,\text{endExclusive}\,)$ and assigns each business day a `dayWeight`:

- Mon–Thu business day: `dayWeight = 1`.
- Fri business day: `dayWeight = 3` (carries Sat + Sun).
- Sat/Sun: `isBusinessDay = false`, `dayWeight = 0` (their weight is folded into the prior Fri).

Federal holidays are **not** modelled. A federal holiday in the middle of the week is still treated as a business day with `dayWeight = 1`; the day before it gets no extra weight. The header comment (`server/src/lib/sr3Settlement.ts:22-27`) acknowledges this and estimates the error at ~1 bp/year.

`totalCalendarDays` (≡ $D$ in the CME formula) is the sum of all `dayWeight` values and equals the number of calendar days in the RQ.

### 3.4 Worked: SR3M6 reference quarter

- Delivery: Jun 2026 (monthIndex `5`).
- Prior month with index `5 − 3 = 2` → March 2026.
- $\text{3rdWed}(2026,\,2) = $ 18 Mar 2026.
- $\text{3rdWed}(2026,\,5) = $ 17 Jun 2026.
- RQ = `[2026-03-18, 2026-06-17)`. `totalCalendarDays = 91`.

---

## 4. Spread calculation

Defined in `resolveSpread` (`server/src/tvFedWatch.ts:274-328`).

For SR3 (`proxyToPolicySpreadSource.type === 'live-sofr-policy'`):

1. Read the 20 most recent rows of `series_observations` where `series_id = 'SOFR'` (lines 298-302).
2. Read the single most recent row where `series_id = 'DFF'` (lines 303-306).
3. Compute the **policy lower bound** as `policyLower = floor(DFF / 100, 0.0025)` (decimal).
4. For each of the 20 SOFR rows, compute the diff `r/100 − policyLower` (a small positive number when SOFR sits above the lower bound, near zero or negative when SOFR sits at the bound).
5. Take the **median** of those 20 diffs (`medianDiff`).
6. Define
   ```ts
   spread = -medianDiff   // internal sign convention: policy − proxy
   ```
   So with SOFR typically a few bp above policy, `medianDiff` is positive and the internal `spread` is **negative** (policy is below proxy).
7. The "spot" diff (most recent SOFR − policy) is computed alongside the median for the spread-source display string.

### Why median, not spot

The header comment on `resolveSpread` (`:292-297`) notes that SOFR can sit unusually low on any given day (today's spot can equal `policyLower`), so the spread should reflect the *typical* forward SOFR-vs-policy gap rather than today's spot. The 20-day median smooths through quarter-end / month-end spikes.

### How the spread is applied

Two places consume `spread`:

1. **`getImplied`** (`server/src/tvFedWatch.ts:259-265`) for shift-tree markets returns `(100 − price)/100 + spread` so callers (probability buckets, target-range labels) see policy-units rates.
2. **The LSQ branch** in `computeQuarterlyFedWatch` (`:570-580`) does the inverse — it strips the spread back out to get raw SOFR-implied R for the regression, then re-adds the spread when producing per-meeting rates for the response (`:597-598`).

In effect: the LSQ regression runs in **SOFR (proxy) units**; the response is emitted in **policy units** (proxy + spread).

### Surfacing in the UI

The spread source string (built at `:325`) is:

```
Spread: +{medianDiffBp} bp · 20d median of SOFR − policy (spot +{spotDiffBp} bp) · multi-meeting decomposition: cross-contract day-weighted LSQ · as of {date}
```

This string is sent in the API response as `proxyToPolicySpreadSource` but **is not currently displayed on the SOFR tab** — the matrix subtitle that would render it was gated to Fed-Funds-only in a prior iteration. It remains observable via the network response or via `/api/futures/fedwatch?market=SR3`.

---

## 5. Per-meeting rate decomposition

The SR3 path lives in the `if (useShiftTree)` branch of `computeQuarterlyFedWatch` (`server/src/tvFedWatch.ts:534-623`). The math primitives are in `server/src/lib/sr3Settlement.ts`.

### 5.1 Meeting → contract attribution

`containingContract(meetingDateUtc)` (`server/src/tvFedWatch.ts:477-497`) returns the delivery month of the SR3 contract whose reference quarter **contains** the meeting. The rule: find the first quarterly month $X$ in chronological order such that $\text{3rdWed}(X) > \text{meetingDate}$, i.e. the contract whose RQ ends after the meeting.

- A meeting that falls **on** RQ_start is treated as inside that contract (the `>` test is strict, so the prior contract — whose RQ_end equals the meeting date — is rejected).
- A meeting that falls **on** RQ_end belongs to the **next** contract.

For the current SR3 calendar:

| Meeting | Containing contract |
| --- | --- |
| 2026-06-17 (= 3rdWed Jun) | SR3U6 (RQ `[Jun 17, Sep 16)`) |
| 2026-07-29 | SR3U6 |
| 2026-09-16 (= 3rdWed Sep) | SR3Z6 |
| 2026-10-28 | SR3Z6 |
| 2026-12-09 | SR3Z6 |
| 2027-01-27 | SR3H7 |
| 2027-03-17 (= 3rdWed Mar) | SR3M7 |
| ... | ... |

Note that 2026-06-17 is exactly RQ_start of SR3U6, so it's included in U6's RQ (not M6's). The SR3M6 RQ `[Mar 18, Jun 17)` contains **zero** future meetings as of mid-May 2026 (the only FOMC date inside is 2026-03-18, which is past).

### 5.2 Contracts included in the LSQ

The LSQ includes **every** quarterly SR3 delivery month $X$ such that:

- $\text{3rdWed}(X) > \text{resolvedDate}$ (i.e. the RQ has not fully ended), and
- $\text{3rdWed}(X - 3) \leq \text{lastMeetingDate} + 30\text{ days}$ (i.e. the RQ starts within the visible window).

See `server/src/tvFedWatch.ts:549-567`. Contracts whose price isn't available in `tv_series` are silently skipped (`:570-571`). Notably, **contracts with zero meetings in their RQ are still included** — the front contract (SR3M6 today) has no future meetings inside its RQ but its observed price still constrains $r_0$ via the regression's constant column.

### 5.3 The model

The LSQ assumes that a contract's compounded settlement is well-approximated by a simple weighted average of daily rates:

$$
\text{observed\_R}_c \;\approx\; r_0 + \sum_{m=1}^{M} \Delta_m \cdot \frac{\text{overlap}(m, c)}{D_c}
$$

where:

- $r_0$ is the rate at the start of the visible window (a free parameter — see §5.4),
- $\Delta_m$ is the rate change at FOMC meeting $m$ (percent),
- $D_c$ is the calendar-day length of contract $c$'s RQ,
- $\text{overlap}(m, c)$ is the number of calendar days in $[s_c, e_c)$ that fall on or after the meeting:
  $$
  \text{overlap}(m, c) = \begin{cases} 0 & \text{if } m \ge e_c \\ D_c & \text{if } m \le s_c \\ e_c - m & \text{otherwise} \end{cases}
  $$
- All rates and $\Delta$s are in **percent units** (`3.50` = 3.50%).

This is the **simple-average** approximation. The fully-compounded CME formula

$$
R = \left[\prod_i \left(1 + \frac{d_i}{360}\cdot\frac{r_i}{100}\right) - 1\right]\cdot\frac{360}{D}\cdot 100
$$

is implemented in `computeSR3Settlement` (`server/src/lib/sr3Settlement.ts:113-124`) but **is not called by the LSQ path**. The convexity premium between the two formulations is typically 1–3 bp at current rate levels (see §9).

### 5.4 The solver

`decomposeAcrossContracts` (`server/src/lib/sr3Settlement.ts:251-312`) builds the design matrix and solves the regularised normal equations:

$$
(A^\top A + \lambda I')\, x = A^\top y
$$

- $A$ is $N \times (M+1)$: $N$ contracts, $M+1$ unknowns ($r_0$ plus $M$ meeting deltas).
- Column 0 of $A$ is all-ones (the $r_0$ column).
- Column $j > 0$ of $A$ at row $c$ is $\text{overlap}(m_j, c) / D_c$.
- $y_c$ is the contract's observed $R$.
- $I'$ is identity-on-the-$\Delta$-block, zero on the $r_0$ slot: only the meeting deltas are regularised.
- $\lambda = 0.01$ (caller-supplied default; see `server/src/tvFedWatch.ts:585`).

The system is solved via in-place Gaussian elimination with partial pivoting (`solveLinearSystem`, `:315-344`). If a pivot is too small (`< 1e-15`) the solver returns a vector of zeros.

The solver returns three arrays:

- `r0`: best-fit starting rate (percent).
- `deltas[i]`: $\Delta_{m_i}$ for the $i$-th meeting (percent).
- `postRates[i]`: cumulative `r0 + Σ_{j≤i} deltas[j]` (percent).

### 5.5 Carry-forward into the response

After the solve, the SR3 branch walks each future meeting in chronological order (`server/src/tvFedWatch.ts:591-622`):

```ts
preRateProxy = (i === 0 ? lsq.r0 : lsq.postRates[i - 1]) / 100   // decimal
postRateProxy = lsq.postRates[i] / 100                            // decimal

effrStart = preRateProxy  + proxyToPolicySpread     // policy units (decimal)
effrEnd   = postRateProxy + proxyToPolicySpread
expectedChange = effrEnd - effrStart                // = lsq.deltas[i] / 100 (decimal)
```

The meeting row is then pushed onto the response with:

- `effrStart`, `effrEnd` stored as percent (× 100).
- `expectedChange` stored as bps (× 10000).
- `calcSource: 'sr3-lsq:day-weighted'`.

### 5.6 What happens for non-SR3 quarterly markets

When `alignment` is not `'shift-tree'` (i.e. for SO3 / EUR / CRA / TOA3 / AUS), `computeQuarterlyFedWatch` falls through to a **per-contract equal-split** path (`:624-681`). For each contract:

1. Find FOMC meetings in its RQ.
2. Call `decomposeContract` (`server/src/lib/sr3Settlement.ts:158-197`), which binary-searches a single $\Delta$ that, when applied at every meeting in the RQ, reproduces the contract's compounded $R$ via `computeSR3Settlement`.
3. Assign post-meeting rates as `rPre + (i+1) × Δ` — every meeting in the same contract gets the **same** $\Delta$.

This is the legacy path. Its `decomposeContract` does use the compounded formula (not the simple-average), but its equal-split assumption produces paired-identical Bps (Step) values for meetings inside the same RQ. The SR3 (shift-tree) path does not use this function.

---

## 6. Summary Table column derivation

The Summary Table is rendered in `client/src/pages/STIRDashboardPage.tsx`. The rows fed to it are:

- One **Overnight Cash** row (`overnightRow`, `:1177-1189`).
- One row per future FOMC meeting (`summaryRows`, `:1125-1175`), filtered to meetings on or before 2027-12-31.

All numeric values come from the server's `TvFedWatchResponse` (the `fedwatch` hook return, see `client/src/hooks/useFedWatch.ts`).

### 6.1 Column-by-column

| Column | Source | Formula |
| --- | --- | --- |
| **Meeting** | `row.label` | Overnight: literal `'Overnight Cash'`. Meeting rows: `meeting.meetingMonth` from server, formatted as `'<MON> <YYYY>'` (e.g. `JUN 2026`). Built at `server/src/tvFedWatch.ts:612` via `${MONTH_NAMES[mIdx]} ${mYr}`. |
| **Implied Rate** | `row.impliedRate` | Overnight: `fedwatch.currentPolicyRate \|\| fedwatch.currentEFFR` — for SR3 this is `floor(DFF, 25bp)` in percent, i.e. the policy lower bound. Meeting rows: `meeting.effrEnd` (percent), which is the LSQ's `postRates[i]` already shifted to policy units. Rendered via `fmtRate` (`row.impliedRate.toFixed(3)`, `:451-453`). |
| **Bps (Step)** | `row.stepBps` | Overnight: `0`. Meeting rows: `meeting.expectedChange` directly (server pre-computes `(effrEnd − effrStart) × 10000`, which equals the per-meeting `Δ` in bps). Rendered via `fmtBps` (`'+/-' + .toFixed(1)`, `:461-464`). Coloured green/red/grey by sign. |
| **Bps (Total)** | `row.totalBps` | Overnight: `0`. Meeting rows: `(meeting.effrEnd − fedwatch.currentPolicyRate) × 100` (percent difference × 100 = bps). Note: this uses `currentPolicyRate`, NOT `currentEFFR` — both `effrEnd` and `currentPolicyRate` share the same units (policy in shift-tree). |
| **Implied # Cuts/Hikes** | derived | `row.stepBps / 25`, formatted with `fmtSignedDecimal` (`:466-470`): collapses to `0.0` when `|v| < 0.05`; otherwise `'+/-' + .toFixed(1)`. |
| **Summary** | derived | `summaryFromBps(row.stepBps)` (`:478-488`): `|stepBps| / 25 × 100%`, suffixed with `Hike` (positive), `Cut` (negative), or `Flat` (`|stepBps| < 0.05`). One decimal place. |
| **Summary (Total)** | derived | `summaryFromBps(row.totalBps)`. Same format; can exceed 100% (e.g. `120.8% Hike` is correct — it means the cumulative implied move equals 1.208 of a 25-bp move). |

### 6.2 Coloring

| Tone | Class | When |
| --- | --- | --- |
| green (`hikeText` / `hike` badge) | `> +0.01 bp` step or total | hike |
| red (`cutText` / `cut` badge) | `< -0.01 bp` | cut |
| neutral (`flatText` / `flat`) | otherwise | flat |

Tones are decided by `toneFromBps` (`:472-476`) for the step column and inline (`:2925`) for the total column.

### 6.3 Data flow

```
SR3 prices (tv_series) + SOFR/DFF (series_observations) + FOMC calendar (cbMeetings.ts)
        │
        ▼
getTvFedWatch (tvFedWatch.ts) ── resolveSpread ──► spread (decimal)
        │                                            │
        ▼                                            ▼
computeQuarterlyFedWatch ── shift-tree branch ──► decomposeAcrossContracts (sr3Settlement.ts)
        │                                            │
        │                                       LSQ solve: (AᵀA + λI') x = Aᵀy
        │                                            │
        │ for each meeting m:                        ▼
        │   preRate, postRate ← lsq.postRates[i-1..i] / 100
        │   effrStart = preRate + spread
        │   effrEnd   = postRate + spread
        │   expectedChange = (effrEnd - effrStart) × 10000     ← Bps (Step)
        ▼
TvFedWatchResponse { meetings: [{ effrStart, effrEnd, expectedChange, ... }], currentPolicyRate, ... }
        │
        ▼ (GET /api/futures/fedwatch?market=SR3)
useFedWatch (hooks/useFedWatch.ts)
        │
        ▼
STIRDashboardPage.tsx:
   summaryRows = fedwatch.meetings.map(m => ({
      impliedRate: m.effrEnd,
      stepBps: m.expectedChange,
      totalBps: (m.effrEnd - fedwatch.currentPolicyRate) × 100,
      stepSummary: summaryFromBps(stepBps),
      totalSummary: summaryFromBps(totalBps),
   }))
        │
        ▼
   <table> rendered with [overnightRow, ...summaryRows]
```

---

## 7. Worked example

Snapshot at the time of writing (as-of 2026-05-20):

- O/N SOFR (latest, FRED `SOFR`): `3.50%`
- DFF (latest): `3.62%` → `policy_lower = floor(3.62%, 25bp) = 3.50%`
- 20-day SOFR/policy diff median ≈ `+10.5 bp` → internal `spread = -0.00105` (decimal)
- `currentPolicyRate` = `3.5000%`

Observed SR3 prices and implied $R$ (= `100 − price`, in percent):

| Contract | Reference quarter | Price | $R$ (%) |
| --- | --- | --- | --- |
| SR3M6 | [2026-03-18, 2026-06-17) | 96.510 | 3.490 |
| SR3U6 | [2026-06-17, 2026-09-16) | 96.585 | 3.415 |
| SR3Z6 | [2026-09-16, 2026-12-16) | 96.605 | 3.395 |
| SR3H7 | [2026-12-16, 2027-03-17) | 96.580 | 3.420 |
| SR3M7 | [2027-03-17, 2027-06-16) | 96.520 | 3.480 |
| SR3U7 | [2027-06-16, 2027-09-15) | 96.450 | 3.550 |
| SR3Z7 | [2027-09-15, 2027-12-15) | 96.390 | 3.610 |
| SR3H8 | [2027-12-15, 2028-03-15) | 96.335 | 3.665 |

Future FOMC meetings inside the window: Jun 17, Jul 29, Sep 16, Oct 28, Dec 9 (2026), Jan 27, Mar 17, May 5, Jun 16, Jul 28, Sep 15, Oct 27, Dec 15 (2027).

### One equation: SR3U6

- $D_{\text{U6}} = 91$ days (Jun 17 → Sep 16).
- Meetings inside U6's RQ: Jun 17 (boundary, included) and Jul 29.
- Overlap weights:
  - $\text{overlap}(\text{Jun 17}, \text{U6}) = $ Sep 16 − Jun 17 = 91 days → weight $91 / 91 = 1.0$
  - $\text{overlap}(\text{Jul 29}, \text{U6}) = $ Sep 16 − Jul 29 = 49 days → weight $49 / 91 \approx 0.538$
  - Every later meeting has overlap 0 with U6.

The U6 row of the LSQ equation is:

$$
3.415\% \;=\; r_0 \;+\; 1.0 \cdot \Delta_{\text{Jun17}} \;+\; 0.538 \cdot \Delta_{\text{Jul29}} \;+\; 0 \cdot (\text{later } \Delta s)
$$

### Other equations

- SR3M6 has no future meetings inside its RQ ⇒ row is `3.490 = r_0 + 0 + 0 + …`. This pins $r_0$ near 3.49%.
- SR3Z6 contains Sep 16, Oct 28, Dec 9 plus has full overlap (= 1) with Jun 17 and Jul 29 (both before Z6's RQ_start). Its row uses weights computed from $D_{\text{Z6}} = 91$ days:
  $$
  3.395\% = r_0 + 1.0 \cdot \Delta_{\text{Jun17}} + 1.0 \cdot \Delta_{\text{Jul29}} + 1.0 \cdot \Delta_{\text{Sep16}} + \tfrac{49}{91}\cdot\Delta_{\text{Oct28}} + \tfrac{7}{91}\cdot\Delta_{\text{Dec09}}
  $$
- Similar rows for H7, M7, U7, Z7, H8.

### Solve

Stacking all 8 contracts gives a $8 \times 14$ design matrix ($r_0$ plus 13 meeting columns). The LSQ solves the regularised normal equations with $\lambda = 0.01$ on the $\Delta$ block. With 8 equations and 14 unknowns, the back of the curve is under-determined and the Tikhonov regulariser shrinks those $\Delta$s toward zero; the front of the curve is well identified.

### Building the Summary rows

For each future meeting in order:

- `preRateProxy` = previous `postRate` (or `r_0` for the first meeting), in percent.
- `postRateProxy` = `lsq.postRates[i]`, in percent.
- `effrStart` = `(preRateProxy + spread × 100) / 100` × 100 → percent in response.
- `effrEnd` = same with `postRateProxy`.
- `expectedChange` = `lsq.deltas[i]` × 100 (bps), stored verbatim as `stepBps`.

The client then renders:

- `impliedRate` = `effrEnd` (e.g. `3.470` if LSQ says Jun 17 post-rate is 3.470%).
- `stepBps` = `expectedChange` (e.g. `+3.8`).
- `totalBps` = `(effrEnd − currentPolicyRate) × 100` = `(3.470 − 3.500) × 100` = `−3.0`.
- `Implied # Cuts/Hikes` = `stepBps / 25` = `+0.2`.
- `Summary` = `summaryFromBps(+3.8)` = `15.2% Hike`.
- `Summary (Total)` = `summaryFromBps(−3.0)` = `12.0% Cut`.

The exact numerical outputs depend on running the LSQ — the example above illustrates the *shape* of the computation, not specific rendered values.

---

## 8. Edge cases and limitations

| Situation | Handling |
| --- | --- |
| **RQ already started (e.g. SR3M6 today)** | The contract is still included in the LSQ. Its observed $R$ blends realised and implied SOFR over the RQ, but the model treats the whole RQ as implied at $r_0$. Header comment in `computeQuarterlyFedWatch` (lines 452-456) calls this out as an accepted v1 simplification (~< 2 bp error for the front contract). |
| **Stale SR3 contracts at the back** | If `getContractPrice` returns `null` for a contract, that contract is silently dropped from the LSQ (`server/src/tvFedWatch.ts:570-571`). Contracts with no observed price contribute neither an equation nor a constraint. |
| **Meeting on RQ_start exactly** | Included in the new contract (the one whose RQ starts on that date). The `containingContract` test `refQuarterEnd > meeting` is strict, so the meeting can't be attributed to the prior contract. The overlap formula gives that meeting weight `D_c / D_c = 1.0` for the contract whose RQ starts on it. |
| **Meeting on RQ_end exactly** | Cannot happen for an SR3 contract — the same date is the next contract's RQ_start and the strict-greater test pushes the meeting into the next contract. |
| **Weekends/holidays** | Weekends are not business days; Fri gets `dayWeight = 3` to cover Sat + Sun. **Federal holidays are not modelled** (Mon-Fri = business day regardless). Estimated error ~1 bp/year; see `sr3Settlement.ts:22-27`. |
| **More meetings than contracts (under-determination)** | The LSQ is over-parameterised at the back of the curve. The Tikhonov $\lambda = 0.01$ on the $\Delta$ block damps back-of-curve $\Delta$s toward zero. The header comment on `decomposeAcrossContracts` (`sr3Settlement.ts:199-232`) explicitly notes this. Front-of-curve $\Delta$s remain well-identified because they appear in multiple subsequent contract equations. |
| **Missing FRED data (SOFR or DFF)** | `resolveSpread` returns `{spread: 0, spreadSource: ''}` and downstream code skips the policy translation (`server/src/tvFedWatch.ts:307-309`). The Summary Table still renders, but in SOFR units. The Overnight Cash row uses `rawAnchor` (SOFR) instead of `floor(DFF, 25bp)`. |
| **No contract prices at all** | `getLatestTimestamp` returns null → response is `emptyResponse` augmented with `currentEFFR`/`currentPolicyRate`/`currentTargetRange` only (no meeting rows). The page falls back to a contract-based Summary computed from the curve data; see `STIRDashboardPage.tsx:1154-1175`. |
| **`asOfDate` query param** | `getTvFedWatch` accepts an optional `asOfDate`; if provided it picks the closest timestamp for the `SR3%` prefix on that date. Without it, the latest available timestamp is used. |
| **Singular LSQ system** | If `solveLinearSystem` encounters a tiny pivot (`< 1e-15`), it returns a zero vector (`sr3Settlement.ts:331`). All `Δ`s would be zero and `r_0` would be zero — the response would show every meeting at `0.00 + spread`. No explicit error surfaces; the page would simply look implausible. |

### TODO/FIXME comments

There are no `TODO` or `FIXME` comments in the LSQ or settlement code as of this writing. The header comments on `sr3Settlement.ts` flag the simple-average vs compounded gap and the holiday omission as known limitations rather than action items.

---

## 9. Known approximations vs. CME canonical methodology

| Difference | Where | Estimated error |
| --- | --- | --- |
| **Simple-average model in the LSQ**, not compounded | `decomposeAcrossContracts` uses `implied_R_c = r_0 + Σ Δ_m × overlap/D_c`. The compounded formula is implemented in `computeSR3Settlement` but only called by unit tests and by the legacy `decomposeContract` (non-SOFR markets). | 1–3 bp per contract at current rate levels (compounding adds a small convexity premium that grows with rate level and curve steepness). |
| **No federal-holiday calendar** | `referenceQuarter` treats Mon-Fri as business days regardless of US holidays. Weekend folding is applied; Thanksgiving, July 4, MLK day, etc. are not. | ~1 bp/year. |
| **Tikhonov $\lambda = 0.01$ on the $\Delta$ block** | Stabilises the under-determined back of the curve. With 13 meetings and ~8 contracts, the back of the curve is shrunk toward zero — i.e. the LSQ implicitly says "I can't identify these moves individually, so I'll spread the cumulative path across them and damp idiosyncratic moves". | Doesn't bias the average; biases per-meeting `Δ`s at the back toward 0. |
| **20-day median for spread** | The spec contemplates an exact "spot" spread; the implementation deliberately uses the median so today's outlier SOFR fixings don't distort the policy translation. | ~5–10 bp relative to a spot-spread implementation in regimes where SOFR has drifted from its 20-day median. |
| **RQ already started → treated as implied at $r_0$** | The realised portion of the front contract's RQ is ignored. | ≤ 2 bp on the front contract; tapers to 0 once the next quarter starts. |
| **SR1 (1-month SOFR) not used** | The CME-canonical multi-meeting decomposition uses SR1 to anchor monthly averages and back-solve SR3 for the residual. SR1 isn't ingested for the forward horizon, so we fall back to the cross-contract LSQ. | No fixed error number; the LSQ can't differentiate two meetings inside the same RQ as accurately as SR1-anchored math would (it relies on subsequent contracts to disambiguate). |
| **No quarter-end repo-stress adjustment** | The constant-spread assumption ignores known quarter-end SOFR spikes. | Episodic — typically modest, but can be several bp at quarter-end. |

---

## 10. Code references

| Methodology section | File | Lines |
| --- | --- | --- |
| Frontend: Summary Table render | `client/src/pages/STIRDashboardPage.tsx` | 2899-2929 |
| Frontend: `summaryRows` build (SR3 meeting rows) | `client/src/pages/STIRDashboardPage.tsx` | 1125-1175 |
| Frontend: `overnightRow` build | `client/src/pages/STIRDashboardPage.tsx` | 1177-1189 |
| Frontend: helpers (`fmtBps`, `fmtSignedDecimal`, `summaryFromBps`, `toneFromBps`) | `client/src/pages/STIRDashboardPage.tsx` | 461-492 |
| Frontend: API client | `client/src/hooks/useFedWatch.ts` | full file |
| Backend: route handler `GET /api/futures/fedwatch` | `server/src/routes/tvFutures.ts` | 113-130 |
| Backend: orchestrator `getTvFedWatch` | `server/src/tvFedWatch.ts` | 181-272 |
| Backend: spread calculation (`resolveSpread`) | `server/src/tvFedWatch.ts` | 274-328 |
| Backend: anchor override to `floor(DFF, 25bp)` | `server/src/tvFedWatch.ts` | 229-243 |
| Backend: `getImplied` (SR3 contract price → policy-translated rate) | `server/src/tvFedWatch.ts` | 259-265 |
| Backend: `computeQuarterlyFedWatch` (SR3 branch) | `server/src/tvFedWatch.ts` | 458-623 |
| Backend: meeting → containing contract attribution | `server/src/tvFedWatch.ts` | 477-497 |
| Backend: LSQ contract enumeration | `server/src/tvFedWatch.ts` | 549-580 |
| Backend: LSQ result → per-meeting `effrStart`/`effrEnd` | `server/src/tvFedWatch.ts` | 591-622 |
| Backend: per-contract equal-split path (non-SOFR) | `server/src/tvFedWatch.ts` | 624-681 |
| Library: `thirdWednesday` | `server/src/lib/sr3Settlement.ts` | 32-37 |
| Library: `referenceQuarter` (RQ + day weights) | `server/src/lib/sr3Settlement.ts` | 57-101 |
| Library: `computeSR3Settlement` (compounded; NOT used in SR3 LSQ path) | `server/src/lib/sr3Settlement.ts` | 113-124 |
| Library: `decomposeContract` (equal-split, compounded inverse; used by non-SOFR) | `server/src/lib/sr3Settlement.ts` | 158-197 |
| Library: `decomposeAcrossContracts` (cross-contract LSQ) | `server/src/lib/sr3Settlement.ts` | 251-312 |
| Library: `solveLinearSystem` (Gaussian elimination with partial pivoting) | `server/src/lib/sr3Settlement.ts` | 315-344 |
| Library: `computeStepProbabilities` / `stepProbabilitiesAsDeltas` (used for the probability matrix, not the Summary Table) | `server/src/lib/fedwatch.ts` | 132-231 |
| Config: SR3 market entry | `server/src/stirRegistry.ts` | 58-77 |
| Config: FOMC meeting calendar (`CB_MEETINGS.FED`) | `server/src/cbMeetings.ts` | 8-18 |
| Unit tests: settlement + decomposition + LSQ | `server/src/lib/sr3Settlement.test.ts` | full file |
