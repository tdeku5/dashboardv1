# Asset Class Models design revamp — working notes

Running rules distilled from the approved prompts in `docs/prompts/asset-class-models-design-revamp*.md`.
The prompts win on any conflict; this file is the quick reference while building.

## Colour rules

1. **Colour is never the only signal of sign.** Every signed number keeps its leading ASCII `-` (Decision 3).
2. **Channels (Rule 2, amended at Turn 1 approval):** valence and direction tokens colour **text only**, except inside the named heatmap components, which use `--acm-heat-*` fills. Alert tokens colour a background tint, badge or outline, never value text. Status-warning is for notes and banners, never data cells.
3. **Named heatmap components** (the only background-fill sign colours):
   - the `cellColor` grid (the `--acm-heat-rate-*` scales, per rule 6(b)): `GlobalRatesPage`, `CountryCurvePage`, `STIRDashboardPage` ×2
   - `ReturnsHeatmap` (valence scale `--acm-heat-positive-*` / `--acm-heat-negative-*`)
   - the STIR strip move cells (valence scale; `STIRDashboardPage` `stripHeatClass`, CSS `.stripHeat*`): the implied-rate Δ columns (added at the R2a approval) and the FF table's price-change cells (added at the R2b approval). Price down / rate up → `--acm-heat-negative-*`, price up / rate down → `--acm-heat-positive-*`. Steps by |Δ| ÷ the column's max |Δ|: (0, 25%] → 1, (25, 50%] → 2, (50, 75%] → 3, (75, 100%] → 4; zero / null → no fill, muted text. Each fill sits on an opaque `--acm-surface-panel` base so pack tints and FF year bands never stack under it.
   - the CREDIT SPREADS table Δ cells (valence scale; `STIRDashboardPage` `creditHeatClass`, CSS `.creditHeat*`; added at the R3b turn): the 1D–YTD Δ columns wherever the table renders (US CREDIT, EU CREDIT). Widening → `--acm-heat-negative-*`, tightening → `--acm-heat-positive-*`; the same quartile-of-column-max steps as the strip; no fill when the change rounds to zero at its 0dp display; the `Last (bp)` level column stays plain.
   - The `cellColor` grid's scale and timing: see rule 6(b).
   - Heatmap cells never carry an alert treatment; cell text is always `--acm-text-primary`.
   - Enforced by `client/src/pages/assetClassModels.heatmaps.test.ts` (only these components may reference `--acm-heat-*`, each on its own scale).
