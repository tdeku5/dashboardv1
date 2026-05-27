# ABS Data API — Australian Fundamental Series Integration

Core inflation and labour market series for the Australian rates fundamental model, accessible via the ABS Data API (SDMX REST). CPI series are pulled as **raw index values** (2011-12 = 100 for quarterly; new base for monthly TBD) so MoM, YoY, 3M/6M annualized, and other transformations can be computed downstream.

---

## API Basics

**Base URL:** `https://data.api.abs.gov.au/rest`
**Docs:** `https://www.abs.gov.au/about/data-services/application-programming-interfaces-apis/data-api-user-guide`
**Auth:** None
**Format:** SDMX-JSON (default), SDMX-CSV (preferred for ingestion), SDMX-ML

**Endpoint pattern:**
```
https://data.api.abs.gov.au/rest/data/{AGENCY},{DATAFLOW},{VERSION}/{KEY}?startPeriod=...&endPeriod=...
```

Where:
- `{AGENCY}` is typically `ABS`
- `{DATAFLOW}` identifies the dataset (e.g., `CPI`, `LF`, `CPI_M`)
- `{VERSION}` is the dataflow version (e.g., `1.0.0`) — omit or use `latest` if unsure
- `{KEY}` is a dot-separated string of dimension codes filtering the series

**For CSV output**, add the request header:
```
Accept: application/vnd.sdmx.data+csv;file=true
```

**Optional query parameters:**
- `startPeriod=2010-Q1` — limit start date (format depends on frequency: `2010-Q1` quarterly, `2024-04` monthly)
- `endPeriod=2026-Q1`
- `firstNObservations=10` / `lastNObservations=10`
- `dimensionAtObservation=TIME_PERIOD` — recommended for time-series ingestion

**Discovery:** To find dataflows: `GET /dataflow/ABS`. To get the data structure (which dimensions exist, what codes are valid): `GET /datastructure/ABS/{DSD_ID}?references=children`.

---

## ⚠️ Critical Context — The November 2025 CPI Transition

Australia transitioned from quarterly CPI to **complete Monthly CPI** as the primary measure of headline inflation on 26 November 2025 (first release covering October 2025 reference month). This has major implications for the collector design:

| Series | Status as of May 2026 |
|---|---|
| Complete Monthly CPI | **NEW primary measure**, monthly, back-series to April 2024 |
| Quarterly CPI | Continues for at least 18 months post-transition (through mid-2027) as a continuity series, includes the **quarterly Trimmed mean** that the RBA explicitly references as its preferred underlying inflation gauge during the transition |
| Monthly CPI Indicator | **DISCONTINUED** — last released October 2025 |

**Implications:**
- For the fundamental model, ingest **both monthly and quarterly CPI** for at least the next 18 months. The monthly series is the new RBA target but lacks established seasonal patterns. The RBA continues to focus on the quarterly Trimmed mean during the transition.
- The monthly CPI only goes back to April 2024. For longer history, use the quarterly series.
- Quarterly CPI continues to publish through at least mid-2027 with the same trimmed mean and weighted median underlying measures the RBA has used for years.

---

## Series 1 — Monthly CPI All Groups Index (Headline, NEW Primary Measure)

**What:** Raw monthly CPI index, all groups, weighted average of eight capital cities. This is the new primary measure of headline inflation that the RBA targets (2-3% range, 2.5% midpoint). Pulled as the index so YoY, MoM, sequential annualized rates, and any other transformation can be computed locally.

**Dataflow:** `CPI_M` (verify exact dataflow ID via `GET /dataflow/ABS` — this is a new dataflow launched November 2025 alongside the publication; ABS may have used a different ID such as `CPI_MONTHLY`)
**Agency:** `ABS`
**Frequency:** Monthly
**History:** April 2024 onward
**Adjustment:** Original (NSA) and seasonally adjusted both published; SA uses alternative methods initially due to short history

**Endpoint pattern (to be confirmed against actual dataflow once codes are inspected):**
```
https://data.api.abs.gov.au/rest/data/ABS,CPI_M,latest/.{ALL_GROUPS}.{AUS}.M?startPeriod=2024-04
```

