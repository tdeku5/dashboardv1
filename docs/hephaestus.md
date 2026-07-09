# Hephaestus — In-Terminal AI Charting Agent (v1)

Hephaestus turns natural-language chart requests into declarative chart specs
drawn from the terminal's `series_catalog`, renders them server-side, and lets
charts be saved to Misc. Charts where they re-render with live data on every
load.

## Architecture

```
user text ──▶ POST /api/hephaestus/chat            (Claude tool loop, server-side)
                 tools: search_catalog · peek_series · list_params · emit_chart_spec
                 └──▶ ChartSpecV1 (validated)
ChartSpecV1 ──▶ POST /api/hephaestus/render        (the ONE render path)
                 └──▶ aligned rows + per-series metadata ──▶ <SpecChart>
save ─────────▶ saved_charts (spec JSON only)  ──▶ Misc. Charts re-renders live
```

Core invariants:

- **The model never writes SQL and never emits data values.** Its only chart
  output channel is the `emit_chart_spec` tool; the spec references catalog
  entries by `series_id`. Every number on a chart comes from the render engine
  reading SQLite — fabricated data is structurally impossible.
- **Search-based resolution.** The catalog (~2,800 entries) is far too large
  for context injection; the model finds series with `search_catalog`
  (≤15 results), inspects with `peek_series` (≤5 points + count/min/max) and
  `list_params`.
- **One render path.** The chat preview and saved charts both call
  `POST /api/hephaestus/render`; a saved spec always re-renders exactly as the
  agent produced it, reflecting newly ingested data with no stored snapshot.

Server code: `server/src/hephaestus/` (`chartSpec.ts`, `transforms.ts`,
`render.ts`, `catalogSearch.ts`, `claudeClient.ts`, `chat.ts`) +
`server/src/routes/hephaestus.ts`. Client: `client/src/lib/hephaestus.ts`
(type mirror + API helpers), `client/src/components/charts/SpecChart.tsx`,
`client/src/pages/HephaestusPage.tsx`, Saved Charts block on
`MiscChartsPage.tsx`.

## ChartSpecV1

```ts
{
  version: 1,
  title: string,                       // ≤160 chars
  series: SpecSeries[],                // 1–8 entries
  from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD',
  leftAxisLabel?: string, rightAxisLabel?: string,
}

// Direct series (kind may be omitted):
{ kind: 'direct', id, param?, transform?, label?, axis? }

// Derived series (a op b):
{ kind: 'derived', op: 'subtract'|'add'|'ratio',
  a: {id, param?}, b: {id, param?},
  label,                               // required
  transform?, axis? }
```

- `id` is a `series_catalog.series_id` (globally unique). `param` is required
  for `parameterized` entries (gilt maturities) and `contract_family` entries
  (member contract symbol), and forbidden on `single`.
- Validation is two-layer: structural (shape, windows, dates), then catalog
  resolution (refs exist, renderable source table, param validity). Both run
  on emit, on `POST /render`, and on saved-chart create — a malformed spec
  never reaches data-access code.
- Not renderable in v1 (event/multi-column shapes): `economic_releases`,
  `treasury_auctions`, `treasury_investor_class`, `gdpnow_*`.

## Frequency-alignment rule (canonical)

**The x-axis is the union of observation dates across the spec's series; a
series contributes a value only on its own native observation dates; missing
cells are `null`. There is no forward-fill, interpolation, or resampling — the
renderer never manufactures values.**

This supersedes the forward-fill rule in the original Phase 1 design (accepted
deviation, Phase B gate). Consequences:

- The client renders lines with `connectNulls`, so a monthly series plotted
  against a daily one draws as a continuous line between its true monthly
  points rather than as disconnected dots. `<SpecChart>` shows a subtle
  annotation when a chart mixes frequencies (and when it mixes SA/NSA).
- **Derived-op sparsity:** a derived series computes only on dates where BOTH
  inputs have a native observation. daily⊖daily aligns fully; daily⊖monthly
  yields at most monthly points. This is intended, sparse-but-honest behavior
  — do not "fix" it with fill. The agent warns in its text response when a
  requested derived series mixes input frequencies, and the render response
  carries a warning plus `frequency: "mixed (daily / monthly)"` on the series.

## Transforms

Applied server-side, per series; for derived series the transform applies
AFTER the op.

| Transform | Meaning |
|---|---|
| `level` (default) | raw values |
| `rebase100` | = 100 at the first point **in range** (range is applied first) |
| `yoy_pct` | % change vs own observation ~1 year back (calendar lookback, 45-day tolerance; points without an in-tolerance base are skipped) |
| `mom_pct` | % change vs ~1 month back (15-day tolerance) |
| `diff` {periods} | value minus value `periods` observations back |
| `zscore` {window} | rolling z-score over `window` observations (zero-variance windows skipped) |
| `rolling_mean` {window} | trailing mean over `window` observations |

Lookback transforms (`yoy_pct`/`mom_pct`/`diff`/`zscore`/`rolling_mean`) are
computed **before** the `from` cut so they can see pre-range history;
`rebase100` is computed **after** it.

Validator bounds: `periods`/`window` must be integers between 1 and 2000
(`zscore` requires ≥ 2). A window longer than the series simply yields an
empty result plus a "no observations" warning — the validator does not know
series lengths. `rebase100` errors if the first in-range value is 0. Transforms
apply identically to direct and derived series (after the op for derived).

## Freshness

Only FRED-backed `series_observations` entries are refreshed at render time
(same `ensureFresh` path as `/api/fred`: staleness check, per-series lock,
negative cache). The gate is the catalog's `data_source === 'FRED'` — BEA_*
rows share the table and must never trigger a FRED call (unit-tested). A
refresh failure downgrades to a warning; stored data is served.

## Models

| Role | Constant | ID (live-verified 2026-07-09) |
|---|---|---|
| Default | `HEPHAESTUS_DEFAULT_MODEL` | `claude-sonnet-5` |
| Alternative | `HEPHAESTUS_ALT_MODEL` | `claude-opus-4-8` |

No sampling parameters, no `thinking` config (both rejected by these models),
`max_tokens: 8192`. Client selection lives in `localStorage['hephaestus.model']`,
sent per-request, validated server-side against the allowlist. The
economic-calendar Claude client is a separate module and is not affected.

## Caps & guardrails

- Agent loop: 10 tool iterations, 60s wall clock.
- `search_catalog` ≤15 results; `peek_series` ≤5 points (+ count/min/max).
- ≤8 series per spec; ≤15,000 points per series (most recent kept; truncation
  noted in `warnings`).
- Per chat request the server logs: model, iteration count, tool calls, token
  usage (server log only).

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/hephaestus/chat` | `{messages, model?}` → `{reply, spec?, iterations, toolTrace, usage}` |
| `POST /api/hephaestus/render` | ChartSpecV1 → `{title, series[], rows[], warnings[]}` |
| `GET /api/hephaestus/charts` | list saved charts (spec JSON, no data) |
| `POST /api/hephaestus/charts` | `{name, spec}` — spec validated before insert |
| `PATCH /api/hephaestus/charts/:id` | rename only (spec editing out of scope in v1) |
| `DELETE /api/hephaestus/charts/:id` | delete |

## v1 exclusions

No SQL tool, no arbitrary-expression transforms (fixed enum only), line charts
only, no streaming, no server-side conversation persistence (the client resends
history), spec editing limited to rename.
