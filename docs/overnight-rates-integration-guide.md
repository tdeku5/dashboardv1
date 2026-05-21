# Overnight Rate Data Sources — Integration Guide

Detailed access instructions for ingesting Canadian (CORRA), Japanese (TONA), and Australian (AONIA / Cash Rate) overnight rates into `dashboardv1`.

---

## Summary Table

| Country | Rate | Source | Access Method | Auth | Format |
|---|---|---|---|---|---|
| Canada | CORRA + OMMFR | BoC Valet API | True REST API | None | JSON/CSV/XML |
| Japan | TONA (Mutan) | BoJ Time-Series API | REST API (new Feb 2026) | None | JSON/CSV |
| Australia | AONIA / Cash Rate | RBA Statistical Tables | Structured CSV endpoints | None | CSV/XLS |

---

## 1. Canada — Bank of Canada Valet API

### Overview

The Valet API is the cleanest of the three. Proper REST, native JSON, well-documented, stable URL patterns. No registration, no API key, no rate limit signing — just hit the endpoint.

**Base URL:** `https://www.bankofcanada.ca/valet`
**Docs:** `https://www.bankofcanada.ca/valet/docs`
**Publication schedule:** CORRA published every business day between 9:00 and 11:00 ET. Revised observations marked with "R" in the response.

### Series of Interest

| Series Code | Description | Use Case |
|---|---|---|
| `AVG.INTWO` | CORRA (Canadian Overnight Repo Rate Average) | Primary — underlies CRA STIR futures |
| `V39079` | Overnight Money Market Financing Rate (OMMFR) | Unsecured overnight funding cost |
| `V39078` | Target for the Overnight Rate | BoC policy rate |
| `V80691311` | Bank Rate | Upper bound of operating band |
| `V80691312` | Deposit Rate | Lower bound of operating band |

### Endpoint Patterns

**Get all observations for a series (JSON):**
```
https://www.bankofcanada.ca/valet/observations/AVG.INTWO/json
```

**With date range:**
```
https://www.bankofcanada.ca/valet/observations/AVG.INTWO/json?start_date=2020-01-01&end_date=2026-05-21
```

**CSV format:**
```
https://www.bankofcanada.ca/valet/observations/AVG.INTWO/csv?start_date=2020-01-01
```

**Multiple series in one call (comma-separated):**
```
https://www.bankofcanada.ca/valet/observations/AVG.INTWO,V39079,V39078/json?start_date=2020-01-01
```

**Recent N observations only:**
```
https://www.bankofcanada.ca/valet/observations/AVG.INTWO/json?recent=30
```

**Series metadata:**
```
https://www.bankofcanada.ca/valet/series/AVG.INTWO/json
```

### Response Structure (JSON)

```json
{
  "terms": { "url": "https://www.bankofcanada.ca/terms/" },
  "seriesDetail": {
    "AVG.INTWO": {
      "label": "CORRA",
      "description": "Canadian Overnight Repo Rate Average",
      "dimension": { "key": "d", "name": "Date" }
    }
  },
  "observations": [
    { "d": "2026-05-19", "AVG.INTWO": { "v": "2.7500" } },
    { "d": "2026-05-20", "AVG.INTWO": { "v": "2.7500" } }
  ]
}
```

### Node.js Ingestion Pattern

```javascript
const fetch = require('node-fetch');

async function fetchCORRA(startDate) {
  const url = `https://www.bankofcanada.ca/valet/observations/AVG.INTWO/json?start_date=${startDate}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.observations.map(o => ({
    date: o.d,
    corra: parseFloat(o['AVG.INTWO'].v)
  }));
}
```

### Rate Limits / Caveats

- No documented rate limit, but BoC advises starting slow and gradually increasing during peak times.
- Same-day values are sometimes revised — flag any observation with the "R" marker when ingesting.
- Use the multi-series endpoint when pulling CORRA + policy rate + operating band together; it's a single request and ensures date alignment.

---

## 2. Japan — Bank of Japan Time-Series Data Search API

### Overview

The BoJ launched a proper REST API in February 2026, replacing what had been a flat-file-only setup. This is a significant upgrade — historically the only way to get this data was scraping the HTML interface or downloading pre-built flat files.

**Base URL:** `https://www.stat-search.boj.or.jp`
**API manual:** `https://www.stat-search.boj.or.jp/info/api_manual_en.pdf`
**Web interface (for browsing series codes):** `https://www.stat-search.boj.or.jp/index_en.html`

**Publication schedule:**
- Provisional rate: every business day around 17:15 JST (18:15 JST on month-end)
- Final rate: following business day around 10:00 JST
- Published values: weighted average, high, and low for the day

