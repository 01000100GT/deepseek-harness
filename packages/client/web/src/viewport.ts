/**
 * Stable viewport binding for the shell.
 *
 * The 100vh / 100vw units resolve against the *layout* viewport, which on
 * mobile Safari and Android Chrome includes the area covered by the
 * URL/toolbar. As the browser reveals or collapses that chrome, layout
 * viewport size shifts and any element sized with 100vh/100vw visibly
 * re-flows. The dynamic viewport units (dvh/dvw) track the user-visible
 * viewport directly, so height/width: 100dvh/100dvw stay put through
 * those shifts.
 *
 * Two CSS custom properties carry the chosen sizes, and base.css reads
 * them. The first paint already needs a stable value, so this module runs
 * synchronously during boot.ts evaluation rather than waiting for React.
 * visualViewport (mobile keyboard / on-screen toolbar) is bound too: dvh
 * ignores the keyboard on most engines, so for layouts that have to track
 * it, a px value pinned to visualViewport.{height,width} wins.
 *
 * The activation helper is idempotent — repeated calls during HMR or
 * multiple boot attempts replace the existing listeners instead of
 * stacking them, and the very first measurement runs synchronously so the
 * boot page sees stable dimensions before the loader activates.
 * @module @deepseek-ai/dsh-client-web/src/viewport
 */

const STYLE_ID = 'dsh-stable-viewport'

interface VisualViewportLike {
  readonly height: number
  readonly width: number
  addEventListener(type: 'resize' | 'scroll', listener: () => void): void
  removeEventListener(type: 'resize' | 'scroll', listener: () => void): void
}

interface InstalledHandle {
  readonly visualListener: () => void
  readonly windowListener: () => void
  readonly orientationListener: (() => void) | undefined
  readonly visualViewport: VisualViewportLike | undefined
  readonly windowTarget: Window
}

/** Set of activation handles keyed by the Window they are installed on. */
const installed = new WeakMap<Window, InstalledHandle>()

/** Pick the most accurate viewport size available for the requested axis. */
function measure(windowTarget: Window, axis: 'height' | 'width'): number {
  const visual = (windowTarget as { visualViewport?: VisualViewportLike }).visualViewport
  if (visual !== undefined && visual[axis] > 0) return visual[axis]
  return axis === 'height' ? windowTarget.innerHeight : windowTarget.innerWidth
}

/** Write the measured sizes onto <html> via the stable style element. */
function write(windowTarget: Window, height: number, width: number): void {
  const document = windowTarget.document
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.documentElement.appendChild(style)
  }
  style.textContent =
    `:root { --app-height: ${String(Math.round(height))}px;`
    + ` --app-width: ${String(Math.round(width))}px; }`
}

/**
 * Bind --app-height and --app-width to the live viewport. Idempotent:
 * calling it twice on the same Window replaces the previous listeners.
 * @param windowTarget - the window whose viewport is observed (defaults to globalThis.window).
 */
export function installStableViewport(windowTarget: Window = globalThis.window): void {
  const existing = installed.get(windowTarget)
  if (existing !== undefined) uninstall(windowTarget, existing)

  const visualViewport = (windowTarget as { visualViewport?: VisualViewportLike }).visualViewport
  const handler = (): void => {
    write(windowTarget, measure(windowTarget, 'height'), measure(windowTarget, 'width'))
  }

  if (visualViewport !== undefined) visualViewport.addEventListener('resize', handler)
  windowTarget.addEventListener('resize', handler)

  // orientationchange fires before innerHeight updates on some engines;
  // schedule a follow-up read so the post-rotation size lands too.
  let orientationListener: (() => void) | undefined
  if ('orientationchange' in windowTarget) {
    orientationListener = () => {
      windowTarget.setTimeout(handler, 100)
    }
    windowTarget.addEventListener('orientationchange', orientationListener)
  }

  installed.set(windowTarget, {
    visualListener: handler,
    windowListener: handler,
    orientationListener,
    visualViewport,
    windowTarget,
  })

  // First measurement runs synchronously so the very first paint of the
  // boot page already has the right size — deferring it would leave a
  // 100vh-sized frame visible for a tick.
  handler()
}

function uninstall(windowTarget: Window, handle: InstalledHandle): void {
  if (handle.visualViewport !== undefined) {
    handle.visualViewport.removeEventListener('resize', handle.visualListener)
  }
  handle.windowTarget.removeEventListener('resize', handle.windowListener)
  if (handle.orientationListener !== undefined) {
    handle.windowTarget.removeEventListener('orientationchange', handle.orientationListener)
  }
  installed.delete(windowTarget)
}

/** Tear down listeners (used by tests and disposal). */
export function uninstallStableViewport(windowTarget: Window = globalThis.window): void {
  const handle = installed.get(windowTarget)
  if (handle === undefined) return
  uninstall(windowTarget, handle)
}

/** Read the current --app-… value as a number, or null if unset. */
function readCustomProp(windowTarget: Window, varName: string): number | null {
  const raw = windowTarget.document.documentElement.style.getPropertyValue(varName)
  if (raw !== '') {
    const parsed = Number.parseFloat(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  const computed = windowTarget.getComputedStyle(windowTarget.document.documentElement)
    .getPropertyValue(varName).trim()
  if (computed === '' || computed.endsWith('vh') || computed.endsWith('vw')) return null
  const parsed = Number.parseFloat(computed)
  return Number.isFinite(parsed) ? parsed : null
}

/** Read the current --app-height value as a number, or null if unset. */
export function readStableViewportHeight(windowTarget: Window = globalThis.window): number | null {
  return readCustomProp(windowTarget, '--app-height')
}

/** Read the current --app-width value as a number, or null if unset. */
export function readStableViewportWidth(windowTarget: Window = globalThis.window): number | null {
  return readCustomProp(windowTarget, '--app-width')
}