**First-run discovery step required:** Because this dataflow is new, dimension positions and codes must be verified via:
```
GET https://data.api.abs.gov.au/rest/dataflow/ABS/CPI_M?references=children
```
to retrieve the data structure definition. The collector should fetch this once at setup, log the dimension order and codelists, and harcode the resulting series key afterward.

---

## Series 2 — Monthly Trimmed Mean Index (NEW Underlying Inflation Measure)

**What:** Raw monthly Trimmed mean index — the new monthly version of the RBA's preferred underlying inflation measure. Excludes 30% of expenditure classes at the tails of the distribution of monthly price changes.

**Dataflow:** `CPI_M` (same dataflow as headline; different `MEASURE` dimension code)
**Frequency:** Monthly
**History:** April 2024 onward

**Notes:**
- ABS will continue producing the **quarterly Trimmed mean** for at least 18 months post-transition (i.e., through approximately mid-2027) "at the request of the RBA" because the quarterly version has 14+ years of history with well-understood seasonal properties.
- During the transition period, **the quarterly Trimmed mean remains the RBA's primary underlying inflation reference**. The monthly Trimmed mean is informational but has short history.

---

## Series 3 — Quarterly CPI All Groups Index (Continuity Series)

**What:** Raw quarterly CPI index, all groups, weighted average of eight capital cities, 2011-12 = 100. Continues to publish for at least 18 months post-November 2025 transition as a continuity series.

**Dataflow:** `CPI`
**Agency:** `ABS`
**Version:** `1.1.0` (or `latest`)
**Frequency:** Quarterly
**Adjustment:** Original (NSA) and seasonally adjusted both published

**Example endpoint (per ABS worked examples):**
```
https://data.api.abs.gov.au/rest/data/ABS,CPI,1.1.0/1+2+3.10001.10.50.Q?startPeriod=2010-Q1
```

The key `1+2+3.10001.10.50.Q` decodes as: measures 1, 2, and 3 (index, % change quarter, % change year), index `10001` (All groups CPI), region `10` (weighted average of eight capital cities), adjustment `50` (e.g., original), frequency `Q`. Exact codes should be confirmed via the data structure endpoint.

**For just the all-groups index, seasonally adjusted, weighted-eight-capitals, latest version:**
```
https://data.api.abs.gov.au/rest/data/ABS,CPI/{measure}.10001.10.{adjustment}.Q?startPeriod=2000-Q1
```

---

## Series 4 — Quarterly Trimmed Mean Index (Continuity Underlying Measure)

**What:** Raw quarterly Trimmed mean index. **This remains the RBA's primary reference for underlying inflation during the transition period.** Published continuously since 2007 (in current form since 2011), so it has 14+ years of established history vs. the monthly version's <2 years.

**Dataflow:** `CPI` (same dataflow as quarterly all-groups)
**Series key:** A different `MEASURE` dimension code within the `CPI` dataflow — verify via data structure inspection
**Frequency:** Quarterly
**Adjustment:** Seasonally adjusted

**This is arguably the single most important series for Australian rates analysis during the 2025-2027 transition window.** The RBA's Statement on Monetary Policy explicitly confirms continued focus on the quarterly Trimmed mean while monthly seasonal patterns mature.

---

## Series 5 — Quarterly Weighted Median Index (Secondary Underlying Measure)

**What:** Raw quarterly Weighted median index — the second underlying inflation measure. The 50th percentile of the weighted distribution of quarterly price changes across expenditure classes.

**Dataflow:** `CPI`
**Series key:** Yet another `MEASURE` dimension code
**Frequency:** Quarterly

Less prominent than the Trimmed mean in RBA commentary, but often shown alongside it.

---

## Series 6 — Unemployment Rate

**What:** Headline unemployment rate, Australia, persons 15+, monthly, seasonally adjusted. Already published as a percentage rate (no transformation needed).

**Dataflow:** `LF` (Labour Force)
**Agency:** `ABS`
**Frequency:** Monthly
**History:** February 1978 onward (monthly); quarterly 1966-1977

**Example endpoint (key positions to be verified):**
```
https://data.api.abs.gov.au/rest/data/ABS,LF/M3.{TOTAL_PERSONS}.{AUS}.{SA}.M?startPeriod=2000-01
```

**Verification step:** Inspect the `LF` data structure to identify exact codes for: measure (unemployment rate), sex (persons), region (Australia), adjustment type (seasonally adjusted), age group (total 15+).

