# TradingView date convention — a known, terminal-wide off-by-one

**Status:** open technical debt. Documented so a future fix has a work list.
**Discovered:** Phase 0 of the US Rates VOL build (`docs/prompts/us-rates-vol-realized-move.md`).

## What the data actually is

`tv_series.time` and `tv_ohlcv.time` hold unix epoch seconds as TEXT. The epoch
is **midnight Europe/London**, not midnight UTC. London observes BST (UTC+1)
from late March to late October, so the same daily bar is stamped:

| Season | London offset | Stored epoch lands at |
|---|---|---|
| GMT (winter) | UTC+0 | `00:00 UTC` of the session date |
| BST (summer) | UTC+1 | `23:00 UTC` of the **previous** calendar day |

Measured on `US10Y`, rows since 2023-01-01:

```
tod    n    range
23:00  637  2023-03-12 .. 2026-09-23     ← BST bars
00:00  304  2023-01-02 .. 2026-03-06     ← GMT bars
```

## What the terminal does with it

Every conversion site truncates the epoch in UTC:

```ts
new Date(ts * 1000).toISOString().slice(0, 10)
```

For a GMT bar that is correct. For a BST bar it returns the **previous calendar
date**. The result is a label set that is neither wholly right nor wholly wrong,
and the artefact is visible in the weekday histogram — `US10Y`, last 3 years:

```
raw-UTC (what the terminal uses):  Sun 123  Mon 186  Tue 193  Wed 191  Thu 184  Fri  64
epoch + 3600 (true session date):  Sun   0  Mon 178  Tue 194  Wed 192  Thu 189  Fri 188
```

Under the current convention, **Monday sessions are labelled Sunday** and
Fridays are correspondingly undercounted, for roughly seven months of each year.
`epoch + 3600` recovers the true session date in both seasons (in GMT it merely
moves midnight to 01:00 of the same day) and produces a clean Mon–Fri
distribution with no weekend labels at all.

## Why it has not been fixed

It is self-consistent. Every series in `tv_series` carries the same stamp, so
any page that joins TradingView series to each other — which is all of them —
gets the right relative alignment. The label is wrong; the arithmetic is not.

Fixing one module in isolation is actively worse than leaving it: a module on
`+3600` joined against a module on raw-UTC draws the same print a day apart for
seven months of the year. **A fix has to be all sites at once**, which is why
the list below exists.

Specific case that forced the decision: `us_rates_realized_vol` is registered in
`series_catalog` so Hephaestus can overlay `USRVOL:rv_move` against the implied
`MOVE` in `tv_series`. Hephaestus joins by date label
(`render.ts:epochToIso`, raw-UTC). Had the new table carried true session dates,
that overlay — the feature the registration exists for — would have drawn its
two lines a day apart on every BST date. Internal consistency won.

## Related finding: TradingView's 30y has no FRED-style gap

Recorded here because it is the other data-provenance fact the Phase 0 source
switch turned up, and it is a concrete advantage of reading yields from
TradingView rather than FRED.

FRED's `DGS30` is genuinely empty from February 2002 to February 2006 — Treasury
suspended 30-year issuance, so there was no constant-maturity yield to publish.
Any 30y-dependent index built on FRED has a four-year hole there.

TradingView's `US30Y` carries a continuous series straight through:

```
US30Y rows per year
2000  251   2003  250   2006  250
2001  248   2004  250   2007  251
2002  250   2005  250   2008  251
```

and across its full history since 1987-08-03 it has **no gap longer than 5
calendar days anywhere** — same as the 2y, 5y and 10y.

Consequence for `us_rates_realized_vol`: the weight-renormalization path
(a missing tenor rescaling the remaining weights to sum to 1) is **never
exercised by real data**. The backfill produced 9,640 rows with
`weights_renormalized = 1` on exactly zero of them. That path, and the
short-window null path, are covered by fixtures in
`server/src/lib/realizedMove.test.ts` rather than by production rows.

Caveat worth keeping in view: those 2002–2006 values are vendor-constructed
rather than auctioned-bond yields, since no 30-year bond was being issued.
They are continuous, not necessarily comparable to the post-2006 series.

## Related finding: the stale-tip filter can hold back a tip bar

`tv_series` ingest drops the latest bar for a symbol when its close exactly
equals the prior bar's (see CLAUDE.md, `TV_INGEST_SKIP_STALE_TIPS`). That is
per-symbol, so one CSV can land a fresh bar for one symbol and withhold it for
another.

