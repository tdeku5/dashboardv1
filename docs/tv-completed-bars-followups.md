# TV completed bars — known follow-ups

Recorded at the Phase 2 sign-off (`docs/prompts/tv-completed-bars-phase2-signoff.md`). Neither item is fixed by the completed-bars change; both are candidates for later work.

## Views assembled from separate requests

Each server request is aligned to one as-of (`lib/tvRead.ts`, `lib/tvViewAsOf.ts`). Requests over the same market group always agree, because each computes the same as-of. Pages that combine requests over **different** groups can show different dates during an intraday window, when one group's session has closed and another's hasn't:

- **GlobalRatesPage** — five separate hooks (`rates-summary`, `yield-curves`, `yield-changes`, `forward-curves`, `calendar-spreads`): the yield-only views and the STIR-only views are aligned separately, so a yield group and a STIR group can land on different dates.
- **VolPage** — SPX and VIX come from per-symbol `/api/tv/series` requests (US_EQUITY, CBOE_VOL_INDEX) and the VX curve from its own endpoint (CBOE_VOL_INDEX + CFE_VX), so the index and the futures curve can sit on different dates.
- **DxyForeignYieldsChart** — one `/api/tv/series` request per foreign 2Y yield; countries close at different times, so the series can end on different dates.
- **Global2s10sRegimeSection** — a 2Y and a 10Y request per country; each country is internally consistent, but countries can end on different dates.
- **CrudeOilPage** — curves (CME + ICE Brent, one view), spread and returns come from separate requests and can disagree around the CME and ICE Brent closes.
- **MetalsPage** — curves (CME), returns (CME + spot) and basis (CME + spot) are separate requests, so the spot-inclusive views can trail or lead the futures curves.

## Slow endpoints (pre-existing)

Measured with the reader harness on a frozen database copy at the Phase 2 gate. These were already slow before the change. The completed-bars filter adds about 7% with every `captured_at` NULL, and about 13% once rows carry `captured_at`.

| Endpoint | Before the change | After, rows with `captured_at` |
|---|---|---|
| `/api/commodities/metals/basis/gold?lookback=1y` | ~3.6 s | ~4.1 s |
| `/api/commodities/crude/spread?lookback=1y` | ~2.9 s | ~3.2 s |
| `/api/global/rates-summary` | ~1.5 s | ~1.9 s |
