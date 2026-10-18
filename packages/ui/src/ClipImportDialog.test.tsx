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
beforeEach(() => { vi.resetAllMocks(); vi.mocked(readClipFile).mockResolvedValue(structuredClone(data)) })
afterEach(cleanup)
describe('CLIP import selection', () => {
  it('accepts arbitrary display groups for the same cell column without changing native folder names', async () => {
    const { onImport } = show()
    await screen.findByLabelText('原画を読み込む')
    fireEvent.change(screen.getByLabelText('原画 / 長い名前の表示グループ'), { target: { value: 'LO／自由な確認用' } })
    fireEvent.change(screen.getByLabelText('原画 / 長い名前のセル列名'), { target: { value: 'A' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'タイムシートに読み込む' }))
    const project = activeCutProjectFromDocument(onImport.mock.calls[0][0])
    expect(project.correctionLayers.map(layer => layer.label)).toContain('LO／自由な確認用')
    expect(project.clipDocument!.nodes.find(node => node.id === 'lower')?.name).toBe('長い名前')
    expect(project.clipDocument!.targets).toHaveLength(2)
    expect(project.cspTrackSlots.filter(slot => project.clipDocument!.targets.some(target => target.slotId === slot.slotId)).map(slot => slot.paperTrack)).toEqual(['A', 'A'])
  })
  it('toggles a subtree and partial selection, keeps short editable names, and cancels without importing', async () => {
    const callbacks = show()
    const parent = await screen.findByLabelText('原画を読み込む') as HTMLInputElement
    expect(parent.checked).toBe(true)
    expect((screen.getByLabelText('原画 / 長い名前のセル列名') as HTMLInputElement).value).toBe('長い名前')
    fireEvent.click(screen.getByLabelText('原画 / Aを読み込む'))
    expect(parent.indeterminate).toBe(true)
    fireEvent.click(parent)
    expect(parent.checked).toBe(true)
    fireEvent.change(screen.getByLabelText('原画 / Aのセル列名'), { target: { value: '長い名前' } })
    expect(screen.getByRole('alert').textContent).toContain('重複')
    expect((screen.getByRole('button', { name: 'タイムシートに読み込む' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(callbacks.onClose).toHaveBeenCalledOnce()
    expect(callbacks.onImport).not.toHaveBeenCalled()
  })
  it('imports selected timelines as shared cuts into CELL in one callback', async () => {
    const { onImport } = show()
    await screen.findByLabelText('原画を読み込む')
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
    show(); await screen.findByLabelText('原画を読み込む')
    fireEvent.click(screen.getByRole('checkbox', { name: /C002/ }))
    expect(screen.getByRole('alert').textContent).toContain('未対応')
    fireEvent.click(screen.getByLabelText('原画 / 長い名前を読み込む'))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect((screen.getByLabelText('原画 / Aを読み込む') as HTMLInputElement).checked).toBe(true)
  })
})
