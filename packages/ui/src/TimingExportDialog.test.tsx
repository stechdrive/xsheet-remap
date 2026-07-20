import { fireEvent, render, screen } from '@testing-library/react'
import { buildCspImportPackage, createDefaultProject, createProjectDocumentFromCutProject, defaultTimelineSections, registerAssetRoot, standardA3SheetTemplate } from '@xsheet-remap/core'
import { describe, expect, it, vi } from 'vitest'
import { TimingExportDialog } from './TimingExportDialog'
import type { CspImportExportState } from './useCspImportExportPlan'

const idleCspImportState: CspImportExportState = { phase: 'idle', plan: null, error: null }

function readyCspImportState(target: NonNullable<CspImportExportState['plan']>['target'], keyOnlyCount = 0): CspImportExportState {
  const rooted = registerAssetRoot(createDefaultProject(), { label: 'C001', path: 'C:\\cuts\\C001' })
  const packageBuild = buildCspImportPackage(createProjectDocumentFromCutProject(rooted.project))
  return {
    phase: 'ready',
    error: null,
    plan: {
      target,
      packageBuild,
      files: [{ relativePath: 'csp-import.xci', contents: '{}' }, { relativePath: 'C001.xdts', contents: '' }],
      materialSummary: { availableCount: 0, keyOnlyCount, unavailableAssignedCount: 0 },
      blockingIssues: [],
      advisories: [],
    },
  }
}

describe('TimingExportDialog', () => {
  it('allows a portable CSP ZIP export without a native asset-root path in the browser', () => {
    const onConfirm = vi.fn()
    render(
      <TimingExportDialog
        state={{ kind: 'csp-import', timingSourceRole: 'action', includeSound: false, includeCamera: false }}
        timelineSections={defaultTimelineSections(standardA3SheetTemplate)}
        issues={[]}
        cspImportState={readyCspImportState({ mode: 'portable-zip', archiveFileName: 'xsheet-csp-import.zip' })}
        onChangeRole={() => undefined}
        onChangeOptions={() => undefined}
        onReconnectAssetRoot={() => undefined}
        onCancel={() => undefined}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByText('xsheet-csp-import.zip')).toBeTruthy()
    const exportButton = screen.getByRole('button', { name: '書き出す' })
    expect((exportButton as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(exportButton)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('uses template-derived timeline names and keeps SOUND/CAMERA opt-in', () => {
    const timelineSections = defaultTimelineSections(standardA3SheetTemplate).map(section => {
      if (section.role === 'sound') return { ...section, label: 'セリフ' }
      if (section.role === 'camera') return { ...section, label: '撮影指示' }
      return section
    })
    render(
      <TimingExportDialog
        state={{ kind: 'xdts', timingSourceRole: 'action', includeSound: false, includeCamera: false }}
        timelineSections={timelineSections}
        issues={[]}
        cspImportState={idleCspImportState}
        onChangeRole={() => undefined}
        onChangeOptions={() => undefined}
        onReconnectAssetRoot={() => undefined}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    )

    expect((screen.getByLabelText('セリフを含める') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('撮影指示を含める') as HTMLInputElement).checked).toBe(false)
  })

  it('falls back to semantic SOUND/CAMERA names when a custom template leaves them blank', () => {
    const timelineSections = defaultTimelineSections(standardA3SheetTemplate).map(section => (
      section.role === 'sound' || section.role === 'camera' ? { ...section, label: '   ' } : section
    ))
    render(
      <TimingExportDialog
        state={{ kind: 'xdts', timingSourceRole: 'action', includeSound: false, includeCamera: false }}
        timelineSections={timelineSections}
        issues={[]}
        cspImportState={idleCspImportState}
        onChangeRole={() => undefined}
        onChangeOptions={() => undefined}
        onReconnectAssetRoot={() => undefined}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    )

    expect(screen.getByLabelText('SOUNDを含める')).toBeTruthy()
    expect(screen.getByLabelText('CAMERAを含める')).toBeTruthy()
  })

  it('summarizes an unassigned CSP target as a normal key-only export', () => {
    const onConfirm = vi.fn()
    const view = render(
      <TimingExportDialog
        state={{ kind: 'csp-import', timingSourceRole: 'action', includeSound: false, includeCamera: false }}
        timelineSections={defaultTimelineSections(standardA3SheetTemplate)}
        issues={[]}
        cspImportState={readyCspImportState({
          mode: 'native-cut-folder',
          rootPath: 'C:\\cuts\\C001',
          outputDirectoryPath: 'C:\\cuts\\C001\\xsheet-csp-import',
          manifestPath: 'C:\\cuts\\C001\\xsheet-csp-import\\csp-import.xci',
        }, 1)}
        onChangeRole={() => undefined}
        onChangeOptions={() => undefined}
        onReconnectAssetRoot={() => undefined}
        onCancel={() => undefined}
        onConfirm={onConfirm}
      />,
    )

    expect(view.getByText('キーのみ 1件')).toBeTruthy()
    expect(view.queryByText(/画像素材が未割当/)).toBeNull()
    const exportButton = view.container.querySelector<HTMLButtonElement>('button.primary')
    expect(exportButton).not.toBeNull()
    expect(exportButton!.disabled).toBe(false)
    fireEvent.click(exportButton!)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('blocks desktop export and offers cut-folder reconnection when the stored root is unavailable', () => {
    const onReconnectAssetRoot = vi.fn()
    const ready = readyCspImportState({
      mode: 'native-root-unavailable',
      rootPath: 'D:\\offline\\C001',
      reason: 'このPCでカットフォルダの場所を確認できません。',
    })
    if (ready.phase !== 'ready') throw new Error('expected ready state')
    ready.plan.blockingIssues.push({
      issueId: 'cspImport.assetRoot.unavailable',
      severity: 'error',
      code: 'cspImport.assetRoot.unavailable',
      message: 'root unavailable',
      target: { entity: 'export', id: 'root' },
    })
    const view = render(
      <TimingExportDialog
        state={{ kind: 'csp-import', timingSourceRole: 'action', includeSound: false, includeCamera: false }}
        timelineSections={defaultTimelineSections(standardA3SheetTemplate)}
        issues={[]}
        cspImportState={ready}
        onChangeRole={() => undefined}
        onChangeOptions={() => undefined}
        onReconnectAssetRoot={onReconnectAssetRoot}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    )

    fireEvent.click(view.getByRole('button', { name: 'カットフォルダを選び直す…' }))
    expect(onReconnectAssetRoot).toHaveBeenCalledOnce()
    expect(view.container.querySelector<HTMLButtonElement>('button.primary')?.disabled).toBe(true)
  })
})
