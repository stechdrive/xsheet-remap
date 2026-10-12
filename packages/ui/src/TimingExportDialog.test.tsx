import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { defaultTimelineSections, standardA3SheetTemplate } from '@xsheet-remap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimingExportDialog } from './TimingExportDialog'
import { uiText } from './i18n'

afterEach(cleanup)

describe('TimingExportDialog', () => {
  it('uses the shared ACTION/CELL selector for After Effects JSX without XDTS options', () => {
    const onConfirm = vi.fn()
    render(
      <TimingExportDialog
        state={{ kind: 'ae-jsx', timingSourceRole: 'action', includeSound: false, includeCamera: false }}
        timelineSections={defaultTimelineSections(standardA3SheetTemplate)}
        issues={[]}
        onChangeRole={() => undefined}
        onChangeOptions={() => undefined}
        onCancel={() => undefined}
        onConfirm={onConfirm}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: uiText.actions.aeJsx })
    expect(screen.getByRole('button', { name: 'ACTION' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'CELL' })).toBeTruthy()
    expect(screen.queryByLabelText('SOUNDを含める')).toBeNull()
    expect(screen.queryByLabelText('CAMERAを含める')).toBeNull()
    expect(screen.getByText(uiText.afterEffects.jsxDescription)).toBeTruthy()
    const exportButton = screen.getByRole('button', { name: '書き出す' }) as HTMLButtonElement
    expect(exportButton.disabled).toBe(false)
    fireEvent.click(exportButton)
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(dialog).toBeTruthy()
  })

  it('locks the After Effects send dialog while one send is in progress', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(
      <TimingExportDialog
        state={{ kind: 'ae-send', timingSourceRole: 'cell', includeSound: false, includeCamera: false }}
        timelineSections={defaultTimelineSections(standardA3SheetTemplate)}
        issues={[]}
        afterEffectsSending
        onChangeRole={() => undefined}
        onChangeOptions={() => undefined}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('dialog', { name: uiText.actions.aeSend })).toBeTruthy()
    for (const name of ['閉じる', 'キャンセル', 'ACTION', 'CELL', '送信中…']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
    fireEvent.click(screen.getByRole('button', { name: '送信中…' }))
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
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