**Publication schedule:** Approximately 2-3 weeks after reference month (e.g., March data released mid-April).

**Note on trend vs. seasonally adjusted:** The ABS recommends **trend data** (13-month moving average) over seasonally adjusted for interpreting movements due to month-to-month volatility — typical two-standard-error band on the SA unemployment rate is ±0.2 percentage points. For the dashboard, ingesting both SA and trend allows toggling between them in the view layer.

---

## CSV Response Structure (SDMX-CSV)

With the `Accept: application/vnd.sdmx.data+csv;file=true` header:

```csv
DATAFLOW,MEASURE,INDEX,REGION,ADJUSTMENT,FREQ,TIME_PERIOD,OBS_VALUE,UNIT_MEASURE,UNIT_MULT,OBS_STATUS
ABS:CPI(1.1.0),1,10001,10,20,Q,2024-Q4,138.1,INDEX,0,
ABS:CPI(1.1.0),1,10001,10,20,Q,2025-Q1,139.3,INDEX,0,
```

Key columns: `TIME_PERIOD`, `OBS_VALUE`, plus all dimension columns identifying which series the row belongs to.

---

## Node.js Ingestion Pattern

```javascript
const fetch = require('node-fetch');
const Papa = require('papaparse');

const ABS_BASE = 'https://data.api.abs.gov.au/rest';

// Series keys to be verified via data structure inspection on first run
const SERIES = {
  cpi_m_headline:    { flow: 'CPI_M', key: '<TBD>', freq: 'M', unit: 'index'   },
  cpi_m_trimmed:     { flow: 'CPI_M', key: '<TBD>', freq: 'M', unit: 'index'   },
  cpi_q_headline:    { flow: 'CPI',   key: '<TBD>', freq: 'Q', unit: 'index'   },
  cpi_q_trimmed:     { flow: 'CPI',   key: '<TBD>', freq: 'Q', unit: 'index'   },
  cpi_q_weighted_med:{ flow: 'CPI',   key: '<TBD>', freq: 'Q', unit: 'index'   },
  unemployment_rate: { flow: 'LF',    key: '<TBD>', freq: 'M', unit: 'percent' }
};

async function fetchDataStructure(flow) {
  const url = `${ABS_BASE}/dataflow/ABS/${flow}?references=children`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  return await res.json();
}

async function fetchSeries(flow, key, startPeriod) {
  const url = `${ABS_BASE}/data/ABS,${flow},latest/${key}?startPeriod=${startPeriod}&dimensionAtObservation=TIME_PERIOD`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/vnd.sdmx.data+csv;file=true' }
  });
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  return parsed.data.map(row => ({
    date: row.TIME_PERIOD,
    value: parseFloat(row.OBS_VALUE),
    status: row.OBS_STATUS
  }));
}

async function ingestAll() {
  const results = {};
  for (const [name, { flow, key, freq, unit }] of Object.entries(SERIES)) {
    const startPeriod = freq === 'M' ? '2024-04' : '2000-Q1';
    results[name] = { unit, freq, data: await fetchSeries(flow, key, startPeriod) };
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}
```

**First-run setup:** Run `fetchDataStructure` for each dataflow (`CPI_M`, `CPI`, `LF`), inspect the dimension lists, identify codes for the specific aggregates needed, and hardcode the resulting series keys in `SERIES`.

---

## Computing Inflation Rates from the Index

For monthly CPI series (raw index):
```javascript
const yoy = (current / yearAgo - 1) * 100;        // YoY % change
const mom = (current / prior - 1) * 100;          // MoM % change
const m3ann = (Math.pow(current / threeMonthsAgo, 4) - 1) * 100;  // 3M annualized
const m6ann = (Math.pow(current / sixMonthsAgo, 2) - 1) * 100;    // 6M annualized
```

For quarterly CPI series:
```javascript
const yoy = (current / fourQuartersAgo - 1) * 100; // YoY % change
const qoq = (current / prior - 1) * 100;           // QoQ % change
const qoqAnn = (Math.pow(current / prior, 4) - 1) * 100;  // QoQ annualized
```

---

## SQLite Schema Suggestion

Consistent with the EU/CA/JP schemas:

