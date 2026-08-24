/**
 * Stable viewport-height binding for the shell.
 *
 * The 100vh unit resolves against the *layout* viewport, which on mobile
 * Safari and Android Chrome includes the area covered by the URL/toolbar.
 * As the browser reveals or collapses that chrome, layout viewport height
 * shifts and any element sized with 100vh visibly re-flows. The dynamic
 * viewport unit (dvh) tracks the user-visible viewport directly, so
 * height: 100dvh stays put through those shifts.
 *
 * The CSS custom property --app-height carries the chosen height, and
 * base.css reads it. The first paint already needs a stable value, so this
 * module runs synchronously during boot.ts evaluation rather than waiting
 * for React. visualViewport (mobile keyboard / on-screen toolbar) is bound
 * too: dvh ignores the keyboard on most engines, so for layouts that have
 * to track it, a px value pinned to visualViewport.height wins.
 *
 * The activation helper is idempotent — repeated calls during HMR or
 * multiple boot attempts replace the existing listeners instead of stacking
 * them, and the very first measurement runs synchronously so the boot page
 * sees a stable height before the loader activates.
 * @module @deepseek-ai/dsh-client-web/src/viewport
 */

const STYLE_ID = 'dsh-stable-viewport'
const VAR_NAME = '--app-height'

interface VisualViewportLike {
  readonly height: number
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

/** Pick the most accurate viewport height available. */
function measureHeight(windowTarget: Window): number {
  const visual = (windowTarget as { visualViewport?: VisualViewportLike }).visualViewport
  if (visual !== undefined && visual.height > 0) return visual.height
  return windowTarget.innerHeight
}

/** Write the measured height onto <html> via the stable style element. */
function writeHeight(windowTarget: Window, height: number): void {
  const document = windowTarget.document
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.documentElement.appendChild(style)
  }
  style.textContent = `:root { ${VAR_NAME}: ${String(Math.round(height))}px; }`
}

/**
 * Bind --app-height to the live viewport height. Idempotent: calling it twice
 * on the same Window replaces the previous listeners.
 * @param windowTarget - the window whose viewport is observed (defaults to globalThis).
 */
export function installStableViewportHeight(windowTarget: Window = globalThis.window): void {
  const existing = installed.get(windowTarget)
  if (existing !== undefined) uninstall(windowTarget, existing)

  const visualViewport = (windowTarget as { visualViewport?: VisualViewportLike }).visualViewport
  const handler = (): void => { writeHeight(windowTarget, measureHeight(windowTarget)) }

  if (visualViewport !== undefined) visualViewport.addEventListener('resize', handler)
  windowTarget.addEventListener('resize', handler)

  // orientationchange fires before innerHeight updates on some engines;
  // schedule a follow-up read so the post-rotation height lands too.
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
  // boot page already has the right height — deferring it would leave a
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
export function uninstallStableViewportHeight(windowTarget: Window = globalThis.window): void {
  const handle = installed.get(windowTarget)
  if (handle === undefined) return
  uninstall(windowTarget, handle)
}

/** Read the current --app-height value as a number, or null if unset. */
export function readStableViewportHeight(windowTarget: Window = globalThis.window): number | null {
  const raw = windowTarget.document.documentElement.style.getPropertyValue(VAR_NAME)
  if (raw === '') {
    const computed = windowTarget.getComputedStyle(windowTarget.document.documentElement)
      .getPropertyValue(VAR_NAME).trim()
    if (computed === '' || computed.endsWith('vh')) return null
    const parsed = Number.parseFloat(computed)
    return Number.isFinite(parsed) ? parsed : null
  }
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : null
}
