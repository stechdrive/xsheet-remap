import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = join(process.cwd(), 'packages', 'ui', 'src')

describe('template authoring performance contract', () => {
  it('does not serialize the whole template to detect draft changes or remount the project workspace', () => {
    const workspace = readSource('template-workspace-workspace.tsx')
    const controller = readSource('app-shell-controller.tsx')
    const view = readSource('app-shell-view.tsx')

    expect(workspace).not.toMatch(/JSON\.stringify\((?:appliedTemplate|draftTemplate)/)
    expect(controller).not.toMatch(/JSON\.stringify\(template\)/)
    expect(view).not.toContain('key={templatePanelKey}')
    expect(view).toContain('onDraftStateChange')
    expect(workspace).toContain('useDeferredValue(template)')
    expect(workspace).toContain("deep: activeDetailTab === 'review'")
  })

  it('keeps the static render model memoized and filters hidden regions after model creation', () => {
    const editor = readSource('template-workspace-region-editor.tsx')

    expect(editor).toContain('() => buildTemplateEditorRenderModel')
    expect(editor).toContain('useDeferredValue(template)')
    expect(editor).toContain('withoutTemplateRegions(unfilteredBaseRenderModel, hiddenRegionIds)')
  })

  it('keeps full draft snapshots out of the standalone app render state', () => {
    const standalone = readSource('TemplateEditorApp.tsx')

    expect(standalone).toContain('draftStateRef')
    expect(standalone).not.toContain('useState<TemplateWorkspaceDraftState>')
    expect(standalone).toContain('recoverySaveTimerRef')
  })
})

function readSource(fileName: string): string {
  return readFileSync(join(sourceRoot, fileName), 'utf8')
}
