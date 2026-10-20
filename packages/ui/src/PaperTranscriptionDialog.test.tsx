import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProject, standardA3SheetTemplate, paperTranscriptionUnreadResult, buildPaperTranscriptionPrompt, type PaperTranscriptionRequest } from '@xsheet-remap/core'
import { saveTextFile, writeClipboardText } from '@xsheet-remap/adapters'
import { PaperTranscriptionDialog, type PaperTranscriptionDialogProps } from './PaperTranscriptionDialog'
import { revisePaperTranscriptionRun } from './PaperTranscriptionReview'

vi.mock('@xsheet-remap/adapters', () => ({
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
  saveTextFile: vi.fn().mockResolvedValue({ saved: true }),
  saveBinaryFile: vi.fn().mockResolvedValue({ saved: true }),
}))
vi.mock('./paperTranscriptionImages', () => ({
  paperTranscriptionPagePng: vi.fn().mockResolvedValue(null),
  paperTranscriptionCrop: vi.fn().mockReturnValue({ x: 0, y: 0, w: 1, h: 1 }),
  paperTranscriptionImageArchive: vi.fn().mockResolvedValue(new Uint8Array()),
}))
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks() })

function setup() {
  const props: PaperTranscriptionDialogProps = {
    open: true, project: createDefaultProject(), template: standardA3SheetTemplate, scopeKey: 'cut:revision',
    runtimeImageUrls: {}, initialRange: { from: 1, to: 6 }, onClose: vi.fn(), onApply: vi.fn(),
  }
  return { props, ...render(<PaperTranscriptionDialog {...props} />) }
}
async function prepare() {
  fireEvent.click(screen.getByRole('checkbox', { name: /^ACTION$/ }))
  fireEvent.click(screen.getByRole('button', { name: 'プロンプトをコピー' }))
  await waitFor(() => expect(writeClipboardText).toHaveBeenCalledTimes(1))
  const key = Object.keys(localStorage).find(key => key.startsWith('xsheet-paper-transcription-v1:'))!
  const request = JSON.parse(localStorage.getItem(key)!).request as PaperTranscriptionRequest
  return request
}
function enterResult(text: string) {
  fireEvent.click(screen.getByRole('tab', { name: '結果を取り込む' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'AIから返ってきたJSON' }), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: '内容を確認する' }))
}

