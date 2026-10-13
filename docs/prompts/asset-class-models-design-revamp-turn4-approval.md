# Turn 4 — Approved. Tick spacing: option (a). Then Turn 5.

Turn 4 is accepted. All seven primitives (eight components counting the stat strip) carry `acm-root`, no primitive stylesheet contains a raw color or length, the data table's channel rules are tested, and nav tiers no longer use per-tier colors. The real-browser font-loading test was a good addition.

---

## Tick spacing — option (a), set in the theme now

Recharts 3.7.0 passes only font size and letter spacing to its measuring element, never the font family. So tick labels are measured in `system-ui` and drawn in Plex Mono. You were right that (b) is out of bounds: it changes measurement for every chart in the app, including pages whose ticks use a different mono stack.

The error is predictable rather than random. Plex Mono is fixed-width, about 0.6em per character, while `system-ui` digits measure at about 0.55em, so drawn labels run about 1.1× their measured width. That matches the top of your measured 0.94–1.10× range, and a fixed extra gap covers it.

- Set `minTickGap: 10` in `chartTheme.ts`. It applies to every section chart through the theme, and to nothing outside the section.
- Add a short comment beside it citing `cartesian/getTicks.js` and the measured ratio, so nobody later "tidies" it back to 5.
- Y-axis widths are set explicitly, not measured, so they're unaffected. Confirm this holds for the theme's Y-axis default, and report the width value used.

I'll check for crowding and overlapping labels on the VOL pilot's date axis.

---

## One check — active nav contrast

`AcmNavTier`'s active state is accent text over a muted accent fill. The token test checks accent text against plain surfaces, not against the muted fill sitting on a surface.

Add the composited case: `--acm-accent` text over `--acm-accent-muted` layered on `bg` and on `panel`. It must reach ≥ 4.5:1. If it doesn't, lighten the active text by the smallest step that passes; don't change the fill. Paste the numbers.

---

## Turn 5 — 55-view mount harness

Build the permanent per-view mount harness: every asset class × country × section reachable through the React-state nav, including the 8 placeholders. Each view mounts without throwing, and the harness asserts that view's expected heading or identifying text. A view that silently renders the wrong section must fail.

Report the count from command output. Stop with a status line.

Turn 6 is the Phase 1 gate report, as specified in the decisions file.

---

## Acceptance criteria

1. `minTickGap: 10` is set in the chart theme with the explanatory comment, and the Y-axis width default is reported.
2. The composited active-nav contrast passes ≥ 4.5:1 on `bg` and `panel`, with numbers pasted from the test.
3. The harness mounts all 55 views and asserts identifying content for each; its pass count is pasted.
4. `git diff --stat 7512e85` still shows only `lib/cellColor.ts` among tracked files, and no page imports a primitive.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- The 354 passing tests and the 1 deliberately skipped `TreasuryAuctionContent` test.
- Global Recharts measurement behavior on every page outside the section.

## Out of scope

- Any global CSS targeting Recharts' measuring element.
- Upgrading or patching Recharts.
- Converting any page (Phase 2 onward).
