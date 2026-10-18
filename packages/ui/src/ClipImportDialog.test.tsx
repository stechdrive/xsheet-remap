import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeCutProjectFromDocument, createDefaultProject, createProjectDocumentFromCutProject, type ClipImportData } from '@xsheet-remap/core'
import { readClipFile } from '@xsheet-remap/adapters'
import { ClipImportDialog } from './ClipImportDialog'

vi.mock('@xsheet-remap/adapters', async importOriginal => ({ ...await importOriginal<typeof import('@xsheet-remap/adapters')>(), readClipFile: vi.fn() }))
const data: ClipImportData = {
  fileName: 'test.clip', fileHash: 'hash', currentTimelineId: 't1',
  layers: [
    { id: 'folder', parentId: null, name: '原画', kind: 'folder', visible: true, opacity: 1, blendMode: 0 },
    { id: 'upper', parentId: 'folder', name: 'A', kind: 'animation', visible: true, opacity: 1, blendMode: 0 },
    { id: 'lower', parentId: 'folder', name: '長い名前', kind: 'animation', visible: false, opacity: 1, blendMode: 0 },
    { id: 'cel', parentId: 'lower', name: '1', kind: 'raster', visible: true, opacity: 1, blendMode: 0 },
  ],
  nodes: [{ id: 'folder', name: '原画', path: ['原画'], visible: true, animation: false, children: [
    { id: 'upper', name: 'A', path: ['原画', 'A'], visible: true, animation: true, children: [] },
    { id: 'lower', name: '長い名前', path: ['原画', '長い名前'], visible: false, animation: true, children: [] },
  ] }],
  timelines: [
    { id: 't1', name: 'C001', fps: 24, startFrame: 0, endFrame: 24, tracks: [{ layerId: 'lower', frames: [{ frame: 0, value: '1' }] }] },
    { id: 't2', name: 'C002', fps: 30, startFrame: 0, endFrame: 30, tracks: [{ layerId: 'lower', frames: [{ frame: 6, value: '1' }] }] },
  ],
}
const document = createProjectDocumentFromCutProject(createDefaultProject())
function show() {
  const onImport = vi.fn(), onClose = vi.fn()
  const file = new File(['clip'], 'test.clip')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(4) })
  render(<ClipImportDialog file={file} document={document} onImport={onImport} onClose={onClose} />)
  return { onImport, onClose }
}
function focus(path: string) { fireEvent.click(screen.getByRole('button', { name: `${path}の読み込み設定`.replace(/\s+/g, ' ') })) }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(readClipFile).mockResolvedValue(structuredClone(data)) })
afterEach(cleanup)
describe('CLIP import selection', () => {
  it('preselects the lowest visible process, preserves source disclosure, and keeps a manual base while checking and folding', async () => {
    const source = structuredClone(data)
    source.nodes = ['修正', '作画', '非表示'].map((name, index) => ({ id: `g${index}`, name, path: [name], animation: false, visible: index !== 2, expanded: index !== 1, children: [
      { id: `a${index}`, name: 'A', path: [name, 'A'], animation: true, visible: true, expanded: false, children: [
        { id: `c${index}`, name: '1', path: [name, 'A', '1'], animation: false, visible: true, children: [] },
      ] },
    ] }))
    source.layers = source.nodes.flatMap((node, index) => [
      { id: node.id, parentId: null, name: node.name, kind: 'folder' as const, visible: node.visible, expanded: node.expanded, opacity: 1, blendMode: 0, labelColor: '#fbece6' },
      { id: `a${index}`, parentId: node.id, name: 'A', kind: 'animation' as const, visible: true, expanded: false, opacity: 1, blendMode: 0 },
      { id: `c${index}`, parentId: `a${index}`, name: '1', kind: 'raster' as const, visible: true, opacity: 1, blendMode: 0 },
    ])
    source.timelines.forEach(timeline => { timeline.tracks = [] })
    const before = structuredClone(source)
    vi.mocked(readClipFile).mockResolvedValue(source)
    const { onImport } = show()
    const base = await screen.findByLabelText('シートの基準にする工程を選択') as HTMLSelectElement
    expect(base.value).toBe('作画')
    expect((screen.getByRole('button', { name: 'タイムシートに読み込む' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('treeitem', { name: '作画' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('img', { name: '作画のラベルカラー #fbece6' })).not.toBeNull()
    fireEvent.change(base, { target: { value: '修正' } })
    fireEvent.click(screen.getByRole('button', { name: '作画を展開' }))
    fireEvent.click(screen.getByLabelText('作画 / Aのセル指定を取り込む'))
    fireEvent.click(screen.getByLabelText('作画 / Aのセル指定を取り込む'))
    expect(base.value).toBe('修正')
    expect(screen.queryByRole('treeitem', { name: '1' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'タイムシートに読み込む' }))
    expect(onImport.mock.calls[0][0].clipDocument.nodes).toEqual(before.layers)
    expect(source).toEqual(before)
  })
  it('keeps a preselected base beside Import and accepts whitespace in process names without renaming source layers', async () => {
    const source = structuredClone(data)
    source.layers![0].name = '原画 '
    source.nodes[0].name = '原画 '
    source.nodes[0].children.forEach(node => { node.path[0] = '原画 ' })
    vi.mocked(readClipFile).mockResolvedValue(source)
    const { onImport } = show()
    await screen.findByLabelText(/原画\s+\/ Aのセル指定を取り込む/)
    focus('原画  / 長い名前')
    fireEvent.change(screen.getByLabelText(/原画\s+\/ 長い名前の表示グループ/), { target: { value: ' LO／作監 ' } })
    const base = screen.getByLabelText('シートの基準にする工程を選択') as HTMLSelectElement
    const submit = screen.getByRole('button', { name: 'タイムシートに読み込む' }) as HTMLButtonElement
    expect(base.closest('footer')).toBe(submit.closest('footer'))
    expect(base.value).toBe('原画')
    expect(submit.disabled).toBe(false)
    fireEvent.change(base, { target: { value: 'LO／作監' } })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    const project = activeCutProjectFromDocument(onImport.mock.calls[0][0])
    expect(project.correctionLayers.find(process => process.layerId === project.logicalSheet.baseProcessId)?.label).toBe('LO／作監')
    expect(project.clipDocument!.nodes).toEqual(source.layers)
  })
  it('allows selecting a base and importing folders even when no native timeline exists', async () => {
    const source = { ...structuredClone(data), currentTimelineId: '', timelines: [] }
    vi.mocked(readClipFile).mockResolvedValue(source)
    const { onImport } = show()
    await screen.findByLabelText('原画のセル指定を取り込む')
    focus('原画 / 長い名前')
    fireEvent.change(screen.getByLabelText('原画 / 長い名前の表示グループ'), { target: { value: '修正' } })
    expect((screen.getByRole('button', { name: 'タイムシートに読み込む' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('シートの基準にする工程を選択'), { target: { value: '修正' } })
    fireEvent.click(screen.getByRole('button', { name: 'タイムシートに読み込む' }))
    const project = activeCutProjectFromDocument(onImport.mock.calls[0][0])
    expect(project.correctionLayers.find(process => process.layerId === project.logicalSheet.baseProcessId)?.label).toBe('修正')
    expect(project.logicalSheet.processTimings).toBeUndefined()
    expect(project.clipDocument!.nodes).toEqual(source.layers)
  })
  it('treats ordinary folders as subtree selection and retains unchecked static layers without inventing sheet keys', async () => {
    const source = structuredClone(data)
    source.layers!.push({ id: 'bg', parentId: 'folder', name: 'BG', kind: 'raster', visible: true, opacity: 1, blendMode: 0 })
    source.nodes[0].children.push({ id: 'bg', name: 'BG', path: ['原画', 'BG'], animation: false, visible: true, children: [] })
    vi.mocked(readClipFile).mockResolvedValue(source)
    const { onImport } = show()
    await screen.findByLabelText('原画のセル指定を取り込む')
    expect(screen.queryByLabelText('原画 / BGのセル指定を取り込む')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'すべて解除' }))
    fireEvent.click(screen.getByRole('button', { name: 'タイムシートに読み込む' }))
    const project = activeCutProjectFromDocument(onImport.mock.calls[0][0])
    expect(project.clipDocument!.nodes).toEqual(source.layers)
    expect(project.logicalSheet.events).toEqual([])
    expect(project.clipDocument!.targets).toEqual([])
  })
  it('accepts arbitrary display groups for the same cell column without changing native folder names', async () => {
    const { onImport } = show()
    await screen.findByLabelText('原画のセル指定を取り込む')
    focus('原画 / 長い名前')
    fireEvent.change(screen.getByLabelText('原画 / 長い名前の表示グループ'), { target: { value: 'LO／自由な確認用' } })
    fireEvent.change(screen.getByLabelText('原画 / 長い名前のセル列名'), { target: { value: 'A' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByRole('button', { name: 'タイムシートに読み込む' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('シートの基準にする工程を選択'), { target: { value: '原画' } })
    fireEvent.click(screen.getByRole('button', { name: 'タイムシートに読み込む' }))
    const project = activeCutProjectFromDocument(onImport.mock.calls[0][0])
    expect(project.correctionLayers.map(layer => layer.label)).toContain('LO／自由な確認用')
    expect(project.clipDocument!.nodes.find(node => node.id === 'lower')?.name).toBe('長い名前')
    expect(project.clipDocument!.targets).toHaveLength(2)
    expect(project.cspTrackSlots.filter(slot => project.clipDocument!.targets.some(target => target.slotId === slot.slotId)).map(slot => slot.paperTrack)).toEqual(['A', 'A'])
  })
  it('toggles a subtree and partial selection, keeps short editable names, and cancels without importing', async () => {
    const callbacks = show()
    const parent = await screen.findByLabelText('原画のセル指定を取り込む') as HTMLInputElement
    expect(parent.checked).toBe(true)
    focus('原画 / 長い名前')
    expect((screen.getByLabelText('原画 / 長い名前のセル列名') as HTMLInputElement).value).toBe('長い名前')
    fireEvent.click(screen.getByLabelText('原画 / Aのセル指定を取り込む'))
    expect(parent.indeterminate).toBe(true)
    fireEvent.click(parent)
    expect(parent.checked).toBe(true)
    focus('原画 / A')
    fireEvent.change(screen.getByLabelText('原画 / Aのセル列名'), { target: { value: '長い名前' } })
    expect(screen.getByRole('alert').textContent).toContain('重複')
    expect((screen.getByRole('button', { name: 'タイムシートに読み込む' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(callbacks.onClose).toHaveBeenCalledOnce()
    expect(callbacks.onImport).not.toHaveBeenCalled()
  })
  it('imports selected timelines as shared cuts into CELL in one callback', async () => {
    const { onImport } = show()
    await screen.findByLabelText('原画のセル指定を取り込む')
    fireEvent.click(screen.getByRole('checkbox', { name: /C002/ }))
    fireEvent.click(screen.getByRole('button', { name: 'CELL' }))
    fireEvent.click(screen.getByRole('button', { name: 'タイムシートに読み込む' }))
    expect(onImport).toHaveBeenCalledOnce()
    const doc = onImport.mock.calls[0][0]
    expect(doc.cuts).toHaveLength(2)
    const first = activeCutProjectFromDocument(doc)
    const second = activeCutProjectFromDocument({ ...doc, activeCutId: doc.cuts[1].cutId })
    expect(first.logicalSheet.events[0]).toMatchObject({ paperTrack: '長い名前', frame: 1, sheetRole: 'cell' })
    expect(second.logicalSheet.events[0]).toMatchObject({ keyId: first.logicalSheet.events[0].keyId, frame: 7, sheetRole: 'cell' })
  })
  it('lets the user exclude an unreadable selected folder without clearing valid selections', async () => {
    const invalid = structuredClone(data)
    invalid.timelines[1].tracks[0].error = '未対応のカーブ'
    vi.mocked(readClipFile).mockResolvedValue(invalid)
    show(); await screen.findByLabelText('原画のセル指定を取り込む')
    fireEvent.click(screen.getByRole('checkbox', { name: /C002/ }))
    expect(screen.getByRole('alert').textContent).toContain('未対応')
    fireEvent.click(screen.getByLabelText('原画 / 長い名前のセル指定を取り込む'))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect((screen.getByLabelText('原画 / Aのセル指定を取り込む') as HTMLInputElement).checked).toBe(true)
  })
})