describe('paper transcription dialog', () => {
  it('copies and downloads the same self-contained prompt and restores the request after unmount', async () => {
    const { props, unmount } = setup()
    const request = await prepare()
    fireEvent.click(screen.getByRole('button', { name: 'テキストファイルを保存…' }))
    await waitFor(() => expect(saveTextFile).toHaveBeenCalledTimes(1))
    expect(vi.mocked(writeClipboardText).mock.calls[0]![0]).toBe(buildPaperTranscriptionPrompt(request))
    expect(vi.mocked(saveTextFile).mock.calls[0]![0]).toBe(vi.mocked(writeClipboardText).mock.calls[0]![0])
    const result = JSON.stringify(paperTranscriptionUnreadResult(request))
    enterResult(result)
    expect((screen.getByRole('button', { name: '確認した内容を反映' }) as HTMLButtonElement).disabled).toBe(true)
    unmount()
    render(<PaperTranscriptionDialog {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: '結果を取り込む' }))
    expect((screen.getByRole('textbox', { name: 'AIから返ってきたJSON' }) as HTMLTextAreaElement).value).toBe(result)
    fireEvent.click(screen.getByRole('button', { name: '内容を確認する' }))
    expect(screen.getByRole('combobox', { name: '確認する対象' })).toBeTruthy()
  })
  it('repairs invalid JSON explicitly and never applies until the user resolves unread frames and reviews', async () => {
    const { props } = setup(), request = await prepare()
    enterResult('{"format":')
    expect(screen.getByRole('alert').textContent).toContain('JSON')
    fireEvent.click(screen.getByRole('button', { name: '修正依頼をコピー' }))
    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledTimes(2))
    expect(vi.mocked(writeClipboardText).mock.calls[1]![0]).toContain(request.requestId)
    expect(props.onApply).not.toHaveBeenCalled()
    enterResult(JSON.stringify(paperTranscriptionUnreadResult(request)))
    fireEvent.click(screen.getByRole('button', { name: '確認・修正' }))
    fireEvent.change(screen.getByRole('combobox', { name: '確認後の種別' }), { target: { value: 'cell' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: '記入のコマ' }), { target: { value: '1' } })
    fireEvent.change(screen.getByRole('textbox', { name: '確認後のセル番号' }), { target: { value: '001' } })
    fireEvent.click(screen.getByRole('button', { name: '修正を反映' }))
    expect(screen.getByRole('alert').textContent).toContain('要確認')
    fireEvent.click(screen.getAllByRole('button', { name: '確認・修正' })[1]!)
    fireEvent.change(screen.getByRole('combobox', { name: '確認後の種別' }), { target: { value: 'empty' } })
    fireEvent.click(screen.getByRole('button', { name: '修正を反映' }))
    expect((screen.getByRole('button', { name: '確認した内容を反映' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: '原画像と対象範囲を確認しました' }))
    fireEvent.click(screen.getByRole('button', { name: '確認した内容を反映' }))
    expect(props.onApply).toHaveBeenCalledTimes(1)
    expect(vi.mocked(props.onApply).mock.calls[0]![1].targets[0]!.runs).toMatchObject([
      { from: 1, to: 1, kind: 'cell', value: '001' }, { from: 2, to: 6, kind: 'empty' },
    ])
  })
  it('retains input but blocks old results when a different cut or template is active', async () => {
    const { props, rerender } = setup(), request = await prepare()
    const result = paperTranscriptionUnreadResult(request)
    result.targets[0]!.runs = [{ from: 1, to: 1, kind: 'cell', value: '001', raw: '001' }, { from: 2, to: 6, kind: 'empty', raw: '' }]
    enterResult(JSON.stringify(result))
    fireEvent.click(screen.getByRole('checkbox', { name: '原画像と対象範囲を確認しました' }))
    expect((screen.getByRole('button', { name: '確認した内容を反映' }) as HTMLButtonElement).disabled).toBe(false)
    rerender(<PaperTranscriptionDialog {...props} scopeKey="other-cut:revision" />)
    expect((screen.getByRole('button', { name: '確認した内容を反映' }) as HTMLButtonElement).disabled).toBe(true)
    expect(props.onApply).not.toHaveBeenCalled()
  })
  it('does not close on composition Escape and preserves the source when reopened', async () => {
    const { props, rerender } = setup()
    await prepare()
    fireEvent.click(screen.getByRole('tab', { name: '結果を取り込む' }))
    const input = screen.getByRole('textbox', { name: 'AIから返ってきたJSON' })
    fireEvent.change(input, { target: { value: '下書き' } })
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
    expect(props.onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(1)
    rerender(<PaperTranscriptionDialog {...props} open={false} />)
    rerender(<PaperTranscriptionDialog {...props} />)
    expect((screen.getByRole('textbox', { name: 'AIから返ってきたJSON' }) as HTMLTextAreaElement).value).toBe('下書き')
  })
})

it('retains ambiguous neighboring rows when a handwritten number is assigned to one frame', () => {
  const revised = revisePaperTranscriptionRun([{ from: 10, to: 12, kind: 'uncertain', raw: '7', note: '枠を跨ぐ', frameCandidates: [10, 11, 12] }], 0, 'cell', '7', 11)
  expect(revised.map(({ from, to, kind }) => [from, to, kind])).toEqual([[10, 10, 'uncertain'], [11, 11, 'cell'], [12, 12, 'uncertain']])
  expect(revised[1]!.raw).toBe('7')
  expect(() => revisePaperTranscriptionRun(revised, 1, 'cell', '8', 13)).toThrow('区間内')
})