4. **Identity colours** come from `client/src/constants/identityColors.ts` only. Sign/state colours come from `acm-tokens.css` only. The two never share a value (tested).
5. **Token names** carry the `--acm-` prefix; wherever a prompt says `--negative`, `--dir-up`, … read `--acm-negative`, `--acm-dir-up`, ….
6. **The red / green direction rule (R2b approval; restated by `docs/prompts/acm-revamp-rebase-and-red-green-direction.md` + addendum, which removed blue / orange from every direction meaning).** Any change in a **yield, rate or spread** is red when it rises and green when it falls (bond-price view). `--acm-dir-up` / `--acm-dir-down` name that pair (aliases of `--acm-negative` red / `--acm-positive` green); no direction meaning uses blue or orange:
   - yield / rate / spread **up** → `--acm-negative` (red); **down** → `--acm-positive` (green);
   - futures **price up** (rate down) → `--acm-positive`; **price down** (rate up) → `--acm-negative`;
   - **hike → red, cut → green** everywhere (a priced hike is a rate increase): NEXT MOVE, FORWARD PRICING summary, badges;
   - heatmaps showing these use the valence heat scale with the same orientation (`--acm-heat-negative-*` for increases).
   - **Levels vs changes (R2d approval, Decision 1):** levels → no colour; changes → per rule 6. A spread, butterfly, credit-spread, breakeven or other level (e.g. 2s10s +31bp, 2s5s10s -5bp, 5s10s real, 5s10s BE, a calendar-spread value) renders as plain primary text, wherever the old code coloured it by sign. Identity colours may stay on tile labels, legend chips and chart lines; only the value goes to primary.
   - **Covers:** STIR strip moves, calendar-spread Δ columns, Terminal−OCR and ±OCR, FORWARD PRICING Δ bars and summary bps / implied-move cells, every yield and rate Δ on UST CURVE, YIELD ATTRIBUTION, MONEY MARKETS, POLICY RATE, country curve and term-structure pages, GLOBAL rates, GlobalForwardCurves and DailyChangeModal, credit-spread changes (widening → red), breakeven changes (a rise is red: a breakeven is a nominal − real yield spread; R2d approval, Decision 2), curve spreads such as 2s10s (spread up → red), and the `cellColor` grid.
   - **Orientation note — intended, do not "fix":** in rates displays red means *up*; in returns displays (equities, FX, commodities) red means *down*. Rates follow the bond-price view. Neither should be "corrected" to match the other.
   - **Not covered:** returns (equities, FX, commodities) stay valence with up = green; unsigned extremeness flags (e.g. the VOL stat tile's z-score) stay on alert tints. Anything where it is unclear whether a value is a yield or spread change is reported to the user, not decided.
   - **Exceptions (the user's decisions — do not "fix"):**
     - (1) **Heatmap backgrounds for yield / rate changes stay red / blue.** The `cellColor` grid (UST CURVE, country curves, GLOBAL, incl. the signed z-score grid) uses its own symmetric scale: increase → `--acm-heat-rate-up-*` (the `--acm-negative` red), decrease → `--acm-heat-rate-down-*`, built on its own blue base `--acm-heat-rate-blue` (#7CC4F2) — never derived from the direction tokens, so re-pointing direction can't recolour it. Alphas 12 / 23 / 35 / 46% on both sides; 4 steps; no-fill neutral; opaque panel base. **Text on these cells stays primary** (`--acm-text-primary`): red / green text over the red / blue steps measured 1.86–3.98:1 and failed AA, so the user chose primary text at the addendum gate. The legacy GLOBAL delta columns (`deltaCellStyle`, pre-conversion) already put red / green text on a lighter red / blue tint and are untouched. `--acm-heat-negative-*` stays with the strip and FF heatmaps.
     - (2) **The US Rates VOL implied-vol premium (MOVE − realized MOVE) stays orange / blue** — `--acm-vol-premium-up` (#F0954A) / `--acm-vol-premium-down` (#7CC4F2) via the `vol-premium-up` / `-down` tones — a spread between volatilities, not a yield or rate spread.
   - **Direction family:** `--acm-dir-up` / `--acm-dir-down` (and the `dir-up` / `dir-down` tones, `.dirUp` / `.dirDown` classes) are the red / green pair. The old blue / orange direction values now live only on exception 2; the `--acm-heat-dir-*` scale was removed.
   - Pinned by `client/src/pages/assetClassModels.redGreenRule.test.ts` (yield up → red, futures price up → green, hike → red, and both exceptions, end to end), `client/src/pages/STIRDashboardPage.stripTones.test.tsx` (STIR STRIPS + FORWARD PRICING), `client/src/pages/assetClassModels.ratesColour.test.ts` (the premium's orange / blue appears nowhere else in the rates area; the `cellColor` grid uses exactly the two rate scales) and `client/src/styles/acmTokens.test.ts` (token values, rate-scale symmetry and contrast).

## Component-level root rule (Turn 2 approval)

Every token is scoped under `.acm-root`. To stay self-contained wherever it mounts:

- **Every shared primitive** puts `acm-root` on its own outermost element.
- **Every component that renders on a route outside the section** does the same. Known case: `TreasuryAuctionContent` (also the standalone `/treasury` route). A pending test (`acmRoot.crossRoute.test.tsx`) enforces this once it is converted in Phase 3; `/treasury` adopts the new look for that component's content only — the `/treasury` shell and `NavDropdown` stay untouched.
- Page-level `.acm-root` wrapping is still fine for section pages.
- Registry colours are JS constants and resolve anywhere; only the CSS-variable tokens need the root class.
- `NavDropdown` and `FredRefreshButton` are cross-route but are **not converted** (Decision 4), so they need no root class.

## Turn 4 primitive spec

All primitives live in `client/src/components/acm/`, one `.tsx` + `.module.css` each (the existing `components/` convention), and:

- put `acm-root` on their own outermost element (rule above);
- take every colour, size, space, radius and font from `--acm-*` tokens — no literals;
- render sans for chrome, `acm-num` (mono, tabular) for numbers;
- render nulls as the em dash `—` and negatives with ASCII `-` (callers format; primitives never re-format numbers).

| Primitive | Requirements |
|---|---|
| Page header | title, subtitle, as-of date |
| Nav tiers | the three tiers (asset class / country / section), one unified active treatment (`--acm-accent-hover` text on `--acm-accent-muted`, border `--acm-accent-active`); replaces the per-tier blue/green/red, which encode nothing |
| Panel | standard bordered container on `--acm-surface-panel` |
| Data table | left-aligned labels, right-aligned tabular numerics, hairline row separators (no zebra), sticky header option, consistent row height + cell padding, `—` for nulls |
| Stat tile / strip | label, value, delta, as-of |
| Chart container | title, legend slot, consistent padding; charts inside consume `chartTheme` |
| Collapsible panel | methodology / reference sections |

Built (Turn 4) in `client/src/components/acm/`: `AcmPageHeader`, `AcmNavTier`, `AcmPanel`, `AcmDataTable`, `AcmStatTile` + `AcmStatStrip`, `AcmChartFrame`, `AcmCollapsible` (barrel: `index.ts`). Shared: `acmFormat.ts` (`—` nulls, U+2212 → `-`), `tones.module.css` (tone = `color` only; alert = `background` + `outline` only), `chartColors.ts` (sign-token list, `signColor`, `toneColor`), `chartTheme.ts`.

## Chart text measurement (Turn 3 fix)

Recharts sizes text in a hidden `<body>`-level span, outside `.acm-root`. Font values on measured text (ticks, `<Label>`s, legend) are therefore literals pinned to their tokens by `chartTheme.test.tsx`; colours stay `var()`.

**Recharts 3.7.0 limitation:** tick-interval measurement (`cartesian/getTicks.js`) passes only `fontSize` + `letterSpacing` to the span, never the family, so ticks are measured in the page `<body>` face (`system-ui`) whatever the theme says. Measured in headless Chromium: drawn Plex Mono tick labels are 0.94–1.10× the measured width (`chartFontLoading.browser.test.ts`). `<Label>`/wrapped `Text` measurement does pass the family.

## Literal counting instrument (R2c approval)

From R2d on, every literal figure — per section, per file and the Z deltas — comes from `scripts/acm-literals.py` only. The Phase 0-D baselines (91/523 and 124/1,531 colour, 34/15 font sizes, 27/24 spacing) and the R1 per-file counts were taken with an earlier counter that was not kept, so they are not comparable. Z deltas run from the **re-measured `7512e85` baseline** taken with this script (figures below), not from Phase 0's original numbers.

Section = every file reachable from `pages/STIRDashboardPage.tsx` by relative import, minus the definition layer (`components/acm/`, `styles/acm-tokens.css`, `constants/identityColors.ts`), counted on its own. `python3 scripts/acm-literals.py --section --rev <REV>` reproduces these:

| Revision | Scope | colour | font-size | spacing | total | radius |
|---|---|---|---|---|---|---|
| `7512e85` (Phase 0 baseline) | section TSX/TS (93 files) | 1,559 | 279 | 146 | 1,984 | 86 |
| `7512e85` | section CSS (18 modules) | 523 | 214 | 387 | 1,124 | 99 |
| `1cfa75e` | section TSX/TS (93 files) | 1,537 | 278 | 146 | 1,961 | 86 |
| `1cfa75e` | section CSS (18 modules) | 472 | 193 | 355 | 1,020 | 88 |
| `1cfa75e` | definition layer (22 files) | 213 | 0 | 0 | 213 | 0 |

## Process: branches and the RATES commit (2026-10-28)

`acm-revamp` is pushed to GitHub, so it is **never force-pushed** (supersedes the earlier `git reset --soft` squash plan). Work on it is committed and pushed normally. After R5, once RATES is approved:

1. Commit any remaining R5 work on `acm-revamp` normally and push it normally (no force).
2. `git switch main`, then `git merge --squash acm-revamp`.
3. Paste `git diff --cached --stat` and confirm **no `server/` or data-ingestion file** appears; only design work may differ from `main`. Anything else → stop and report.
4. Commit on `main` as one RATES commit (message summarises R1–R5 and the colour rules), then push `main` normally.
5. Leave `acm-revamp` on GitHub untouched as an archive; never delete it unless asked.
6. Continue MACRO and later batches on a new branch `acm-revamp-2` cut from the updated `main`.