```sql
CREATE TABLE au_macro_series (
  date TEXT NOT NULL,
  series_code TEXT NOT NULL,    -- 'CPI_M_HEADLINE', 'CPI_M_TRIMMED',
                                 -- 'CPI_Q_HEADLINE', 'CPI_Q_TRIMMED', 'CPI_Q_WEIGHTED_MED',
                                 -- 'UNRATE_AU', 'UNRATE_AU_TREND'
  value REAL,
  unit TEXT,                     -- 'index' or 'percent'
  frequency TEXT,                -- 'M' or 'Q'
  source TEXT DEFAULT 'ABS',
  ingested_at TEXT,
  PRIMARY KEY (date, series_code)
);
```

The `frequency` column is more important here than in other countries because Australian CPI is in a mixed-frequency transition window — the dashboard needs to render monthly and quarterly series differently.

---

## Publication Calendar (Approximate)

| Series | Reference Period | Release Timing |
|---|---|---|
| Monthly CPI (all measures) | April | Late May (~4-5 weeks after reference month) |
| Quarterly CPI (all measures) | Q1 (Jan-Mar) | Late April (~4 weeks after end of reference quarter) |
| Labour Force (unemployment) | April | Mid-May (~2-3 weeks after reference month) |

The monthly CPI release cadence is still being established; the ABS targets approximately the same point each month but exact timing may shift in the first year of the new series.

---

## Cross-Reference for the Fundamental Model

For the Australian rates fundamental model, the typical analytical pairings (transition-period aware):

- **Quarterly Trimmed mean YoY vs. RBA Cash Rate Target** — **the primary policy stance vs. inflation pairing during 2025-2027 transition**, per RBA Statement on Monetary Policy guidance
- **Monthly Trimmed mean YoY vs. AONIA / cash rate forward curve** — early-warning underlying inflation gauge, but interpret with caution due to short history
- **Monthly CPI all-groups YoY vs. RBA target band (2-3%)** — the new headline measure; the official policy target moving forward
- **Quarterly Weighted median** — cross-check on the Trimmed mean
- **Unemployment rate (trend) vs. estimated NAIRU** — slack assessment; ABS recommends trend over SA for interpretation
- **Underutilisation rate (u-series, unemployment + underemployment)** — broader labour market slack, increasingly cited by RBA

---

## Caveats

- **Dataflow ID for monthly CPI requires verification.** The November 2025 launch was recent enough that the exact dataflow ID (`CPI_M`, `MONTHLY_CPI`, or similar) should be confirmed via `GET /dataflow/ABS` before hardcoding.
- **SDMX dimension positions vary by dataflow.** Always inspect the data structure definition (DSD) for each dataflow at setup time — do not assume the position order from another dataflow translates.
- **CPI quarterly base year is 2011-12 = 100**; the monthly CPI base will be different (to be confirmed when the first release is examined). Both differ from EU (2015=100), Canada (2002=100), and Japan (2020=100). Rebase for cross-country comparison charts.
- **Quarterly CPI release timing** — Australia's quarterly CPI is the slowest in this country group (4 weeks after quarter end). The monthly CPI partially addresses this but doesn't fully replace the quarterly underlying measures during the transition.
- **Labour Force seasonal adjustment quirk:** SA estimates for NT and ACT are not produced (no seasonality). For Australia-aggregate this isn't an issue, but worth noting if state-level data ever gets added.
- **Trend vs. seasonally adjusted:** ABS explicitly recommends trend over SA for the unemployment rate due to month-to-month volatility. Consider ingesting both and defaulting the dashboard view to trend, with SA available on toggle.
- **Mixed-frequency complexity:** During the 18-month transition window, the dashboard needs to handle both monthly and quarterly inflation series simultaneously. Charts comparing AU CPI to other countries (which are monthly) should default to the monthly Australian series for like-for-like, with the quarterly Trimmed mean shown separately as the RBA's preferred policy reference.
- **Revisions:** Quarterly CPI revisions are minimal at first print. Monthly CPI is too new to have established revision patterns. LFS gets revised when SA factors are updated annually.
- **SDMX versioning:** Always use `latest` for the version component unless reproducibility against a specific historical revision is required. Hardcoding `1.1.0` will eventually break when ABS releases `1.2.0`.
