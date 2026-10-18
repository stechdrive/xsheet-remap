import { useState } from 'react'
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addClipLayers, createClipNode, createDefaultProject, ensureClipDocument, type ClipLayerNode, type CutProject } from '@xsheet-remap/core'
import { ClipLayerPanel } from './ClipLayerPanel'
import { dispatchInternalDrag } from './internalDrag'
import { publishNativeLayerHover, clipLayerDropTarget } from './clipLayerDrop'
import { clearNativeFileDragPreview, updateNativeFileDragPreview } from './nativeFileDragPreview'

afterEach(() => { cleanup(); clearNativeFileDragPreview(); vi.restoreAllMocks(); vi.useRealTimers() })
function setup(locked = false, extras: ClipLayerNode[] = []) {
  const folder = createClipNode('素材', 'folder', null, 'materials')
  const first = { ...createClipNode('first', 'raster', folder.id, 'first'), locked }
  const second = createClipNode('second', 'raster', folder.id, 'second')
  let current = addClipLayers(ensureClipDocument(createDefaultProject()), [folder, first, second, ...extras])
  const changes = vi.fn(), files = vi.fn()
  function Harness() {
    const [project, setProject] = useState(current)
    return <ClipLayerPanel project={project} activeCutId="cut-main" activeProcessId={project.correctionLayers[0].layerId} onProcessChange={vi.fn()} onChange={(next: CutProject) => { current = next; changes(next); setProject(next) }} onFiles={files} onSelectKey={vi.fn()} selectedHit={null} filterProcess={false} onFilterProcess={vi.fn()} onAddColumn={vi.fn()} onNormalizeNames={vi.fn()} onAddGuide={vi.fn()} />
  }
  render(<Harness />)
  const row = (id: string) => document.querySelector<HTMLElement>(`[data-clip-layer-id="${id}"]`)!
  return { row, changes, files, project: () => current }
}

