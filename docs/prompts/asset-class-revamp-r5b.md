# R5a — Approved. Commit it, then R5b.

R5a is accepted. `CountryCurvePage` and `CountryTermStructure` are at zero, the country curve pages match US UST CURVE, the `niceAxis` helper and its retroactive use on earlier views are approved, moving the UST helpers into `ratesShared.tsx` (with STIR re-exporting `rateChangeTone`) is approved, and the doubled curve title and the COMPRESSED-control fixes are approved. Moving the z-score grid into R5c is fine.

## Step 1 — Commit R5a, and commit every sub-turn from now on

Commit R5a on `acm-revamp`, message `R5a: country curves and term structure`. Stage explicit paths only, including `ratesShared.tsx`, `niceTicks.ts` and its tests, and this prompt once it's saved to `docs/prompts/`. Show the staged stat (nothing under `server/`), push as a normal fast-forward, and paste the hash.

**Standing rule for the rest of the revamp:** every sub-turn ends with a green check, an explicit-path commit and a normal push, before its status block. This supersedes "doesn't ask for a commit". The squash-merge at the RATES gate still collapses them into one commit on `main`.

## Step 2 — R5b: the five fundamental-model panels

Convert the UK, EU, CAD, JPY and AUS `XXFundamentalModelPanel`s, plus the CPI-chart axes (including the US panel's), about 315 literals.

- **Colours: match R2c's US panel.** Each reading in a country panel takes the same colour family as its equivalent in the US panel: inflation and growth readings keep their existing family, labour readings are valence (gain green, loss red, like US payrolls), and identity colours come from the registry. Rule 6 applies only to genuine yield or spread changes. If a reading has no US equivalent, or its classification is unclear, **report it; don't decide**.
- **Axes:** fix the 16 uneven CPI axes from R5a's probe with `niceAxis`. The panels' 42px Y-axes: widen only those that clip.
- **Near-zero:** migrate signed formatters to `roundForDisplay` / `fmtSignedFixed` and list them.
- **Shared modules:** these panels probably share CSS and helpers with each other and with the US panel. Check every importer before editing a shared module, and add new rules under new names, as R4 learned.
- Probe every panel in all five markets, on both STIR STRIPS and FORWARD PRICING if the panel appears on both.

Then commit R5b (`R5b: country fundamental-model panels`) per the standing rule, give the status block, and stop.

---

## Acceptance criteria

1. R5a is committed and pushed normally; the hash is pasted.
2. The five country panels and the CPI axes are at zero TSX literals; colours match the US panel's families, and unmatched or unclear readings are reported.
3. All CPI axes show evenly spaced, non-repeating ticks; any widened Y-axes are listed.
4. Formatters are migrated and listed; the probe is clean in all five markets with no 4xx/5xx.
5. All suites, `tsc`, the harness and the smoke tests are green; R5b is committed and pushed with its hash pasted.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- The US FUNDAMENTAL MODEL panel as approved in R2c.
- `main`, `origin/acm-revamp` history (no force-push), and every data-ingestion commit.
- Plotted data.

## Out of scope

- R5c and R5d (GLOBAL).
- The squash-merge.
- Deleting legacy CSS (Z).
