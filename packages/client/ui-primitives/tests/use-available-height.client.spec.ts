// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAvailableHeight } from '../src/useAvailableHeight.ts'

/** Original window dimensions jsdom reports (1024×768). */
const JS_DOM_VIEWPORT_HEIGHT = 768

/** Stub `visualViewport` and `innerHeight` so the hook reads the values the test sets. */
function stubViewport(height: number, hasVisualViewport = true): void {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: hasVisualViewport ? { height } : undefined,
  })
}

/** Build a ref-like object whose current points at an element with the given rect. */
function anchorAt(rect: { top: number; bottom: number }): { current: HTMLElement } {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({
    top: rect.top, bottom: rect.bottom, left: 0, right: 100, width: 100,
    height: rect.bottom - rect.top, x: 0, y: rect.top, toJSON: () => ({}),
  })
  return { current: el }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useAvailableHeight', () => {
  it('returns the cap before the first measurement when closed', () => {
    stubViewport(JS_DOM_VIEWPORT_HEIGHT)
    const anchor = anchorAt({ top: 100, bottom: 120 })
    const { result } = renderHook(() => useAvailableHeight({
      open: false, anchorRef: anchor, side: 'bottom', cap: 320, margin: 12,
    }))
    expect(result.current).toBe(320)
  })

  it('returns viewport - trigger.bottom - margin when side=bottom', () => {
    stubViewport(JS_DOM_VIEWPORT_HEIGHT)
    // Trigger near the bottom: room = 768 - 700 - 12 = 56.
    const anchor = anchorAt({ top: 680, bottom: 700 })
    const { result } = renderHook(() => useAvailableHeight({
      open: true, anchorRef: anchor, side: 'bottom', cap: 1_000, margin: 12,
    }))
    expect(result.current).toBe(56)
  })

  it('returns trigger.top - margin when side=top', () => {
    stubViewport(JS_DOM_VIEWPORT_HEIGHT)
    // Trigger near the top: room = 50 - 12 = 38.
    const anchor = anchorAt({ top: 50, bottom: 70 })
    const { result } = renderHook(() => useAvailableHeight({
      open: true, anchorRef: anchor, side: 'top', cap: 1_000, margin: 12,
    }))
    expect(result.current).toBe(38)
  })

  it('honors the design cap when the viewport has more room', () => {
    stubViewport(JS_DOM_VIEWPORT_HEIGHT)
    const anchor = anchorAt({ top: 10, bottom: 30 })
    const { result } = renderHook(() => useAvailableHeight({
      open: true, anchorRef: anchor, side: 'bottom', cap: 200, margin: 12,
    }))
    // viewport - 30 - 12 = 726 > cap, so the cap wins.
    expect(result.current).toBe(200)
  })

  it('falls back to innerHeight when visualViewport is undefined', () => {
    stubViewport(JS_DOM_VIEWPORT_HEIGHT, false)
    const anchor = anchorAt({ top: 600, bottom: 620 })
    const { result } = renderHook(() => useAvailableHeight({
      open: true, anchorRef: anchor, side: 'bottom', cap: 1_000, margin: 12,
    }))
    expect(result.current).toBe(JS_DOM_VIEWPORT_HEIGHT - 620 - 12)
  })

  it('never returns a negative value', () => {
    stubViewport(JS_DOM_VIEWPORT_HEIGHT)
    // Trigger past the viewport bottom (URL bar collapse, anchor drift).
    const anchor = anchorAt({ top: 800, bottom: 820 })
    const { result } = renderHook(() => useAvailableHeight({
      open: true, anchorRef: anchor, side: 'bottom', cap: 1_000, margin: 12,
    }))
    expect(result.current).toBe(0)
  })
})