describe('CSP-style layer palette controls', () => {
  it('respects imported folder disclosure independently of visibility and keeps user disclosure across edits', () => {
    const folder = { ...createClipNode('閉じたフォルダー', 'folder', null, 'closed'), expanded: false }
    const child = createClipNode('内側', 'raster', folder.id, 'child')
    const { row, changes } = setup(false, [folder, child])
    expect(screen.getByRole('treeitem', { name: folder.name }).getAttribute('aria-expanded')).toBe('false')
    expect(row('child')).toBeNull()
    fireEvent.click(row('closed'))
    fireEvent.keyDown(row('closed'), { key: 'ArrowRight' })
    expect(row('child')).not.toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: '閉じたフォルダーの表示' }))
    expect(row('child')).not.toBeNull()
    expect(changes.mock.calls[0][0].clipDocument.nodes.find((node: ClipLayerNode) => node.id === folder.id)).toMatchObject({ expanded: false, visible: false })
    fireEvent.keyDown(row('closed'), { key: 'ArrowLeft' })
    expect(row('child')).toBeNull()
  })
  it('moves keyboard ownership off the thumbnail when dragging and suppresses native file hover tooltips', () => {
    vi.useFakeTimers()
    const { row } = setup()
    const thumbnail = row('first').querySelector<HTMLButtonElement>('.clipLayerThumbnail')!
    thumbnail.focus()
    const down = createEvent.pointerDown(thumbnail, { bubbles: true })
    Object.defineProperties(down, { button: { value: 0 }, pointerId: { value: 1 }, pointerType: { value: 'mouse' }, clientX: { value: 10 }, clientY: { value: 10 } })
    fireEvent(thumbnail, down)
    const move = createEvent.pointerMove(window)
    Object.defineProperties(move, { pointerId: { value: 1 }, clientX: { value: 40 }, clientY: { value: 20 } })
    fireEvent(window, move)
    expect(document.activeElement).toBe(row('first').closest('.clipLayerPanel'))
    fireEvent.keyDown(window, { key: 'Escape' })
    act(() => updateNativeFileDragPreview({ type: 'enter', paths: ['001.png'] }, { x: 40, y: 20 }, null, true))
    fireEvent.pointerEnter(row('second').querySelector('.clipLayerName')!); act(() => vi.runAllTimers())
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => clearNativeFileDragPreview())
  })
  it('uses shared path tooltips and dismisses them for the entire layer drag', () => {
    vi.useFakeTimers()
    const { row } = setup()
    const name = row('first').querySelector('.clipLayerName')!
    fireEvent.pointerEnter(name); act(() => vi.runAllTimers())
    expect(screen.getByRole('tooltip').textContent).toContain('素材 / first')
    act(() => dispatchInternalDrag({ sessionId: 'tooltip', phase: 'start', payload: { kind: 'clip-layer', layerId: 'first' }, clientX: 0, clientY: 0 }))
    fireEvent.pointerEnter(row('second').querySelector('.clipLayerName')!); act(() => vi.runAllTimers())
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => dispatchInternalDrag({ sessionId: 'tooltip', phase: 'cancel', payload: { kind: 'clip-layer', layerId: 'first' }, clientX: 0, clientY: 0 }))
    fireEvent.pointerLeave(name); fireEvent.pointerEnter(name); act(() => vi.runAllTimers())
    expect(screen.getByRole('tooltip').textContent).toContain('素材 / first')
  })

  it('shows label colors independent of eye/selection, distinguishes media, and disables image appearance for audio', () => {
    const audio = { ...createClipNode('セリフ001', 'audio', null, 'audio'), labelColor: '#ffaa82', sourceLayerId: 10 }
    const video = { ...createClipNode('ムービー001', 'video', null, 'movie'), sourceLayerId: 11 }
    const { row, project } = setup(false, [audio, video])
    expect(screen.getByRole('img', { name: 'セリフ001のラベルカラー #ffaa82' })).toBeTruthy()
    expect(row('audio').parentElement?.style.getPropertyValue('--clip-label-color')).toBe('#ffaa82')
    fireEvent.click(screen.getByRole('button', { name: 'セリフ001の音声操作' }))
    expect(screen.getByRole('slider').closest('fieldset')?.disabled).toBe(true)
    expect(row('audio').textContent).toContain('音声レイヤー')
    expect(row('audio').textContent).not.toContain('100%')
    expect(row('movie').textContent).toContain('動画')
    expect(screen.getByRole('button', { name: 'セリフ音声へ取り込む' })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'セリフ001の表示' }))
    expect(project().clipDocument!.nodes.find(node => node.id === audio.id)).toMatchObject({ labelColor: '#ffaa82', visible: false })
    expect(row('audio').parentElement?.style.getPropertyValue('--clip-label-color')).toBe('#ffaa82')
  })
  it('keeps visibility, appearance, creation and deletion in the layer palette; opacity drag commits once', () => {
    const { row, changes, project } = setup()
    fireEvent.click(row('first'))
    const slider = screen.getByRole('slider', { name: 'レイヤーの不透明度スライダー' })
    fireEvent.change(slider, { target: { value: '70' } }); fireEvent.change(slider, { target: { value: '35' } })
    expect(changes).not.toHaveBeenCalled()
    fireEvent.pointerUp(slider); fireEvent.blur(slider)
    expect(changes).toHaveBeenCalledTimes(1)
    expect(project().clipDocument!.nodes.find(node => node.id === 'first')?.opacity).toBe(.35)
    fireEvent.change(screen.getByLabelText('レイヤーの合成モード'), { target: { value: '2' } })
    expect(row('first').textContent).toContain('35% 乗算')
    fireEvent.click(screen.getByRole('checkbox', { name: 'firstの表示' }))
    expect(project().clipDocument!.nodes.find(node => node.id === 'first')?.visible).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '新規ラスターレイヤー' }))
    const siblings = project().clipDocument!.nodes.filter(node => node.parentId === 'materials')
    expect(siblings.map(node => node.name)).toEqual(['レイヤー', 'first', 'second'])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'レイヤーを削除' }))
    expect(project().clipDocument!.nodes.some(node => node.id === siblings[0].id)).toBe(false)
  })
  it('renames on the name, keeps quick look separate, and cancels a slider gesture without editing', () => {
    const { row, changes } = setup()
    fireEvent.click(row('first'))
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '20' } }); fireEvent.pointerCancel(slider); fireEvent.blur(slider)
    expect(changes).not.toHaveBeenCalled()
    fireEvent.doubleClick(row('first').querySelector('.clipLayerName')!)
    fireEvent.change(screen.getByLabelText('レイヤー名'), { target: { value: 'renamed' } })
    fireEvent.keyDown(screen.getByLabelText('レイヤー名'), { key: 'Enter' })
    expect(row('first').textContent).toContain('renamed')
    expect(screen.getByRole('button', { name: 'renamedをクイックルック' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('shows the same before/after destination that pointer drop commits, and clears it on cancel', () => {
    const { row, changes, project } = setup()
    const target = row('first')
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 40 } as DOMRect)
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target })
    const drag = (phase: 'move' | 'drop' | 'cancel', y: number) => act(() => dispatchInternalDrag({ sessionId: 'layers', phase, payload: { kind: 'clip-layer', layerId: 'second' }, clientX: 100, clientY: y }))
    drag('move', 104)
    expect(target.parentElement?.classList.contains('clipDropBefore')).toBe(true)
    expect(changes).not.toHaveBeenCalled()
    drag('cancel', 104)
    expect(target.parentElement?.classList.contains('clipDropBefore')).toBe(false)
    drag('drop', 104)
    expect(project().clipDocument!.nodes.filter(node => node.parentId === 'materials').map(node => node.id)).toEqual(['second', 'first'])
  })
  it('uses identical browser-file and native hover destinations, clears on leave, and passes the insertion anchor', async () => {
    const { row, files, project } = setup()
    const target = row('second')
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 40 } as DOMRect)
    act(() => publishNativeLayerHover(clipLayerDropTarget(project().clipDocument!, 'second', .1)))
    expect(target.parentElement?.classList.contains('clipDropBefore')).toBe(true)
    act(() => publishNativeLayerHover(null))
    expect(target.parentElement?.classList.contains('clipDropBefore')).toBe(false)
    const event = createEvent.drop(target, { dataTransfer: { files: [new File(['png'], 'new.png', { type: 'image/png' })], types: ['Files'] } })
    Object.defineProperty(event, 'clientY', { value: 104 }); fireEvent(target, event)
    await waitFor(() => expect(files).toHaveBeenCalledWith(expect.any(Array), 'materials', 'second'))
  })
  it('keeps imported protected layer controls disabled', () => {
    const { row, changes } = setup(true)
    fireEvent.click(row('first'))
    expect((screen.getByRole('slider') as HTMLInputElement).disabled || screen.getByRole('slider').closest('fieldset')?.disabled).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'firstの表示' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'レイヤーを削除' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.doubleClick(row('first').querySelector('.clipLayerName')!)
    expect(screen.queryByLabelText('レイヤー名')).toBeNull()
    expect(changes).not.toHaveBeenCalled()
  })
})
