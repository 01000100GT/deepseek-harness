/**
 * Viewport-fit hook for trigger-anchored overlays (Menu, ModelSelect,
 * SubagentHeaderLineage, JobListAction, MessageFeedbackActions).
 *
 * The overlay renders with no CSS height cap of its own; it grows to fit
 * the items the owner passed in. The owner also wants the overlay to stop
 * at the viewport edge (12px clearance mirrors the portal margin Menu uses
 * for in-place clamping). The CSS cap carries an inline custom property so
 * the design cap and the available space are merged in one declaration, and
 * the fallback in CSS (calc(var(--app-height, 100dvh) - 24px)) still
 * covers engines where the JS hook has not yet measured.
 *
 * Differs from {@link useAnchoredMaxHeight}: that hook assumes the element
 * already fills the available space (bottom-anchored overlays grow upward
 * from the viewport bottom). The trigger-anchored case here uses the
 * trigger's rect directly so the cap stays correct when the trigger is
 * near the viewport edge, the page scrolls, or the window resizes.
 * @module @deepseek-ai/dsh-client-ui-primitives/useAvailableHeight
 */

import { useLayoutEffect, useState, type RefObject } from 'react'

/** Safe distance kept between the overlay and the viewport edge (mirrors Menu portal MARGIN). */
export const VIEWPORT_MARGIN = 12

/** Inputs for {@link useAvailableHeight}. */
export interface AvailableHeightOptions {
  /** Whether the overlay is mounted; pass so a closed element skips measuring. */
  open: boolean
  /** The trigger the overlay sits against (its top/bottom edge is the anchor). */
  anchorRef: RefObject<HTMLElement | null>
  /** Open below (`bottom`, default), above (`top`), or to the right of the anchor. */
  side?: 'bottom' | 'top' | 'right'
  /** Design cap on the overlay's max-height (the clamp never exceeds it). */
  cap: number
  /** Override the default 12px viewport clearance. */
  margin?: number
}

/**
 * Compute the largest height the overlay can render without crossing the
 * viewport edge.
 * @param options - the open state, the anchor ref, the side, the cap, and the margin.
 * @returns the available height in px; equals the cap before the first measurement
 *   and never drops below zero.
 */
export function useAvailableHeight(options: AvailableHeightOptions): number {
  const { open, anchorRef, side = 'bottom', cap, margin = VIEWPORT_MARGIN } = options
  const [available, setAvailable] = useState(cap)
  useLayoutEffect(() => {
    if (!open) {
      setAvailable(cap)
      return
    }
    const fit = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (rect === undefined) {
        setAvailable(cap)
        return
      }
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight
      const room = side === 'top'
        ? Math.max(0, rect.top - margin)
        : side === 'right'
          // Right-anchored menus grow downward from the trigger's top; the
          // viewport-relative cap is the whole vertical clearance so the
          // hook's caller gets a sane max-height even though the menu opens
          // horizontally.
          ? Math.max(0, viewportHeight - rect.top - margin)
          : Math.max(0, viewportHeight - rect.bottom - margin)
      setAvailable(Math.min(cap, room))
    }
    fit()
    window.addEventListener('resize', fit)
    window.addEventListener('scroll', fit, true)
    return () => {
      window.removeEventListener('resize', fit)
      window.removeEventListener('scroll', fit, true)
    }
  }, [open, anchorRef, side, cap, margin])
  return available
}