### Series of Interest

| Series Code | Description |
|---|---|
| `FM02'STMUCDBOD` | Uncollateralized Overnight Call Rate, Average (final) |
| `FM02'STMUCDPRO` | Uncollateralized Overnight Call Rate, Average (provisional) |
| `FM02'STMUCDHIB` | Uncollateralized Overnight Call Rate, High (final) |
| `FM02'STMUCDLOB` | Uncollateralized Overnight Call Rate, Low (final) |

Note: TONA, TONAR, Mutan rate, and "Uncollateralized Overnight Call Rate" all refer to the same series. The BoJ publishes it under the latter name; market participants call it TONA.

### API Types

The BoJ API has three endpoints:
1. **Single series observations** — pull all observations for one series code
2. **Multiple series observations** — batch query
3. **Series metadata** — descriptive info, frequency, units

All three return either JSON or CSV based on a format parameter.

### Endpoint Pattern (Conceptual)

The actual API URL structure requires consulting the PDF manual, since the BoJ rolled this out recently. Typical pattern based on the manual:

```
https://www.stat-search.boj.or.jp/ssi/cgi-bin/famecgi2?cgi=$nme_a000_en&hstat=FM02'STMUCDBOD
```

For programmatic ingestion, the recommended approach is to read the API manual PDF, configure request URLs per the documented format, and test with curl before building the ingestion pipeline. The manual provides exact URL templates for each of the three API types.

### Python Wrapper (Alternative)

If building from scratch via the API feels brittle, there's a community Python wrapper (`bojpy`) that handles URL construction:

```python
from bojpy import boj
df = boj.get_data_series(series="FM02'STMUCDBOD")
```

This is not officially supported by the BoJ — useful for prototyping but probably not what you want in production. Better to build directly against the documented API endpoints.

### Caveats

- **Excessive request frequency may result in access restriction** — there's no published rate limit but the BoJ warns against high-frequency calls. Build in throttling.
- Series codes use an apostrophe (`'`) in the middle (`FM02'STMUCDBOD`), which can cause URL encoding issues — encode as `%27`.
- The web interface has both Japanese and English versions. Series codes are the same in both; only the labels differ.
- Some older flat files contain garbled Japanese text in the header rows — skip these on parse.
- Two-stage publication (provisional → final) means you may want to ingest both and overwrite provisional with final when it arrives the next day, or just ingest the final series only and accept the one-day lag.

### Ingestion Recommendation

Given the recency of the API launch (Feb 2026) and the somewhat baroque URL structure, the practical workflow is:

1. Read the API manual PDF carefully
2. Build URL templates as constants in your collector
3. Test single-series fetch with curl before scripting
4. Implement aggressive throttling (e.g., one request per few seconds)
5. Cache responses locally — this data only updates once per business day

---

## 3. Australia — Reserve Bank of Australia Statistical Tables

### Overview

The RBA does not have a formal REST API. Instead, it publishes statistical tables as CSV/XLS files at stable, predictable URLs. The endpoints have been at the same paths for years, so they function as a de facto API. You fetch the CSV, parse it, load into SQLite — same pattern as the BoE IADB.

**Base URL:** `https://www.rba.gov.au/statistics`
**Tables index:** `https://www.rba.gov.au/statistics/tables/`

### Relevant CSV Endpoints

| Table | Description | CSV URL |
|---|---|---|
| F1.1 | Cash Rate Target (policy rate, monthly history) | `https://www.rba.gov.au/statistics/tables/csv/f1.1-data.csv` |
| F1 | Interest Rates and Yields – Money Market (includes AONIA, daily) | `https://www.rba.gov.au/statistics/tables/csv/f1-data.csv` |
| F13 | Overseas Official Interest Rates | `https://www.rba.gov.au/statistics/tables/csv/f13-data.csv` |
| F2 | Capital Market Yields – Government Bonds | `https://www.rba.gov.au/statistics/tables/csv/f2-data.csv` |

### Series IDs (Within F1 CSV)

The RBA uses internal series IDs that appear in the CSV header rows.

| Series ID | Description |
|---|---|
| `FIRMMCRTD` | Cash Rate Target (the announced policy rate) |
| `FIRMMCRID` | Interbank Overnight Cash Rate (AONIA — the realized market rate) |

The Cash Rate Target is what the RBA Board announces at policy meetings. AONIA (`FIRMMCRID`) is the actual daily fixing of overnight unsecured interbank lending — this is what underlies the ASX 30-Day Interbank Cash Rate Futures.

### CSV Structure

RBA CSVs have a non-standard header structure:

