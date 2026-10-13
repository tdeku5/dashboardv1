# Asset Class Models — design system revamp

## Context

Revamp the visual design of the **ASSET CLASS MODELS** section of the TND Research Terminal (`dashboardv1`) — MACRO / RATES / EQUITIES / FX / COMMODITIES, their country tabs, and every section page beneath them. The goal is legibility and polish: crisper type, consistent spacing, better contrast, uniform tables and charts. **This is a styling pass, not a feature or layout-restructuring pass.**

**Hephaestus is the design template.** Its dark navy / steel-blue theme (`--hp-bg: #0E1621`, `--hp-accent: #5B9DD9`) is the target look, adopted in full — navy background and steel-blue accents, not just borrowed typography.

### Prerequisite — do not start before this lands

The open **Hephaestus typography prompt** must be completed and committed first: moving Hephaestus chrome from monospace to the sans face used in its empty state, fixing the model-selector clipping, and preserving monospace only for inline series-ID chips and `<SpecChart>` internals.

That prompt defines the type system this revamp copies. Starting first would mean templating off a face Hephaestus is about to stop using. **Phase 0 must verify it has landed and stop if it hasn't.**

### Design direction

**Typography.** Sans for all chrome — navigation, headings, labels, buttons, panel titles, prose. **Monospace with `font-variant-numeric: tabular-nums` for numeric data** — table figures, stat values, axis ticks, anything that must align in a column or sit still as it updates. The rule is semantic, not positional: a number is mono because it is a number, not because of where it sits.

**Palette.** Full Hephaestus adoption: `#0E1621` background, `#5B9DD9` accent, with a defined set of surface elevations, border tones, and a four-step text hierarchy.

**Density.** Keep the terminal's information density. This is not a whitespace-heavy redesign — it is the same density, made legible through consistent alignment, spacing, and contrast.

Read `CLAUDE.md` first for file paths, conventions, and process guardrails.

---

## Phase 0 — Audit (STOP at the gate; change nothing)

Diagnostic-first. Inspect and report; write no CSS.

**A. Prerequisite check.** Confirm the Hephaestus typography work is committed. Report the commit and the resolved sans font stack it settled on. **If it has not landed, stop here and report that** — do not proceed on a provisional type system.

**B. Page and component inventory.** Enumerate every page under ASSET CLASS MODELS: asset class, country, section, file path, and the CSS module(s) each uses. Report the total page count and the count of distinct CSS module files.

**C. Duplication.** Recent pages were built by copying an existing page's CSS module. Quantify it: how many CSS modules contain substantially identical rule blocks, and roughly how many lines are duplicated across the section. This number is the case for the token layer and the baseline to measure against.

**D. Current style sprawl.** Across the section's stylesheets, report:
- every distinct `font-size` value, with usage counts
- every distinct hardcoded color literal (hex, rgb, hsl), with usage counts
- every distinct spacing value used for padding/margin/gap
- every distinct `font-family` declaration
- which files already reference CSS custom properties versus hardcoding

**E. Hephaestus tokens — read, don't assume.** Extract the actual token values from Hephaestus's own stylesheet: every custom property it defines, with values. Confirm `--hp-bg` and `--hp-accent` against the source rather than trusting the values quoted above. Report the full set, including any type-scale, spacing, or border tokens it already defines.

**F. Semantic colors — identify what carries meaning.** Some color in this section is informational and **must survive the revamp with its meaning intact**. Catalogue every such use, with file and current value:
- up/down and positive/negative indicators
- surprise or beat/miss shading
- country identity colors (the dots in the country column)
- the nav's per-item state colors (the current nav renders RATES in blue, US in green, FORWARD PRICING in red) — **determine whether these encode anything or are arbitrary**, and report which. The answer decides whether the nav gets a single unified active treatment or keeps a color mapping.
- any threshold, breach, or alert styling

**G. Charts.** Report how Recharts is configured across the section: is there a shared theme or chart-wrapper component, or does each page configure axes, grids, tooltips, and series colors inline? List every distinct series-color array in use.

**H. Risk surface.** Identify any component in this section shared with pages **outside** it (Economic Calendar, Portfolio Analytics, Hephaestus, US Macro Snapshot, News Aggregator). Changing a shared component's styling reaches those pages, so they must be named now and checked at every gate.

