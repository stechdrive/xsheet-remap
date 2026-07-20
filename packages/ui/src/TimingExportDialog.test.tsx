import { fireEvent, render, screen } from '@testing-library/react'
import { defaultTimelineSections, standardA3SheetTemplate } from '@xsheet-remap/core'
import { describe, expect, it, vi } from 'vitest'
import { TimingExportDialog } from './TimingExportDialog'

describe('TimingExportDialog', () => {
  it('allows a portable CSP ZIP export without a native asset-root path in the browser', () => {
    const onConfirm = vi.fn()
    render(
      <TimingExportDialog
        state={{ kind: 'csp-import', timingSourceRole: 'action', includeSound: false, includeCamera: false }}
        timelineSections={defaultTimelineSections(standardA3SheetTemplate)}
        issues={[]}
        onChangeRole={() => undefined}
        onChangeOptions={() => undefined}
        onCancel={() => undefined}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByDisplayValue('素材同梱ZIP（ブラウザ保存）')).toBeTruthy()
    const exportButton = screen.getByRole('button', { name: '書き出し' })
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
        onChangeRole={() => undefined}
        onChangeOptions={() => undefined}
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
        onChangeRole={() => undefined}
        onChangeOptions={() => undefined}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    )

    expect(screen.getByLabelText('SOUNDを含める')).toBeTruthy()
    expect(screen.getByLabelText('CAMERAを含める')).toBeTruthy()
  })

  it('shows the unassigned CSP target but keeps key-only export enabled', () => {
    const onConfirm = vi.fn()
    const view = render(
      <TimingExportDialog
        state={{ kind: 'csp-import', timingSourceRole: 'action', includeSound: false, includeCamera: false }}
        timelineSections={defaultTimelineSections(standardA3SheetTemplate)}
        assetRootPath="C:\\cuts\\C001"
        issues={[{
          issueId: 'cspImport.asset.unassigned:binding_1',
          severity: 'warning',
          code: 'cspImport.asset.unassigned',
          message: 'image material is not assigned',
          target: { entity: 'binding', id: 'binding_1', label: '作画 / A / A1' },
        }]}
        onChangeRole={() => undefined}
        onChangeOptions={() => undefined}
        onCancel={() => undefined}
        onConfirm={onConfirm}
      />,
    )

    expect(view.getByText(/画像素材が未割当です: 作画 \/ A \/ A1/)).toBeTruthy()
    const exportButton = view.container.querySelector<HTMLButtonElement>('button.primary')
    expect(exportButton).not.toBeNull()
    expect(exportButton!.disabled).toBe(false)
    fireEvent.click(exportButton!)
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
