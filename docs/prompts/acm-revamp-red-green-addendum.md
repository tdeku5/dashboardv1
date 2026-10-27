# Phase 2 Addendum — Two Exceptions to the Red/Green Direction Rule

Phase 1 is accepted: the fast-forward push, the conflict-free rebase, `server/` identical to `main`, and green checks. Proceed to **Phase 2** of `acm-revamp-rebase-and-red-green-direction.md` with the two decisions below. Where they conflict with that spec, this file wins.

Save this file to `docs/prompts/` on `acm-revamp` and re-read both from disk before starting.

---

## Decision 1 — Heatmap backgrounds stay red/blue

Heatmap **cell backgrounds** for yield/rate changes keep the red (up) / blue (down) diverging scale. This applies to the `cellColor` grid, the yield Δ column backgrounds (`deltaCellStyle`), and the `--acm-heat-rate-*` tokens.

**Text colour does follow red/green.** Signed change values, labels, and regime or direction words use red for a yield increase and green for a decrease, even when they sit on a red/blue heat cell.

## Decision 2 — The VOL premium stays orange/blue

The vol premium (MOVE − realized MOVE) is a spread between volatilities, not a yield or rate spread, so the bond-price rule doesn't apply. Leave its colouring unchanged.

---

## Implementation constraint: decouple before re-pointing

Phase 1 reported that `--acm-heat-rate-down-*` is derived from the direction-down (blue) token. If Phase 2 re-points the direction tokens to red/green at token level, as the spec suggests, **the heatmaps and possibly the vol premium would flip silently**.

So, before re-pointing any direction token:

1. Give the heatmap scale its own tokens, holding the **current** red/blue values directly, so they no longer reference the direction tokens.
2. Do the same for the vol premium's orange/blue.
3. Only then re-point the direction tokens to red/green.

The rendered heatmap and vol premium colours must be **pixel-identical** before and after.

---

## Changes to Phase 2 deliverables

- **2a inventory:** list the heatmap backgrounds and the vol premium under "leaving alone", citing Decision 1 or 2.
- **2b docs:** the design-system doc and `CLAUDE.md` must state the red/green rule **and both exceptions explicitly**, so a later prompt doesn't "fix" them. For example: "Heatmap backgrounds use a red/blue diverging scale; text on them follows red/green. The vol premium uses orange/blue."
- **2c tests:** in addition to the spec's mapping test (yield up → red, futures up → green, hike → red), pin:
  - a yield-decrease heat cell → blue background token, green text token;
  - the vol premium → its orange/blue tokens, unchanged.
- **2c screenshots:** include a yield-change heatmap and the VOL pilot's premium, each compared against a pre-change screenshot taken before any edits, and confirm the heat backgrounds and premium colours are unchanged.

**STOP after Phase 2.** Do not push.

---

## Acceptance criteria

- Direction meanings follow red/green as specified: yields, rates and spreads up = red, futures price up = green, hike = red.
- Heatmap backgrounds remain red/blue, and their text follows red/green.
- The vol premium remains orange/blue.
- The heatmap and vol premium tokens no longer derive from the direction tokens, and their rendered colours are unchanged before and after, confirmed by screenshot.
- The docs and `CLAUDE.md` state the rule and both exceptions.
- Tests pin the rule and both exceptions; both packages typecheck and pass tests, with output pasted.
- There is one commit on `acm-revamp`, it includes this addendum, and nothing is pushed.

## What not to break

- `main` and `origin/main` (`f37599e`).
- The completed-bars server logic: `server/` must stay identical to `main`.
- The `acm-revamp-pre-rebase` safety ref.
- Returns/P&L colours, alert colours, and the navy/steel-blue chrome.

## Out of scope

- Changing heatmap scale values or intensity math.
- Recolouring any vol, volatility-spread, or non-rate series.
- Pushing `acm-revamp`.
- Any other revamp design work.

---
**Superseded (2026-10-27):** Decision 1's "text on heat cells follows red/green" was reversed during Phase 2 by direct instruction. Heat-cell text stays the primary text colour, because red/green text over the heat steps measured only 1.86–3.98:1 contrast. `CLAUDE.md` and the design notes are authoritative.