**Deliverable:** written findings, then **STOP**.

---

## Phase 1 — Token layer and primitives (STOP at the gate)

No page changes in this phase. Build the vocabulary, prove it compiles, change nothing visible yet.

### Token layer

One file defining the whole system as CSS custom properties. Tokens are the single source of truth; no page may hardcode a value a token covers.

**Color.**
- Surfaces: at least background / panel / raised / overlay, derived from `#0E1621` as distinct elevation steps.
- Borders: hairline and emphasis tones.
- Text: a **four-step hierarchy** — primary, secondary, tertiary, disabled.
- Accent: `#5B9DD9` plus hover/active/muted variants.
- Semantic: positive, negative, warning, and the preserved informational colors from Phase 0-F, **re-tuned for contrast against navy** without changing what they mean. A red that reads on near-black may not read on `#0E1621`; adjust the value, never the semantics.

**Contrast is a hard requirement, not a preference.** Compute and report the contrast ratio of every text token against every surface token it is used on. Primary and secondary text must meet **WCAG AA (4.5:1)**; tertiary and disabled must meet **3:1** minimum. Any pair that fails gets the token adjusted until it passes. Report the full matrix at the gate.

**Typography.**
- Two families: the Hephaestus sans (chrome) and a monospace (numerics).
- A type scale of **no more than six sizes**. Phase 0-D will likely show far more in use; collapsing to a scale is a large part of the "crisper" result.
- Weights limited to **three at most**.
- Line heights: tight for tabular data (≈1.2–1.35), relaxed for prose (≈1.5).
- Uppercase nav and section labels get positive letter-spacing (≈0.05em); monospace numerals get none.
- A `tabular-nums` utility applied wherever figures render, **including sans numerals appearing inline in prose**.

**Spacing.** A 4px-base scale. No arbitrary pixel values in page CSS.

Also define border radii, border widths, and any focus-ring treatment, so interactive states are consistent.

### Shared primitives

Build (or consolidate toward) a small set of components that every page composes from. Follow the existing shared-component conventions found in Phase 0 rather than inventing a new pattern:

- **Page header** — title, subtitle, as-of date.
- **Section tabs / nav row** — the three-tier navigation, with one unified active-state treatment (unless Phase 0-F found the per-item colors are semantic).
- **Panel / card** — the standard bordered container.
- **Data table** — the important one. Left-aligned labels, **right-aligned numerics**, tabular figures, hairline row separators rather than zebra striping (striping reads as noise on dark backgrounds), sticky headers for long tables, consistent row height and cell padding, and `–` for nulls.
- **Stat tile / strip** — label, value, delta, as-of.
- **Chart container** — consistent title, legend placement, and padding.
- **Collapsible panel** — for methodology and reference sections.

### Chart theme

One shared Recharts theme object: axis stroke, tick font and color, grid stroke and opacity, tooltip surface and border, and an **ordered series palette**. The palette must be distinguishable on `#0E1621`, reasonably colorblind-safe, and must not be six shades of the accent blue. Every chart in the section consumes this object rather than configuring inline.

### Gate

Report the contrast matrix, the token file, the primitive inventory, and confirmation that the build is clean and all suites green. No page should look different yet — confirm that explicitly.

---

## Phase 2 — Pilot: US Rates → VOL (STOP for visual review)

Convert exactly one page to prove the system, then stop.

**Use the US Rates VOL page.** It exercises nearly every primitive: stat strip, four charts, a contribution table, a collapsible methodology panel, a data-quality note, and null rendering. If the system works there it will work everywhere.

Requirements:

- Every color, size, and spacing value comes from tokens. **No hardcoded literals remain in this page's CSS.**
- The page composes the shared primitives rather than carrying its own copies.
- Numeric columns are right-aligned and tabular; labels are sans.
- The `–` null convention and the parenthesised-negatives convention are preserved exactly.
- No change to data, calculations, routes, or behaviour. If markup must change to adopt a primitive, that is fine; a behaviour change is not.

**This gate requires my visual review.** There is no browser in the WSL environment, so you cannot see the result — do not claim the page "looks" any particular way. Confirm the dev server is running, report the URL, list what changed structurally, and stop. I will look at it and respond before the rollout.

