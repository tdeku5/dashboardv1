# Asset Class Models design revamp — working notes

Running rules distilled from the approved prompts in `docs/prompts/asset-class-models-design-revamp*.md`.
The prompts win on any conflict; this file is the quick reference while building.

## Colour rules

1. **Colour is never the only signal of sign.** Every signed number keeps its leading ASCII `-` (Decision 3).
2. **Channels (Rule 2, amended at Turn 1 approval):** valence and direction tokens colour **text only**, except inside the named heatmap components, which use `--acm-heat-*` fills. Alert tokens colour a background tint, badge or outline, never value text. Status-warning is for notes and banners, never data cells.
3. **Named heatmap components** (the only background-fill sign colours):
   - the `cellColor` grid (direction scale `--acm-heat-dir-*`): `GlobalRatesPage`, `CountryCurvePage`, `STIRDashboardPage` ×2
   - `ReturnsHeatmap` (valence scale `--acm-heat-positive-*` / `--acm-heat-negative-*`)
   - the STIR strip move cells (valence scale; `STIRDashboardPage` `stripHeatClass`, CSS `.stripHeat*`): the implied-rate Δ columns (added at the R2a approval) and the FF table's price-change cells (added at the R2b approval). Price down / rate up → `--acm-heat-negative-*`, price up / rate down → `--acm-heat-positive-*`. Steps by |Δ| ÷ the column's max |Δ|: (0, 25%] → 1, (25, 50%] → 2, (50, 75%] → 3, (75, 100%] → 4; zero / null → no fill, muted text. Each fill sits on an opaque `--acm-surface-panel` base so pack tints and FF year bands never stack under it.
   - Under the rates colour rule (6), the `cellColor` grid moves from the direction to the **valence** heat scale (increase → negative). The lib converts when its first page (STIR UST CURVE, R2d) converts.
   - Heatmap cells never carry an alert treatment; cell text is always `--acm-text-primary`.
   - Enforced by `client/src/pages/assetClassModels.heatmaps.test.ts` (only these components may reference `--acm-heat-*`, each on its own scale).
4. **Identity colours** come from `client/src/constants/identityColors.ts` only. Sign/state colours come from `acm-tokens.css` only. The two never share a value (tested).
5. **Token names** carry the `--acm-` prefix; wherever a prompt says `--negative`, `--dir-up`, … read `--acm-negative`, `--acm-dir-up`, ….
6. **The rates colour rule (R2b approval; replaces the R2a strip exception and supersedes Decision 2 for rates).** Any change in a **yield, rate or spread** uses the **valence** family in the bond-price view:
   - yield / rate / spread **up** → `--acm-negative` (red); **down** → `--acm-positive` (green);
   - futures **price up** (rate down) → `--acm-positive`; **price down** (rate up) → `--acm-negative`;
   - **hike → red, cut → green** everywhere (a priced hike is a rate increase): NEXT MOVE, FORWARD PRICING summary, badges;
   - heatmaps showing these use the valence heat scale with the same orientation (`--acm-heat-negative-*` for increases).
   - **Covers:** STIR strip moves, calendar spreads and their Δ, Terminal−OCR and ±OCR, FORWARD PRICING Δ bars and summary bps / implied-move cells, every yield and rate Δ on UST CURVE, YIELD ATTRIBUTION, MONEY MARKETS, POLICY RATE, country curve and term-structure pages, GLOBAL rates, GlobalForwardCurves and DailyChangeModal, credit spreads (widening → red), curve spreads such as 2s10s (spread up → red), and the `cellColor` grid.
   - **Orientation note — intended, do not "fix":** in rates displays red means *up*; in returns displays (equities, FX, commodities) red means *down*. Rates follow the bond-price view. Neither should be "corrected" to match the other.
   - **Not covered:** returns (equities, FX, commodities) stay valence with up = green; unsigned extremeness flags (e.g. the VOL stat tile's z-score) stay on alert tints. Anything where it is unclear whether a value is a yield or spread change is reported to the user, not decided.
   - **Exceptions (recovery approval; the user's decisions):**
     - (a) the **US Rates VOL implied-vol premium (MOVE − RMOVE)** stays on **direction** (`--acm-dir-up` orange / `--acm-dir-down` blue) — a spread between volatilities, not yields.
     - (b) the **`cellColor` grid** keeps a **red / blue** gradient: increase → `--acm-heat-negative-*`, decrease → `--acm-heat-dir-down-*`. Same 4 steps per side, no-fill neutral, primary text and opaque panel base as the other heatmaps. This applies to the GLOBAL z-score grid too: signed z-scores of rate changes are a heatmap of change, not an alert flag. **Timing:** the grid keeps its current rgba shading until its pages convert — R2d (STIR UST CURVE) and R5 (country curve pages, GLOBAL) — and moves to these tokens then. This supersedes rule 3's note that the grid moves to the valence scale.
   - **Direction family:** the `--acm-dir-*` tokens and the direction heat scale stay defined and in use: `--acm-dir-*` by the VOL premium, `--acm-heat-dir-down-*` by the `cellColor` grid from R2d. Removal is not on the table at Z.
   - Pinned by `client/src/pages/STIRDashboardPage.stripTones.test.tsx` (STIR STRIPS + FORWARD PRICING) and `client/src/pages/assetClassModels.ratesColour.test.ts` (no direction token anywhere in the rates area except the two named exceptions; the `cellColor` allowance is a pending case until R2d).

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
