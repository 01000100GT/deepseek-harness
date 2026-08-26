/**
 * Verify client-package CSS uses the stable viewport-height contract.
 *
 * The web shell pins --app-height on :root from `visualViewport.height` so
 * that the height stays put through browser-chrome shifts (mobile URL bar,
 * soft keyboard, foldable hinge). CSS Modules under `packages/client/*` and
 * `packages/extensions/*` may NOT introduce new `100vh`, `100svh`, or
 * `100lvh` literals — those units re-introduce the layout-viewport jump
 * the shell fix exists to prevent, and a new UI plugin would silently
 * regress the shell on first install.
 *
 * The allowed chain is `var(--app-height, 100dvh)` so modern browsers pick
 * up the dynamic unit directly and older engines still get the same value
 * the JS hook writes. Inline `100dvh` is allowed as a fallback inside the
 * `var()` expression; bare `100dvh` outside a `var(--app-height, ...)`
 * fallback is not.
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

/** Disallowed viewport-height units outside the var() fallback chain. */
const FORBIDDEN_UNITS: ReadonlyArray<{ unit: string; pattern: RegExp }> = [
  { unit: '100vh', pattern: /\b100vh\b/g },
  { unit: '100svh', pattern: /\b100svh\b/g },
  { unit: '100lvh', pattern: /\b100lvh\b/g },
]

interface Violation {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly unit: string
  readonly text: string
}

/**
 * Test whether a match is inside a `var(--app-height, …)` expression.
 * The fallback may carry the dynamic unit; everywhere else is forbidden.
 */
function isInsideAllowedVar(line: string, matchIndex: number): boolean {
  // Scan backward from the match for an unmatched `var(` opener. We do not
  // need a real parser — the `var(--app-height` opener is the only legal
  // wrapper here, so a single linear scan is enough.
  const open = line.lastIndexOf('var(--app-height', matchIndex)
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
    for (const { unit, pattern } of FORBIDDEN_UNITS) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(codeOnly)) !== null) {
        if (isInsideAllowedVar(codeOnly, match.index)) continue
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
    console.error(`${header}\n${detail}\n  Use \`var(--app-height, 100dvh)\` instead.`)
    process.exit(1)
  }
  console.log(`client-viewport-units: ${String(files.length)} file(s) clean`)
}

main()
