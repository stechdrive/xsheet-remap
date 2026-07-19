import { fireEvent, render, screen } from '@testing-library/react'
import { standardA3SheetTemplate } from '@xsheet-remap/core'
import { describe, expect, it, vi } from 'vitest'
import { TimingExportDialog } from './TimingExportDialog'

describe('TimingExportDialog', () => {
  it('allows a portable CSP ZIP export without a native asset-root path in the browser', () => {
    const onConfirm = vi.fn()
    render(
      <TimingExportDialog
        state={{ kind: 'csp-import', timingSourceRole: 'action', includeSound: false, includeCamera: false }}
        template={standardA3SheetTemplate}
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
})
