import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RemapApp } from './App'
import { clipImageDataUrl } from './clipImageImport'
import { dragInternalPointer, openAppNavigationMenu, setSheetRect, templateFramePoint } from './App.test-support'
import { uiText } from './i18n'
import { dispatchInternalDrag } from './internalDrag'

vi.mock('./clipImageImport', () => ({ clipImageDataUrl: vi.fn() }))
const imageUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
beforeEach(() => { vi.mocked(clipImageDataUrl).mockResolvedValue(imageUrl); URL.createObjectURL = file => `blob:${(file as File).name}` })
function setup() {
  render(<RemapApp />)
  const sheet = screen.getByLabelText(uiText.sheet.canvasLabel); setSheetRect(sheet, 0, 0)
  const folder = document.querySelector<HTMLElement>('[data-clip-layer-id="slot:slot_A"]')!
  fireEvent.click(folder)
  const input = document.querySelector<HTMLInputElement>('.clipLayerPanel input[type=file]')!
  return { sheet, folder, input }
}
const file = (name: string) => new File(['pixels'], name, { type: 'image/png' })
const layer = (name: string) => Array.from(document.querySelectorAll<HTMLElement>('.clipLayerRow')).find(row => row.querySelector('.clipLayerName')?.textContent === name)

describe('Remap CLIP layer workspace', () => {
  it('switches independent timing without adding Undo entries and keeps sheet drops in their selected group', async () => {
    const { sheet } = setup()
    const process = screen.getByLabelText('登録先工程') as HTMLSelectElement
    const base = process.value, other = Array.from(process.options).find(option => option.value !== base)!.value
    const dropAt = (frame: number, name: string) => {
      const target = templateFramePoint('cell', 'A', frame)
      const drop = createEvent.drop(sheet, { dataTransfer: { files: [file(name)], types: ['Files'], getData: () => '' } })
      Object.defineProperties(drop, { clientX: { value: target.x }, clientY: { value: target.y } }); fireEvent(sheet, drop)
    }
    const frames = () => Array.from(document.querySelectorAll('[data-timeline-event-frame]')).map(element => element.getAttribute('data-timeline-event-frame'))
    dropAt(1, 'base.png')
    await waitFor(() => expect(frames()).toContain('1'))
    fireEvent.change(process, { target: { value: other } })
    expect(document.querySelector('.eventText')).toBeNull()
    dropAt(5, 'correction.png')
    await waitFor(() => expect(frames()).toContain('5'))
    expect(frames()).not.toContain('1')
    fireEvent.click(screen.getByRole('checkbox', { name: '工程差を表示' }))
    expect(screen.getByRole('region', { name: '工程別タイミング差分' }).textContent).toContain('区間')
    expect(document.querySelector('[data-testid="process-difference-overlay"]')).toBeTruthy()
    fireEvent.change(process, { target: { value: base } })
    expect(frames()).toContain('1'); expect(frames()).not.toContain('5')
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.undo }))
    expect(frames()).toContain('1')
    fireEvent.change(process, { target: { value: other } })
    expect(document.querySelector('.eventText')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.redo }))
    expect(frames()).toContain('5'); expect(frames()).not.toContain('1')
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
    expect(layer('stale')).toBeUndefined()
    expect(screen.getByRole('tree', { name: 'CLIPレイヤーツリー' })).toBeTruthy()
  })
})
