# Agent Note: stable viewport contract for the web client (–app-height / –app-width)

Status: implemented

English | [中文](2026-08-26-stable-viewport-contract.zh.md)

## Problem

Scrolling a conversation to the bottom produced layout jumps, bottom whitespace, and popover overflow past the viewport edge. Four independent causes stacked:

1. `html, body, #root` sized by `100vh` resolve against the *layout* viewport, which on mobile Safari and Android Chrome includes the area under the URL bar. Every bar reveal/collapse reflowed the whole document.
2. The center grid columns of `AppFrame` lacked `min-height: 0`, so grid items' default `min-height: auto` refused to shrink below content height and pushed the composer below the fold instead of letting the transcript scroll.
3. Nine client CSS sites carried `100vh`/`60vh`-style literals (modals, panels, code viewers), each reflowing on the same events.
4. Trigger-anchored popovers (Menu, ModelSelect, SubagentHeaderLineage, JobListAction, MessageFeedbackActions) capped height with `calc(100dvh - N)` — an unconditional bound that ignores where the trigger sits. A trigger 5px above the viewport bottom still allowed a menu `(100dvh - N)` tall, spilling past the edge the unit was chosen to respect.

## Decision

Two layers, one per cause class.

**Shell pin.** `packages/client/web/src/viewport.ts` (`installStableViewport`, run at the top of `AppWebEntry.run()` so first paint is stable) writes `--app-height` and `--app-width` on `:root` from `visualViewport.{height,width}` (fallback `inner{Height,Width}`), rebinding on resize/orientationchange. `base.css` reads `height: var(--app-height, 100dvh)` on the mount chain; `100%` closes the chain for engines without dynamic units. `AppFrame` grid columns carry `min-height: 0`.

**Trigger-aware clamp.** `packages/client/ui-primitives/src/useAvailableHeight.ts` measures the room between the trigger edge and the viewport edge (`side: 'top' | 'bottom' | 'right'`, `visualViewport.height ?? innerHeight`, re-measured on resize and capture-phase scroll) and returns it as a px number. The five trigger-anchored popovers write it inline as `--menu-max-height`; their CSS reads `max-height: var(--menu-max-height, <previous design cap>)`, so the fallback covers the pre-measure frame and hook-less engines keep the old bound. Hooks run before any conditional early return (`return null` paths) — rules-of-hooks violations were the one regression this design shipped and fixed in the same change.

Center-screen modals (SettingsRoot, OnboardingModal, ImageLightbox, RiskConfirmation) take only the unit migration: they do not move with a trigger, so `calc(var(--app-height, 100dvh) - N)` is the correct bound for them.

**Contract and gate.** Client CSS Modules may use no numeric layout-viewport unit — `100vh`, `50vw`, `52vh`, `100svh`, … all forbidden; fractions spell `calc(var(--app-height, 100dvh) * 0.6)`. Bare `dvh`/`dvw` is allowed (the dynamic units track the same events natively). `scripts/verify-client-viewport-units.ts` (wired into `pnpm run hygiene`) enforces the set with per-file line:column reports, so a newly installed UI plugin cannot silently reintroduce the jump. `packages/client/AGENTS.md` documents the contract.

The `html/body/#root` mount chain stays **width-unpinned**: during pinch-zoom `visualViewport.width` runs narrower than the layout viewport, and clamping the document to it would reflow everything. `--app-width` is consumed only by popover/panel CSS, where fitting the visible area is the desired bound.

## Alternatives considered

- **`100dvh` alone, no JS pin** — rejected: `dvh` ignores the soft keyboard on most engines, and the composer must shrink when the keyboard opens; the JS pin from `visualViewport` is the only source that tracks it.
- **CSS-only popover caps (`calc(100dvh - N)`)** — rejected as the standing design's failure mode: a cap that does not know the trigger position cannot bound a trigger-anchored surface; only measurement can.
- **Reusing `useAnchoredMaxHeight`** — rejected: it is bottom-anchored (bounds against the viewport bottom only), wrong semantics for triggers anywhere on screen; `useAvailableHeight` computes room from the actual trigger rect per side.
- **Clamping the mount chain's width with `--app-width`** — rejected: pinch-zoom would reflow the whole document through a variable narrower than the layout viewport; popover-only consumption keeps the blast radius at the surface that needs the bound.
- **`@supports (height: 100dvh)` progressive enhancement** — rejected after finding it live in RiskConfirmation: the block sat after the migrated rule at equal specificity and silently defeated `var(--app-height, …)` on every dvh engine, so the migration had never taken effect there. One chain, no override blocks.

## Consequences

- What it cost: one JS-pinned style element on `:root` that must boot before first paint; a hook on every trigger-anchored popover that must precede early returns; every future client CSS size against two custom properties instead of the familiar viewport units.
- What it bought: the document height is inert to URL-bar and keyboard events; grid columns shrink instead of pushing the composer off-screen; popovers clamp to the visible area regardless of trigger position, in both axes; the gate makes the contract survive new plugins and contributor drift.
- A popover opened near the bottom now scrolls internally from the trigger down instead of overflowing — visually a smaller menu, which is the intended behavior change; the pre-measure frame still shows the old design cap for one paint.
- Fractional caps (`52vh`, `50vw`) migrate to `calc(var(--app-*) * n)` expressions; they evaluate against the pinned px values, so they no longer jump, at the cost of the `var()` indirection in CSS source.

## Testing

`packages/client/ui-primitives/tests/use-available-height.client.spec.ts` (jsdom) pins the hook math per side, cap precedence, the `innerHeight` fallback, and non-negativity. `apps/web/tests/viewport-height.e2e.ts` (browser lane) pins the mounted `--app-height` and asserts the model-picker popover's bottom edge stays inside it. `pnpm run verify-client-viewport-units` proves the CSS surface clean (106 files) and rejects seeded `50vh`/`30vw` fixtures.