---

## Phase 3 — Rollout (STOP at the gate)

Convert the remaining Asset Class Models pages, mechanically, in asset-class batches (RATES, then MACRO, EQUITIES, FX, COMMODITIES). After each batch, report pages converted and hardcoded literals remaining.

Any page that cannot adopt a primitive without a behaviour change: **stop and report it** rather than forcing the primitive or forking a variant.

At the end, report the delta against the Phase 0-C and 0-D baselines: duplicated CSS lines eliminated, distinct font sizes remaining, hardcoded color literals remaining.

---

## Acceptance criteria

1. The Hephaestus typography work is confirmed committed before any other work begins; its sans stack is the one used here.
2. The token file defines surfaces, a four-step text hierarchy, accent variants, semantic colors, a type scale of ≤6 sizes, ≤3 weights, and a 4px spacing scale.
3. The full contrast matrix is reported, computed not estimated. Primary and secondary text meet 4.5:1 on every surface they appear on; tertiary and disabled meet 3:1. Report any pair that needed adjustment and its final value.
4. Every semantic color catalogued in Phase 0-F still carries its original meaning, with values re-tuned for navy where needed. Positive/negative, surprise shading, country identity, and threshold styling all verified individually.
5. Every Asset Class Models page mounts without throwing, verified per page with results pasted from command output.
6. Numeric columns across the section are right-aligned and render with tabular figures; labels and chrome render in sans.
7. Null rendering (`–`) and parenthesised negatives are unchanged everywhere they appeared before.
8. All charts consume the shared chart theme; no inline axis, grid, tooltip, or series-color configuration remains in the section.
9. Hardcoded color literals, font sizes, and spacing values remaining in Asset Class Models page CSS: report the count against the Phase 0-D baseline. The target is zero; anything remaining is named with a reason.
10. Duplicated CSS lines eliminated, reported against the Phase 0-C baseline.
11. `tsc --noEmit` clean on both packages, strict, no `any`; both suites green; all counts pasted from actual command output.
12. No change to any route, query, calculation, or data value anywhere in the section — confirmed by showing the diff touches only styling, markup, and component files.

## What not to break

- Every page, route, collector, cron job, and table in the terminal. This is a styling pass; data and logic are untouched.
- **Pages outside Asset Class Models** — Economic Calendar, Portfolio Analytics, Hephaestus, US Macro Snapshot, News Aggregator, Misc Charts. Any shared component identified in Phase 0-H must be verified on its out-of-section consumers at every gate, not just the pilot.
- Hephaestus itself — it is the template, not a target. Do not restyle it.
- The informational meaning of every semantic color.
- The three-tier navigation hierarchy and all existing routes and URLs.
- The terminal's information density. Do not convert dense tables into airy cards.
- Commit hygiene: explicit path staging only, `git add -A` prohibited, server-first ordering where server files are touched.

## Out of scope

- Layout and information-architecture changes: no moving, merging, splitting, renaming, or reordering pages, tabs, or sections. Visual treatment only.
- New features, new charts, new metrics, new pages.
- Responsive and mobile layouts, and any light-mode or theme-toggle work.
- Replacing Recharts or introducing a component library, CSS framework, or CSS-in-JS runtime.
- Restyling sections other than Asset Class Models. The token layer should be reusable by them later, but converting them is a separate job.
- Animation, transitions, and micro-interactions beyond simple hover and focus states.
- The TradingView date-convention fix and any other outstanding data work.

---

## Guardrails

- **Diagnostic-first.** Phase 0 is inspection only. If the prerequisite hasn't landed or the audit turns up something that invalidates the plan, stop and report.
- **Tokens or nothing.** If a value is needed that no token covers, add the token — never a one-off literal in a page.
- **You cannot see the result.** There is no browser in this environment. Never assert how something looks, renders, or reads. Report what changed and what is verifiable (computed values, token usage, contrast math, mount tests) and leave visual judgement to me.
- **All verification numbers pasted from command output**, never narrated or estimated, per the `CLAUDE.md` convention.
- **Re-read this file from disk at each gate** and attest the implementation against it line by line, flagging deviations explicitly.
- Targeted minimal changes; consolidate toward existing shared components rather than introducing parallel ones.
