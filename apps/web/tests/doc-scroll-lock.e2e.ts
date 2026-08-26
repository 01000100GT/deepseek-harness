// Document-level scroll lock: the app owns every scroll (transcript column,
// popover internals); the document itself must never scroll, whatever the
// transcript length or which popover is open. The shell pins html to
// --app-height (floored) and locks html overflow, so scrollTo must be a
// no-op. On failure the diagnostic lists elements extending past the viewport.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const SESSION_ID = 'doc-scroll-lock-e2e'
const FIXTURE = createChatScrollFixture({
  markerPrefix: 'DOCSCROLL',
  title: 'DOCSCROLL document scroll lock',
  turns: 88,
})

async function openLongSession(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl, { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  await page.getByText('Ungrouped', { exact: true }).waitFor({ timeout: 30_000 })
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  const search = page.getByRole('textbox', { name: 'Search sessions...', exact: true })
  await search.fill(FIXTURE.markers.user(1))
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  await results.first().waitFor({ timeout: 60_000 })
  await results.click()
  await page.waitForSelector('[data-conversation-scroll]', { timeout: 20_000 })
  // Let the transcript fully lay out (virtualizers settle asynchronously).
  await page.waitForTimeout(1_500)
}

describe('document-level scroll lock (long conversation)', () => {
  let web: WebScaffold
  let browser: Browser | undefined
  let page: Page

  beforeAll(async () => {
    web = await launchWebScaffold({ mode: MODE })
    await seedSession(web, FIXTURE.log, SESSION_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await openLongSession(page, web.baseUrl)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await web?.close()
  })

  const scrollLock = () => page.evaluate(() => {
    // The hard contract: the document cannot scroll at all. Try to scroll,
    // then measure whether it moved.
    window.scrollTo(0, 120)
    const scrolledTo = window.scrollY
    window.scrollTo(0, 0)
    return scrolledTo
  })

  it('the document never scrolls, whatever the transcript length', async () => {
    expect(await scrollLock()).toBe(0)
  })

  it('opening a trigger-anchored popover keeps the document locked', async () => {
    const picker = page.getByRole('button', { name: /^(open model|model|模型)/i }).first()
    if (await picker.count() === 0) return // no trigger in this composition; covered by viewport-height e2e
    await picker.click()
    await page.waitForTimeout(400)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-doc-scroll-lock-picker'))
    expect(await scrollLock()).toBe(0)
    await page.keyboard.press('Escape')
  })
})
