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
})