Observed 2026-09-24: CSV `TVC_US03MY, 1D_00ee6.csv` carried epoch 1790204400
(labelled 2026-09-23) with `US10Y=5.121` — a real move from 5.11 — and
`MOVE=95.4527`, byte-identical to the prior bar. The yield bar was ingested and
the MOVE bar was dropped as an unfilled session.

This is the filter working, not a fault, and it self-heals: the next export
carrying a real close for that date upserts over it. But it means a consumer
inner-joining MOVE against the yields can transiently lose the newest date. Over
the five years to 2026-09-24 this happened on exactly **one** date, so it is not
a systematic lag — but do not paper over it with a shifted join or a
forward-fill. The absence is real: MOVE genuinely has no value for that session
yet.

## The trap this sets

**Nothing that consumes these labels may filter by weekday.** Sunday-labelled
rows are real Monday sessions; a `getDay()` check, a business-day calendar or a
weekend exclusion silently deletes them. Treat the rows as an ordered sequence
and difference consecutive observations as they come.

`server/src/lib/realizedMove.test.ts` pins this with a Sunday-labelled fixture
that must return the same realized vol as its Monday-labelled twin, plus an
all-weekend-labelled fixture that must still compute.

## Work list for a future fix

Sites that convert a TradingView epoch to a date label and therefore inherit the
off-by-one. Counts are conversion-call sites per file, not occurrences of the
bug.

**Server — reads `tv_series` / `tv_ohlcv` (14 modules):**

| Module | Conversions |
|---|---|
| `server/src/breadth.ts` | 4 |
| `server/src/countryReturns.ts` | 4 |
| `server/src/crossAssetVol.ts` | 4 |
| `server/src/crudeCurves.ts` | 6 |
| `server/src/fxPairReturns.ts` | 4 |
| `server/src/hephaestus/render.ts` | 3 |
| `server/src/metalsData.ts` | 8 |
| `server/src/routes/global.ts` | 6 |
| `server/src/routes/tvYieldCurve.ts` | 3 |
| `server/src/sectorAttribution.ts` | 4 |
| `server/src/sectorContribution.ts` | 4 |
| `server/src/tvFedWatch.ts` | 3 |
| `server/src/tvFutures.ts` | 6 |
| `server/src/usIndices.ts` | 5 |
| `server/src/vixCurve.ts` | 4 |

**Server — derived, writes the convention into a table:**

| Module | Note |
|---|---|
| `server/src/usRatesRealizedVol.ts` | Writes `us_rates_realized_vol.date` using raw-UTC. A fix must rewrite the stored keys, not just the reader. |

The calculator it feeds, `server/src/lib/realizedMove.ts`, is label-agnostic by
construction — it never inspects a date beyond using it as a join key — so it
needs no change.

**Server — incidental:** `server/src/migrations/cleanStaleTips.ts` (display
formatting only), `server/src/scripts/build-series-catalog.ts` and
`server/src/scripts/enumerateYieldTickers.ts` (catalog `first_date`/`last_date`
metadata, which would shift with any fix).

**Client:**

| Module | Conversions |
|---|---|
| `client/src/components/CrossesStrengthChart.tsx` | 3 |
| `client/src/components/DxyForeignYieldsChart.tsx` | 3 |
| `client/src/pages/CountryTermStructure.tsx` | 1 |
| `client/src/pages/Global2s10sRegimeSection.tsx` | 2 |
| `client/src/pages/ModelCurrencyFxPage.tsx` | 4 |
| `client/src/pages/VolPage.tsx` | 5 |

**Stored artefacts that would need rebuilding after a fix:**
`series_catalog.first_date` / `last_date` for every `tv_series` and `tv_ohlcv`
row (regenerate with `npm run build-catalog --workspace=server`), and the `date`
primary key of `us_rates_realized_vol` (drop and re-backfill — the sync rebuilds
it from `tv_series` in ~1.5s).

## If you do fix it

The conversion belongs in one shared helper rather than the ~20 local copies
that exist now. Replace `new Date(ts * 1000).toISOString().slice(0, 10)` with a
single exported `tvBarDate(ts)` doing `new Date((ts + 3600) * 1000)`, migrate
all sites in one change, then rebuild the catalog and re-backfill the derived
table. Verify with the weekday histogram above: zero Sunday labels is the
pass condition.
