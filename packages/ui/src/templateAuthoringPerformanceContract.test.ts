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

  it('keeps committed controls synchronous while isolating rAF drag previews from the static model', () => {
    const editor = readSource('template-workspace-region-editor.tsx')

    expect(editor).toContain('() => buildTemplateEditorRenderModel')
    expect(editor).not.toContain('useDeferredValue(template)')
    expect(editor).toContain('const [dragPreview, setDragPreview]')
    expect(editor).toContain('window.requestAnimationFrame(updatePreview)')
    expect(editor).toContain('buildTemplateEditorSurfaceModel')
    expect(editor).toContain('withoutTemplateRegions(unfilteredBaseRenderModel, baseHiddenRegionIds)')
  })

  it('moves the physical timeline as one composited snapshot without rebuilding its grid paths', () => {
    const editor = readSource('template-workspace-region-editor.tsx')

    expect(editor).toContain("dragPreview.mode === 'translate'")
    expect(editor).toContain('onlyTemplateRegions(unfilteredBaseRenderModel, paperTimelineMoveRegionIds)')
    expect(editor).toContain('<PaperTimelineMoveSnapshot renderModel={renderModel} sourceRect={sourceRect} />')
    expect(editor).toContain('transform: `translate3d(${deltaXPx}px, ${deltaYPx}px, 0)`')
  })

  it('isolates view settings from template authoring and coalesces wheel zoom work by frame', () => {
    const workspace = readSource('template-workspace-workspace.tsx')
    const editor = readSource('template-workspace-region-editor.tsx')

    expect(workspace).toContain('createTemplateEditorViewStore()')
    expect(workspace).not.toContain('const [templateZoom')
    expect(editor).toContain('useSyncExternalStore(viewStore.subscribe')
    expect(editor).toContain('pendingWheelZoomRef')
    expect(editor).toContain('requestAnimationFrame(flushWheelZoom)')
    expect(editor).toContain('viewStore.getSnapshot().zoom')
    expect(editor).not.toContain('}, [setZoom, zoom])')
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
