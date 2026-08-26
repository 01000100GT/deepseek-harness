/**
 * Verify client-package CSS uses the stable viewport contract.
 *
 * The web shell pins --app-height on :root from `visualViewport.height` and
 * --app-width from `visualViewport.width` so that every layout-viewport
 * shift (mobile URL bar, soft keyboard, foldable hinge, landscape rotation)
 * stays put through browser-chrome moves. CSS Modules under
 * `packages/client/*` and `packages/extensions/*` may NOT introduce new
 * `100vh / 100svh / 100lvh / 100vw / 100svw / 100lvw` literals — those
 * units re-introduce the layout-viewport jump the shell fix exists to
 * prevent, and a new UI plugin would silently regress the shell on first
 * install.
 *
 * The allowed chain is `var(--app-height, 100dvh)` and `var(--app-width,
 * 100dvw)` so modern browsers pick up the dynamic unit directly and older
 * engines still get the same value the JS hook writes. Bare `100dvh` /
 * `100dvw` is allowed inside the `var()` fallback expression; outside, it
 * is not.
 *
 * The script normalizes repository-relative glob paths to `/` at ingestion
 * and reports one violation per offending line. It does not rewrite.
 */

import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { uniqueRepoFiles } from './repo-files.ts'

const root = resolve(import.meta.dirname, '..')

/** Client CSS surfaces — every UI plugin must obey this contract. */
const PATTERNS = [
  'packages/client/**/src/**/*.module.css',
  'packages/extensions/**/src/**/*.module.css',
  'packages/client/web/src/**/*.css',
]

/** Disallowed viewport units outside the var(--app-…) fallback chain. */
const FORBIDDEN_UNITS: ReadonlyArray<{
  readonly unit: string
  readonly pattern: RegExp
  readonly varName: '--app-height' | '--app-width'
}> = [
  // Any numeric vh/svh/lvh/vw/svw/lvw — fractional sizes jump with the same
  // layout-viewport shifts as the full-size forms. dvh/dvw never match:
  // the digits are followed by `d`, which the optional sv|lv group rejects.
  { unit: 'vh/svh/lvh', pattern: /\b\d+(?:\.\d+)?(?:sv|lv)?vh\b/g, varName: '--app-height' },
  { unit: 'vw/svw/lvw', pattern: /\b\d+(?:\.\d+)?(?:sv|lv)?vw\b/g, varName: '--app-width' },
]

interface Violation {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly unit: string
  readonly text: string
}

/**
 * Test whether a match is inside a `var(--app-…)` expression whose custom
 * property matches the unit's axis. The fallback may carry the dynamic
 * unit; everywhere else is forbidden.
 */
function isInsideAllowedVar(line: string, matchIndex: number, varName: '--app-height' | '--app-width'): boolean {
  const open = line.lastIndexOf(`var(${varName}`, matchIndex)
  if (open === -1) return false
  const between = line.slice(open, matchIndex)
  return !between.includes(')')
}

function scanFile(absPath: string): Violation[] {
  const violations: Violation[] = []
  const repoFile = relative(root, absPath).split('\\').join('/')
  if (!existsSync(absPath)) return violations
  const text = readFileSync(absPath, 'utf8')
  const lines = text.split('\n')
  for (const [lineIndex, line] of lines.entries()) {
    // Strip comments so rationale prose mentioning 100vh is not flagged.
    const codeOnly = line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '')
    for (const { unit, pattern, varName } of FORBIDDEN_UNITS) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(codeOnly)) !== null) {
        if (isInsideAllowedVar(codeOnly, match.index, varName)) continue
        violations.push({
          file: repoFile,
          line: lineIndex + 1,
          column: match.index + 1,
          unit,
          text: line.trim(),
        })
      }
    }
  }
  return violations
}

function main(): void {
  const files = uniqueRepoFiles(root, PATTERNS)
  const allViolations: Violation[] = []
  for (const file of files) {
    allViolations.push(...scanFile(file.abs))
  }
  if (allViolations.length > 0) {
    const header = `client-viewport-units: ${String(allViolations.length)} forbidden viewport unit${allViolations.length === 1 ? '' : 's'} found`
    const detail = allViolations
      .map(v => `  ${v.file}:${String(v.line)}:${String(v.column)}  ${v.unit}  ${v.text}`)
      .join('\n')
    console.error(`${header}\n${detail}\n  Use \`var(--app-height, 100dvh)\` or \`var(--app-width, 100dvw)\` instead.`)
    process.exit(1)
  }
  console.log(`client-viewport-units: ${String(files.length)} file(s) clean`)
}

main()