```
Title,Interest Rates and Yields – Money Market – Daily –  F1
Description,...
Frequency,Daily
...
Series ID,FIRMMCRTD,FIRMMCRID,...
Date,Cash Rate Target,Interbank Overnight Cash Rate,...
01-Jul-2023,4.10,4.0959,...
02-Jul-2023,4.10,4.0875,...
```

The first ~10 rows are metadata; actual data starts after a "Series ID" or "Date" row. Parser logic needs to skip headers and locate the data start.

### Node.js Ingestion Pattern

```javascript
const fetch = require('node-fetch');
const Papa = require('papaparse');

async function fetchAONIA() {
  const url = 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv';
  const res = await fetch(url);
  const text = await res.text();

  // Find the row where actual data starts
  const lines = text.split('\n');
  const dataStart = lines.findIndex(l => l.startsWith('Series ID'));
  const dataRows = lines.slice(dataStart);

  const parsed = Papa.parse(dataRows.join('\n'), { header: true });
  return parsed.data.map(row => ({
    date: row['Series ID'], // first column = date in data rows
    cashRateTarget: parseFloat(row['FIRMMCRTD']),
    aonia: parseFloat(row['FIRMMCRID'])
  }));
}
```

### Caveats

- **Publication delays:** The RBA notes there may be delays in financial aggregates publication due to APRA reporting system decommissioning. Build in graceful handling for missing-day observations.
- **CSV header structure varies by table** — write a flexible parser that locates the data block rather than assuming fixed row offsets.
- **Date format is `DD-Mmm-YYYY`** (e.g., `19-May-2026`) — parse accordingly.
- **AONIA has a slightly longer publication lag than CORRA or TONA** — typically T+1 morning Sydney time.
- The full F1 CSV can be ~1MB+ with full history. Consider downloading once for backfill, then refreshing incrementally.

---

## Cross-Cutting Implementation Notes

### Daily Ingestion Cadence

All three rates are published on a T+0 or T+1 business-day basis. A single daily cron job running in the evening UTC should capture all three:

| Source | Best Time to Fetch (UTC) | Reason |
|---|---|---|
| BoC Valet (CORRA) | After 16:00 UTC (12:00 ET) | Final CORRA published by 11:00 ET |
| BoJ (TONA) | After 02:00 UTC next day | Final TONA published 10:00 JST = 01:00 UTC |
| RBA (AONIA) | After 02:00 UTC next day | AONIA published morning Sydney |

A single 03:00 UTC daily cron job should reliably catch the final values for all three.

### Schema Suggestion (SQLite)

Slot these into the same overnight rates table used for SOFR / SONIA / €STR for consistency:

```sql
CREATE TABLE overnight_rates (
  date TEXT NOT NULL,
  series_code TEXT NOT NULL,  -- 'CORRA', 'TONA', 'AONIA', etc.
  value REAL,
  is_provisional INTEGER DEFAULT 0,
  source TEXT,                 -- 'BoC', 'BoJ', 'RBA'
  ingested_at TEXT,
  PRIMARY KEY (date, series_code)
);
```

This lets you unify the global STIR curve dashboard with a single query pattern across all currencies.

### Backfill Strategy

- **CORRA:** Pull full history in one call — `start_date=1998-01-01` returns ~7,000 rows, well within Valet's capacity.
- **TONA:** Pull full history via the BoJ API in one batch. Series goes back to 1985 in some form, but reliable data is from 1998 onward.
- **AONIA:** Single fetch of F1 CSV gets you the full history. Cash Rate Target goes back to 1990; AONIA fixing goes back further.

### Failure Modes to Handle

1. **Holiday alignment:** Each country has different bank holidays. Don't treat missing observations on Canadian Thanksgiving, Japanese Golden Week, or ANZAC Day as failures.
2. **Revision tracking:** CORRA in particular gets revised. Either accept last-write-wins on the primary key, or maintain a revision history table.
3. **Network issues for BoJ:** The BoJ API is new and may have stability issues. Build retry logic with exponential backoff.
4. **RBA CSV format changes:** The RBA occasionally adjusts table formats. Write defensive parsing that logs warnings rather than crashing on unexpected structure.

### Integration with Existing Stack

Given the existing `dashboardv1` patterns:
- Add a `collectors/` module per source (`bocCollector.js`, `bojCollector.js`, `rbaCollector.js`) mirroring the Schwab and FRED collector structure.
- Reuse the incremental sync pattern from the Treasury Fiscal Data integration.
- Standardize on storing series in a single `overnight_rates` table rather than per-country tables — makes the global STIR curve comparison easier.
