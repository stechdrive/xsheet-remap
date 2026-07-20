import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesRoot = join(process.cwd(), 'packages', 'ui', 'src', 'styles')
const responsiveCss = readFileSync(join(stylesRoot, 'responsive.css'), 'utf8')
const baseCss = readFileSync(join(stylesRoot, 'base.css'), 'utf8')

describe('responsive application layout stylesheet', () => {
  it('gives a closed-pane sheet workspace one full-height viewport row', () => {
    expect(responsiveCss).toMatch(
      /\.sheetWorkspace\s*\{[^}]*grid-template-areas:\s*"viewport";[^}]*grid-template-rows:\s*minmax\(0, 1fr\);/s,
    )
    expect(responsiveCss).toMatch(
      /\.sheetWorkspace\s*>\s*\.sheetViewport,[^{]*\.sheetWorkspace\s*>\s*\.sheetViewportFrame\s*\{[^}]*grid-area:\s*viewport;/s,
    )
  })

  it('allocates rows only for side panes that are open', () => {
    expect(responsiveCss).toContain('.sheetWorkspace:not(.leftDockClosed).rightDockClosed')
    expect(responsiveCss).toContain('.sheetWorkspace.leftDockClosed:not(.rightDockClosed)')
    expect(responsiveCss).toContain('.sheetWorkspace:not(.leftDockClosed):not(.rightDockClosed)')
    expect(responsiveCss).toMatch(/\.sheetWorkspace\s*>\s*\.sheetDockLeft\s*\{[^}]*grid-area:\s*left;/s)
    expect(responsiveCss).toMatch(/\.sheetWorkspace\s*>\s*\.sheetDockRight\s*\{[^}]*grid-area:\s*right;/s)
  })

  it('keeps pane toggles over the viewport without consuming grid rows', () => {
    expect(responsiveCss).toMatch(
      /\.sheetWorkspace\s*>\s*\.panelResizeRail\s*\{[^}]*position:\s*absolute;[^}]*grid-column:\s*auto;[^}]*grid-row:\s*auto;/s,
    )
  })

  it('tracks the dynamic browser viewport when supported', () => {
    expect(baseCss).toMatch(
      /@supports\s*\(height:\s*100dvh\)\s*\{[\s\S]*?html,[\s\S]*?body,[\s\S]*?#root\s*\{[^}]*height:\s*100dvh;/,
    )
  })
})
