# Turn 3 — Approved. One fix, then Turn 4.

Turn 3 is accepted. The chart theme's coverage, its token-only values, and the test proving it renders real `var(--acm-*)` values into a Recharts SVG are all what was asked for. Keeping the tick font size as the literal `10`, held equal to `--acm-fs-xs` by a test, is the right call, and the reasoning behind it was correct.

The dashed both-ways grid stands for now. I'll judge horizontal-only at the pilot.

---

## Fix first — tick font family has the same measurement problem

Your reasoning about tick font size applies equally to the tick **font family**. If the theme sets ticks to `fontFamily: 'var(--acm-font-mono)'`, Recharts' hidden measurement element outside `.acm-root` resolves it to the browser default. Labels then get measured in one face and drawn in Plex Mono, so their widths and the axis margins come out wrong.

Check what the theme currently uses for the tick font family, and report it:

- **If it's a `var(--acm-*)` reference:** replace it with the literal font stack string (`'IBM Plex Mono', ui-monospace, monospace` or whatever `--acm-font-mono` resolves to). Add a test asserting the literal equals the token's resolved value, the same way the size test works.
- **If it's already a literal:** confirm it matches `--acm-font-mono` and add the equality test if it's missing.

Apply the same check to anything else Recharts measures outside the DOM tree: legend text and any `<Label>` component. Font-related values in those need literals held equal to tokens by tests. Colors don't, since color doesn't affect measurement.

The `@font-face` declarations in `acm-tokens.css` are global, so the measurement element can load Plex Mono through a literal family name even outside `.acm-root`. Confirm this by mounting a chart and checking that the font loads, rather than assuming it.

---

## Turn 4 — shared primitives

Build the seven primitives to the spec in `docs/asset-class-models-design-notes.md`: page header, nav tiers, panel, data table, stat tile, chart container, and collapsible panel.

These are the core of the revamp, so a few requirements are restated here:

- **Every primitive puts `acm-root` on its own outermost element** (the cross-route rule from Turn 2).
- **Data table:** labels left-aligned, numerics right-aligned in `--acm-font-mono` with tabular figures, hairline row separators (no zebra striping), sticky header option, `—` for nulls, ASCII `-` for negatives. Direction and valence colors apply to value text only. Alert colors apply as cell tint, badge or outline only. Heatmap fills are **not** available from the generic table; they live only in the named heatmap components.
- **Nav tiers:** one unified active treatment across all three tiers, built from accent tokens. This replaces the arbitrary blue/green/red tier colors.
- **Chart container:** consumes the Turn 3 theme. It takes series colors only from the identity registry or sign tokens, passed in by the caller.

Each primitive gets a unit test covering its states (default, active/hover where relevant, null and negative rendering for the table and stat tile). No page adopts them yet.

Stop with a status line.

---

## Acceptance criteria

1. The tick font family, plus legend and `<Label>` font values, are literal strings held equal to their tokens by tests; output pasted.
2. A test confirms Plex Mono loads for a chart mounted outside `.acm-root`.
3. All seven primitives exist, each with `acm-root` on its outermost element and unit tests for its states.
4. The data table enforces the alignment, null, negative and color-channel rules above, each covered by a test.
5. Nav tiers use one active treatment; no tier-specific blue, green or red remains in the primitive.
6. Counts pasted from command output; `git diff --stat 7512e85` still shows only `lib/cellColor.ts` among tracked files, with no page importing a primitive.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- The 311 passing tests and the 1 deliberately skipped `TreasuryAuctionContent` test. It stays skipped until Phase 3.
- The tick font size literal and its equality test.

## Out of scope

- Converting any page (Phase 2 onward).
- Changing the grid style before the pilot review.
- `NavDropdown` and `FredRefreshButton`.
