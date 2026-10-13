# Asset Class Models design revamp — working notes

Running rules distilled from the approved prompts in `docs/prompts/asset-class-models-design-revamp*.md`.
The prompts win on any conflict; this file is the quick reference while building.

## Colour rules

1. **Colour is never the only signal of sign.** Every signed number keeps its leading ASCII `-` (Decision 3).
2. **Channels (Rule 2, amended at Turn 1 approval):** valence and direction tokens colour **text only**, except inside the named heatmap components, which use `--acm-heat-*` fills. Alert tokens colour a background tint, badge or outline, never value text. Status-warning is for notes and banners, never data cells.
3. **Named heatmap components** (the only background-fill sign colours):
   - the `cellColor` grid (direction scale `--acm-heat-dir-*`): `GlobalRatesPage`, `CountryCurvePage`, `STIRDashboardPage` ×2
   - `ReturnsHeatmap` (valence scale `--acm-heat-positive-*` / `--acm-heat-negative-*`)
   - Heatmap cells never carry an alert treatment; cell text is always `--acm-text-primary`.
4. **Identity colours** come from `client/src/constants/identityColors.ts` only. Sign/state colours come from `acm-tokens.css` only. The two never share a value (tested).
5. **Token names** carry the `--acm-` prefix; wherever a prompt says `--negative`, `--dir-up`, … read `--acm-negative`, `--acm-dir-up`, ….

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
