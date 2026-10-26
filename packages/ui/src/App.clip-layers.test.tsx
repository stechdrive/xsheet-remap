import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RemapApp } from './App'
import { clipImageDataUrl } from './clipImageImport'
import { clickTemplateFrame, dragInternalPointer, enterTimingValue, openAppNavigationMenu, setSheetRect, templateFramePoint } from './App.test-support'
import { uiText } from './i18n'
import { dispatchInternalDrag } from './internalDrag'
import { browserFileForObjectUrl } from '@xsheet-remap/adapters'

vi.mock('./clipImageImport', () => ({ clipImageDataUrl: vi.fn() }))
const imageUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
beforeEach(() => { vi.mocked(clipImageDataUrl).mockResolvedValue(imageUrl); URL.createObjectURL = file => `blob:${(file as File).name}` })
function setup() {
  render(<RemapApp />)
  fireEvent.click(screen.getByRole('button', { name: 'CLIP組み立て' }))
  const sheet = screen.getByLabelText(uiText.sheet.canvasLabel); setSheetRect(sheet, 0, 0)
  const folder = document.querySelector<HTMLElement>('[data-clip-layer-id="slot:slot_A"]')!
  fireEvent.click(folder)
  const input = document.querySelector<HTMLInputElement>('.clipLayerPanel input[type=file]')!
  return { sheet, folder, input }
}
const file = (name: string) => new File(['pixels'], name, { type: 'image/png' })
const layer = (name: string) => Array.from(document.querySelectorAll<HTMLElement>('.clipLayerRow')).find(row => row.querySelector('.clipLayerName')?.textContent === name)

