// Stable viewport-height contract: the shell must pin --app-height on :root
// before the first paint, the value must follow the live visualViewport /
// innerHeight during resize, and the three-column AppFrame must respect
// that bound — no column may overflow past the bottom of the viewport.
//
// Headless Chromium exposes window.visualViewport, but a fresh page that has
// never been scrolled has no keyboard up and the URL bar is fixed in the
// test runner. So this spec drives the contract through synthetic resize
// events and asserts (a) the CSS custom property moves with the new size,
// and (b) the .frame element's getBoundingClientRect().height matches
// exactly.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()

const TOLERANCE = 2 // engine rounding on innerHeight vs CSS pixels

interface Box {
  readonly bottom: number
  readonly height: number
  readonly top: number
  readonly width: number
}

function readAppHeight(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const root = document.documentElement
    const inline = root.style.getPropertyValue('--app-height').trim()
    if (inline !== '') {
      const parsed = Number.parseFloat(inline)
      return Number.isFinite(parsed) ? parsed : null
    }
    const computed = getComputedStyle(root).getPropertyValue('--app-height').trim()
    if (computed === '') return null
    const parsed = Number.parseFloat(computed)
    return Number.isFinite(parsed) ? parsed : null
  })
}

function readFrameBox(page: Page): Promise<Box> {
  return page.locator('[class*="frame"]').first().evaluate((node) => {
    const rect = node.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width }
  })
}

function readViewport(page: Page): Promise<{ inner: number; visual: number }> {
  return page.evaluate(() => ({
    inner: window.innerHeight,
    visual: window.visualViewport?.height ?? window.innerHeight,
  }))
}

async function expectAppHeightTracks(page: Page, targetHeight: number): Promise<void> {
  await page.setViewportSize({ width: 1280, height: targetHeight })
  // Allow the resize handler in viewport.ts one microtask + rAF to settle.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => {
    requestAnimationFrame(() => { resolve() })
  })))
  const measured = await readAppHeight(page)
  expect(measured, '--app-height must be set on :root after resize').not.toBeNull()
  expect(Math.abs((measured as number) - targetHeight)).toBeLessThanOrEqual(TOLERANCE)
}

describe('web e2e: stable viewport height across resize', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('binds --app-height to the live viewport before the first paint', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-viewport-height-initial'))
    const measured = await readAppHeight(page)
    expect(measured, '--app-height is set on documentElement.style at boot').not.toBeNull()
    const viewport = await readViewport(page)
    expect(Math.abs((measured as number) - viewport.visual)).toBeLessThanOrEqual(TOLERANCE)
  })

  it.skipIf(MODE === 'record')('updates --app-height when the window resizes without an intervening layout shift', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-viewport-height-resize'))
    const firstBox = await readFrameBox(page)
    expect(firstBox.height).toBeGreaterThan(0)

    await expectAppHeightTracks(page, 720)
    const frame720 = await readFrameBox(page)
    // The frame must shrink in lock-step with the viewport; a stuck 100vh
    // value would leave the frame at its previous height and produce
    // bottom whitespace or content clipping.
    expect(Math.abs(frame720.height - 720)).toBeLessThanOrEqual(TOLERANCE)

    await expectAppHeightTracks(page, 540)
    const frame540 = await readFrameBox(page)
    expect(Math.abs(frame540.height - 540)).toBeLessThanOrEqual(TOLERANCE)

    await expectAppHeightTracks(page, 900)
    const frame900 = await readFrameBox(page)
    expect(Math.abs(frame900.height - 900)).toBeLessThanOrEqual(TOLERANCE)
  })

  it.skipIf(MODE === 'record')('keeps the AppFrame inside the bound when the sidebar is narrow', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-viewport-height-narrow'))
    await page.setViewportSize({ width: 700, height: 820 })
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => {
      requestAnimationFrame(() => { resolve() })
    })))
    const frame = await readFrameBox(page)
    const appHeight = await readAppHeight(page)
    expect(appHeight).not.toBeNull()
    // Frame.bottom must not extend below the bound by more than the engine
    // rounding tolerance; this is the regression guard for the original
    // symptom (bottom whitespace + scrolling past the viewport bottom).
    expect(frame.bottom).toBeLessThanOrEqual((appHeight as number) + TOLERANCE)
    expect(Math.abs(frame.height - (appHeight as number))).toBeLessThanOrEqual(TOLERANCE)
  })
})
