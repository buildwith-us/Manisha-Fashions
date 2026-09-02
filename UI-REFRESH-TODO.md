# UI refresh — state of play

Continues the pass in `.claude/skills/emil-design-eng`. Motion, press feedback,
skeletons and reduce-motion gating are **done app-wide**.

## Rules that still apply

- **Do not change `theme/index.ts`** — no new colours, no new spacing values.
- Reuse `ui.tsx` primitives rather than hand-rolling equivalents.
- Motion values come from `theme/motion.ts`, never invented.
- Work **screen by screen**, not with a regex sweep. Two sweeps broke things
  (`PressableScale` swallowing function styles; `AdminDashboard` losing a
  closing tag) because the edits were mechanical.
- After each screen: `npx tsc --noEmit`, then **look at it on a device**. Both
  bugs above passed a clean typecheck and only showed on screen.

## Done and verified on a device

| Screen | Result |
| --- | --- |
| Catalogue (Home) | Uses `LargeTitle`; piece count in the caption |
| Product detail | Safe-area inset instead of a hardcoded 44; status-bar scrim fades in as the hero scrolls away |
| Orders | Layout regression fixed (cards had lost all styling) |
| Saved | Staggered grid renders correctly |
| Filter & sort | **Checked, needs nothing** — already uses the primitives, spacing and sheet pattern correctly |
| Login / OTP | Keyboard no longer covers the primary action |

## Done, not yet seen running

| Screen | Change |
| --- | --- |
| Account (profile hub) | Identity block is now tappable; tier shown as a `StatusPill` |
| Admin Orders / Accounts / Wholesale / Dashboard | Converted to `LargeTitle` |
| Admin Products | Converted to `LargeTitle` with its two actions in the `right` slot |
| Every screen with a loading state | Shaped skeletons |
| Order confirmation | Local `DetailRow` replaced by `Group` + `Row` |

## Checked and found to need nothing

- `AddressFormScreen` — already uses `FieldRow` throughout.
- `FiltersScreen` — see above.
- Cart, Checkout, Order detail, Wholesale pending, Admin categories, Admin
  order detail all already use `Group` / `Row` / `SectionLabel`.

## Settled — do not re-open these

**`OrderConfirmationScreen`** (be48c3a). It was the last screen rebuilding a
grouped list by hand. The local `DetailRow` and its `divided` flag are gone;
`Group` draws the hairlines itself. Nothing hand-rolled is left on that screen.

**Off-scale spacing** (be48c3a). The twenty-odd literals were not one problem
and did not get one fix:

- *Corrected, because it was real drift.* The search field is duplicated across
  four screens and had drifted to two paddings (10, 10, 10 and 11) — all four
  now use `spacing.md`. A timeline step gap of 22 and a pill padding of 7 became
  `spacing.xl` and `spacing.sm`.
- *Left alone, deliberately, now with a comment saying why.* `segmented`'s
  `padding: 3` is the track inset around a pill inside a pill. `priceDash`'s
  `marginBottom: 14` optically centres a 1px dash between two price fields.
  `hero`'s `paddingTop: 72` was a false positive — already on the 8px grid.

About thirty literals remain and are **correct as they stand**: `marginTop: 2`
/ `3` / `5` / `6` under a primary line, and `paddingVertical: 3` inside pills.
These are baseline nudges between a label and its caption, where a 4px step is
visibly too much air. Snapping them is a regression dressed as consistency. A
future grep will surface them again — this paragraph is the answer.

## Genuinely left

1. **Visual verification** of everything in the "not yet seen running" table.
2. **Two hand-rolled duplicates found after the screen-by-screen pass.** Both
   are real, both are on sign-in-gated screens, so neither was changed blind:
   - `AddressesScreen`'s `labelPill` + `labelText` reproduce `Badge` exactly
     (9/3 padding, pill radius, `typography.tiny` on `textMuted`). The swap is
     *not* free: `Badge` sets `alignSelf: 'flex-start'`, which in that
     row-direction parent would top-align the pill instead of centring it.
     Needs `style={{ alignSelf: 'center' }}` to stay identical.
   - `CheckoutScreen`'s `summaryCard` + `SummaryLine`'s `divided` flag
     reproduce what `Group` does automatically. Converting moves the hairlines
     from inset (they currently sit inside the card's `spacing.xl` padding) to
     full-bleed. That is a visible change, and possibly the better one — but it
     is a design decision, not a cleanup.

## Blocking

**Redeploy Render from `pavi`.** Sign-in on the deployed backend is refused
because the OTP allowlist is committed but not deployed, so no signed-in screen
— Cart, Checkout, Orders, Account, or anything admin — can be reached to check.
The same deploy switches on reviews, storefront visibility and the hardcoded
admin numbers, all committed and tested but currently unobservable.

Both items above are gated on this. The `DEV_AUTH_BYPASS` in
`src/config/devAuth.ts` is not a way around it: its token carries a nonsense
signature, so it reaches the signed-in *shells* but every API call behind them
401s. Order confirmation in particular fetches its order on mount, so the
bypass alone will never show it populated — it needs a backend that accepts a
real sign-in.