describe('Remap CLIP layer workspace', () => {
  it('stacks sheet-created cels at the top and sorts the folder with one Undo without changing sheet exposures', () => {
    const { sheet, folder } = setup()
    const names = () => Array.from(document.querySelectorAll('[data-clip-layer-id^="binding:"][data-clip-layer-parent="slot:slot_A"] .clipLayerName'), node => node.textContent)
    for (const [frame, name] of [[1, '1'], [9, '10'], [5, '2'], [13, '1']] as const) {
      clickTemplateFrame(sheet, 'cell', 'A', frame); enterTimingValue(name)
    }
    expect(names()).toEqual(['2', '10', '1'])
    const exposures = () => Array.from(document.querySelectorAll('[data-timeline-event-role="cell"]'), node => [node.getAttribute('data-timeline-event-frame'), node.querySelector('.eventText')?.textContent])
    const before = exposures()
    fireEvent.click(folder)
    fireEvent.click(screen.getByLabelText('レイヤーメニュー'))
    fireEvent.click(screen.getByRole('button', { name: '上から昇順（1→2→10）' }))
    expect(names()).toEqual(['1', '2', '10'])
    expect(exposures()).toEqual(before)
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.undo }))
    expect(names()).toEqual(['2', '10', '1'])
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.redo }))
    expect(names()).toEqual(['1', '2', '10'])
    fireEvent.click(screen.getByRole('button', { name: '上から降順（10→2→1）' }))
    expect(names()).toEqual(['10', '2', '1'])
    expect(exposures()).toEqual(before)
  })

  it('rejects oversized image batches before reading or registering any file', async () => {
    const { input } = setup()
    const oversized = file('oversized.png')
    Object.defineProperty(oversized, 'size', { value: 385 * 1024 * 1024 })
    const read = vi.spyOn(oversized, 'arrayBuffer'), createUrl = vi.spyOn(URL, 'createObjectURL')
    fireEvent.change(input, { target: { files: [oversized] } })
    await waitFor(() => expect(screen.getAllByText('一度に追加する画像は合計384MB以内にしてください。').length).toBeGreaterThan(0))
    expect(read).not.toHaveBeenCalled()
    expect(createUrl).not.toHaveBeenCalled()
    expect(layer('oversized')).toBeUndefined()
  })

  it('starts each process at A and adds J above I in every group in one Undo step', () => {
    render(<RemapApp />)
    expect(screen.queryByRole('tree')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'CLIP組み立て' }))
    fireEvent.click(screen.getByText('シートとの対応を設定'))
    const process = screen.getByLabelText('対応する工程') as HTMLSelectElement
    expect(Array.from(process.options, option => option.text)).toEqual(['作画', '演出', '監督', '作監', '総作監', 'その他修正'])
    for (const option of Array.from(process.options)) {
      fireEvent.change(process, { target: { value: option.value } })
      expect((screen.getByLabelText('登録先セル列') as HTMLSelectElement).value).toBe('A')
      expect(document.querySelector('.clipTargetPath')?.textContent).toBe(`登録先：LO / ${option.text} / A`)
      const expand = screen.queryByRole('button', { name: `${option.text}を展開` })
      if (expand) fireEvent.click(expand)
    }
    const names = (id: string) => Array.from(document.querySelector<HTMLElement>(`[data-clip-layer-id="process:${id}"]`)!.parentElement!.querySelectorAll('.clipLayerName')).slice(1).map(element => element.textContent)
    for (const option of Array.from(process.options)) expect(names(option.value)).toEqual('IHGFEDCBA'.split(''))
    fireEvent.click(screen.getByRole('button', { name: 'セル列＋' }))
    for (const option of Array.from(process.options)) expect(names(option.value)).toEqual('JIHGFEDCBA'.split(''))
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.undo }))
    for (const option of Array.from(process.options)) expect(names(option.value)).toEqual('IHGFEDCBA'.split(''))
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.redo }))
    for (const option of Array.from(process.options)) expect(names(option.value)).toEqual('JIHGFEDCBA'.split(''))
  })

  it('keeps common timing while registering a sparse correction, filtering materials and undoing only the drop', async () => {
    const { sheet } = setup()
    const process = screen.getByLabelText('編集先の工程') as HTMLSelectElement
    const base = process.value, other = Array.from(process.options).find(option => option.value !== base)!.value
    const dropAt = (frame: number, name: string) => {
      const target = templateFramePoint('cell', 'A', frame)
      const drop = createEvent.drop(sheet, { dataTransfer: { files: [file(name)], types: ['Files'], getData: () => '' } })
      Object.defineProperties(drop, { clientX: { value: target.x }, clientY: { value: target.y } }); fireEvent(sheet, drop)
    }
    const frames = () => Array.from(document.querySelectorAll('[data-timeline-event-frame]')).map(element => element.getAttribute('data-timeline-event-frame'))
    dropAt(1, 'base.png')
    await waitFor(() => expect(frames()).toContain('1'))
    dropAt(5, 'second.png')
    await screen.findByRole('dialog', { name: '画像の登録先を選択' })
    fireEvent.click(screen.getByRole('button', { name: '新しい番号として配置' }))
    await waitFor(() => expect(frames()).toContain('5'))
    const originalFrames = frames()
    fireEvent.change(process, { target: { value: other } })
    expect(frames()).toEqual(originalFrames)
    expect(screen.getByLabelText('基準シートの設定').textContent).toContain('作画')
    fireEvent.click(screen.getByRole('button', { name: '演出を展開' }))
    dropAt(5, 'correction.png')
    await screen.findByRole('dialog', { name: '画像の登録先を選択' })
    fireEvent.click(screen.getByRole('button', { name: 'この番号へ登録' }))
    await waitFor(() => expect(layer('correction')).toBeTruthy())
    expect(frames()).toEqual(originalFrames)
    fireEvent.click(screen.getByRole('checkbox', { name: '登録先工程の素材だけ表示' }))
    expect(frames()).toContain('5'); expect(frames()).not.toContain('1')
    fireEvent.change(process, { target: { value: base } })
    expect(frames()).toEqual(originalFrames)
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.undo }))
    expect(frames()).toEqual(originalFrames)
    fireEvent.change(process, { target: { value: other } })
    expect(document.querySelector('.eventText')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.redo }))
    expect(frames()).toContain('5'); expect(frames()).not.toContain('1')
    fireEvent.click(screen.getByRole('checkbox', { name: '登録先工程の素材だけ表示' }))
    expect(frames()).toEqual(originalFrames)
  })
  it('records an opacity slider gesture as one Undo operation and keeps blending and visibility independent', () => {
    const { folder } = setup()
    const slider = screen.getByRole('slider', { name: 'レイヤーの不透明度スライダー' })
    fireEvent.change(slider, { target: { value: '70' } }); fireEvent.change(slider, { target: { value: '40' } }); fireEvent.pointerUp(slider)
    expect(folder.textContent).toContain('40%')
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.undo }))
    expect(folder.textContent).toContain('100%')
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.redo }))
    expect(folder.textContent).toContain('40%')
    fireEvent.change(screen.getByLabelText('レイヤーの合成モード'), { target: { value: '2' } })
    expect(folder.textContent).toContain('40% 乗算')
    fireEvent.click(folder.querySelector('.clipLayerEye')!)
    expect(folder.querySelector('.clipLayerEye')?.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.undo }))
    expect(folder.querySelector('.clipLayerEye')?.getAttribute('aria-checked')).toBe('true')
    expect(folder.textContent).toContain('40% 乗算')
  })
  it('replaces the asset dock, bulk imports into a real animation folder, previews and reuses a cel on the sheet', async () => {
    const { input, sheet } = setup()
    expect(document.querySelector('#sheet-left-pane')).toBeNull()
    expect(document.querySelector('#sheet-right-pane .clipLayerPanel')).toBeTruthy()
    expect(screen.getByRole('tree', { name: 'CLIPレイヤーツリー' })).toBeTruthy()
    fireEvent.change(input, { target: { files: [file('001.png'), file('002.png')] } })
    await waitFor(() => expect(layer('002')).toBeTruthy())
    expect(document.querySelector('.eventText')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '001をクイックルック' }))
    await waitFor(() => expect(document.querySelector(`img[src="${imageUrl}"]`)).toBeTruthy())
    const first = layer('001')!, id = first.dataset.clipLayerId!
    act(() => { dispatchInternalDrag({ sessionId: 'cancel', phase: 'start', payload: { kind: 'clip-layer', layerId: id }, clientX: 0, clientY: 0 }); dispatchInternalDrag({ sessionId: 'cancel', phase: 'cancel', payload: { kind: 'clip-layer', layerId: id }, clientX: 0, clientY: 0 }) })
    expect(document.querySelector('.eventText')).toBeNull()
    const target = templateFramePoint('cell', 'A', 1)
    dragInternalPointer(first, sheet, { toX: target.x, toY: target.y })
    await waitFor(() => expect(document.querySelector('.eventText')?.textContent).toBe('1'))
    expect(document.querySelectorAll(`[data-clip-layer-id="${id}"]`)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.undo }))
    expect(document.querySelector('.eventText')).toBeNull()
    expect(layer('001')).toBeTruthy()
  })
  it('adds an OS image directly to the mapped folder and sheet in one Undo entry', async () => {
    const { sheet } = setup(), target = templateFramePoint('cell', 'A', 1)
    const drop = createEvent.drop(sheet, { dataTransfer: { files: [file('101.png')], types: ['Files'], getData: () => '' } })
    Object.defineProperties(drop, { clientX: { value: target.x }, clientY: { value: target.y } })
    fireEvent(sheet, drop)
    await waitFor(() => expect(document.querySelector('.eventText')?.textContent).toBe('1'))
    expect(layer('101')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.undo }))
    expect(layer('101')).toBeUndefined()
    expect(document.querySelector('.eventText')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.redo }))
    expect(layer('101')).toBeTruthy()
    expect(document.querySelector('.eventText')?.textContent).toBe('1')
  })
  it('rejects an async image completion after the workspace is reset', async () => {
    let complete!: (value: string) => void
    vi.mocked(clipImageDataUrl).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const { input } = setup()
    fireEvent.change(input, { target: { files: [file('stale.png')] } })
    await waitFor(() => expect(complete).toBeTypeOf('function'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    openAppNavigationMenu()
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.resetApp }))
    await act(async () => { complete(imageUrl); await Promise.resolve() })
    expect(browserFileForObjectUrl('blob:stale.png')).toBeUndefined()
    expect(layer('stale')).toBeUndefined()
    expect(screen.getByRole('button', { name: 'シート編集' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('tree', { name: 'CLIPレイヤーツリー' })).toBeNull()
  })
})
