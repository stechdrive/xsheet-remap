import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = join(process.cwd(), 'packages', 'ui', 'src')

describe('template authoring responsive layout contract', () => {
  it('keeps all controls except the zoomable canvas on one-direction scrolling layouts', () => {
    const css = readSource('styles/template-editor.css')
    const workspace = readSource('template-workspace-workspace.tsx')
    const appShell = readSource('app-shell-view.tsx')

    expect(ruleBody(css, '.templateRegionNavigatorActions')).toContain('display: grid')
    expect(ruleBody(css, '.templateRegionNavigatorActions')).not.toContain('overflow-x')
    expect(ruleBody(css, '.templateWorkspace > .templateDock')).toContain('container-type: inline-size')
    expect(ruleBody(css, '.templateDockBody')).toContain('overflow-x: hidden')
    expect(ruleBody(css, '.templateDockBody')).toContain('overflow-y: auto')
    expect(ruleBody(css, '.templateCalibrationTargetFields')).toContain('repeat(2, minmax(0, 1fr))')
    expect(css).toContain('@container template-inspector (max-width: 340px)')
    expect(ruleBody(css, '.templateEditorViewport')).toContain('overflow: auto')

    expect(workspace).not.toContain('templateDockTabs')
    expect(workspace).not.toContain('bindingTableWrap templateTableWrap')
    expect(workspace).toContain('<TemplateInspectorNavigation')
    expect(workspace).toContain('<TemplateRegionCollectionControls')
    expect(workspace).toContain('aria-label="ズーム倍率"')
    expect(appShell).toContain("panel === 'template' ? 'templateMainPane' : ''")
  })

  it('repositions the supporting inspector before stacking all three panes', () => {
    const responsiveCss = readSource('styles/responsive.css')

    expect(responsiveCss).toContain('@media (max-width: 1180px)')
    expect(responsiveCss).toContain('"navigator editor"')
    expect(responsiveCss).toContain('"dock dock"')
    expect(responsiveCss).toContain('@media (max-width: 800px)')
    expect(ruleBody(responsiveCss, '.templateEditorAppMain')).toContain('overflow-y: auto')
    expect(ruleBody(responsiveCss, '.templateMainPane')).toContain('overflow-y: auto')
    expect(responsiveCss).toContain('min-height: 860px')
  })
})

function readSource(relativePath: string): string {
  return readFileSync(join(sourceRoot, relativePath), 'utf8')
}

function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}
