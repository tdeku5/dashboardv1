# Turn 2 — Approved. One decision, one fix, then Turn 3.

Turn 2 is accepted as delivered. In particular:

- **The forced contrast lifts** (XLB, d200, Bear Steepener, investor classes) are approved. 3:1 is the right floor for chart lines and markers. Keeping d200 darker than d50 was the right call.
- **Tenor vs country** keep separate values, since no chart draws both maps.
- **The UsRatesVol tenor merge** is approved. The VOL pilot's tenor colors will change; I'll judge them there.
- **The FF contract-year fix** is approved. Catching the second index-drift bug unprompted was good work.
- **The U+2212 ratchet** is approved as designed. It must be empty by the end of Phase 3.
- **France/NOK vs `--acm-dir-up`** (ΔE 2.5) can wait for the pilot. Chart line and value text are different channels.

---

## Decision — investor class: option B

Individuals `#868D9B`, Other `#687385`. B keeps Other as the darker grey, as it is today. Both options fix the contrast; only B also keeps the existing relationship between the two classes, and that's the rule for identity colors. Update the registry and close the pinned open-state test.

---

## Fix before Turn 3 — components used outside `.acm-root`

`acm-tokens.css` scopes every token under `.acm-root`. Any converted component that also renders **outside** the section will meet undefined `var(--acm-*)` values there and break.

`TreasuryAuctionContent` is the known case: it renders inside the section and on the standalone `/treasury` route. There may be others.

**Rule:** every shared primitive (Turn 4), and every component Phase 0-H found rendering on routes outside the section, puts the `acm-root` class on **its own outermost element**. That keeps it self-contained: wherever it mounts, its tokens resolve. Page-level `.acm-root` wrapping is still fine for section pages; the component-level class is what protects the cross-route ones.

Consequences:

- **`/treasury` will adopt the new look** when `TreasuryAuctionContent` is converted in Phase 3. That's accepted: it's the same content, and two diverging copies would be worse. This supersedes the earlier "don't restyle `/treasury`" instruction, but only for this component's own content. The `/treasury` page shell and `NavDropdown` stay untouched.
- **Registry colors are JS constants and resolve anywhere.** Only the CSS-variable tokens need the root class.

Add a test that mounts `TreasuryAuctionContent` **without** any `.acm-root` ancestor and asserts that no rendered style resolves to an empty or invalid `var(--acm-*)`. It can only pass once the component is converted in Phase 3, so add it now as a pending/skipped test, named so it can't be forgotten. Do the same for any other cross-route component Phase 0-H identified.

---

## Turn 3 — shared chart theme

As planned: one theme for grid (3 variants → 1), axis stroke, ticks (22 variants → 1), and tooltip surface/border/type (7 variants → 1, custom tooltip components keep their content). Series colors come from the identity registry and the sign tokens, never from the theme itself.

No page adopts it yet. Stop with a status line.

---

## Acceptance criteria

1. The registry holds Individuals `#868D9B` and Other `#687385`; the open-state test is replaced by a value assertion.
2. The component-level `acm-root` rule is recorded in `acm-tokens.css`'s header comment and in the Turn 4 primitive spec.
3. A pending, clearly named test exists for `TreasuryAuctionContent` rendering without a `.acm-root` ancestor, and for any other cross-route component.
4. The Turn 3 chart theme defines a single grid, axis, tick and tooltip treatment. Its values come only from `--acm-*` tokens or the registry.
5. All counts are pasted from command output, and `git diff --stat 7512e85` shows no change to rendered styling on any page.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- The `/treasury` page shell and everything on that route outside `TreasuryAuctionContent`.
- The Turn 1 and Turn 2 tests (305 passing). Extend them; don't retune.

## Out of scope

- Converting `TreasuryAuctionContent` or any page (Phase 2 onward).
- Retuning NOK, the merged tenor colors, or tint alphas before the pilot review.
