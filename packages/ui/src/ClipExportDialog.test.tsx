import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProject, createOrSetEvent, createProjectDocumentFromCutProject, registerAsset, upsertBinding } from '@xsheet-remap/core'
import { generateClipFile, inspectClipFile, saveBinaryFile } from '@xsheet-remap/adapters'
import { loadClipImages } from './clipExportImages'
import { ClipExportDialog } from './ClipExportDialog'

vi.mock('@xsheet-remap/adapters', () => ({ generateClipFile: vi.fn(), inspectClipFile: vi.fn(), saveBinaryFile: vi.fn() }))
vi.mock('./clipExportImages', () => ({ loadClipImages: vi.fn() }))
const document = createProjectDocumentFromCutProject(createOrSetEvent(createDefaultProject(), 'A', 1, 'action').project)
const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
const registered = registerAsset(created.project, { name: 'A1.png', objectUrl: 'data:image/png;base64,AA==' })
const assigned = createProjectDocumentFromCutProject(upsertBinding(registered.project, { slotId: 'slot_A', keyId: created.key.keyId, cspCellName: '1', assetId: registered.asset.assetId, materialState: 'assigned' }))
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear()
  vi.mocked(loadClipImages).mockResolvedValue({})
  vi.mocked(generateClipFile).mockResolvedValue({ bytes: new Uint8Array([1, 2]), canvas: { width: 1754, height: 1240, dpi: 150, basisWidth: 1536, basisHeight: 864, offsetX: 0, offsetY: 0 }, layers: 1, timelines: 1 })
  vi.mocked(saveBinaryFile).mockResolvedValue({ saved: true })
})
afterEach(cleanup)
function show(source = document) {
  const onClose = vi.fn(), onSaved = vi.fn()
  render(<ClipExportDialog document={source} initialRole="action" onClose={onClose} onSaved={onSaved} />)
  return { onClose, onSaved }
}
async function ready() { await waitFor(() => expect((screen.getByRole('button', { name: 'CLIPを作成して保存…' }) as HTMLButtonElement).disabled).toBe(false)) }
describe('CLIP creation dialog', () => {
  it('blocks out-of-paper offsets immediately and recovers when corrected', async () => {
    show(); await ready()
    fireEvent.change(screen.getByLabelText('オフセット（中央基準） 横 X（px）'), { target: { value: '110' } })
    expect(screen.getByRole('alert').textContent).toContain('はみ出さない')
    expect((screen.getByRole('button', { name: 'CLIPを作成して保存…' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('オフセット（中央基準） 横 X（px）'), { target: { value: '109' } })
    await ready()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('creates a named empty cel and a timeline with no CLIP template or images', async () => {
    const callbacks = show(); await ready()
    expect(screen.queryByLabelText('画像も登録する')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'CLIPを作成して保存…' }))
    await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce())
    const options = vi.mocked(generateClipFile).mock.calls[0][0]
    expect(options.template).toBeUndefined()
    expect(options.plan.folders[0].cels).toHaveLength(1)
    expect(options.images).toEqual({}); expect(options.fit).toBe('expand')
    expect(saveBinaryFile).toHaveBeenCalledWith(new Uint8Array([1, 2]), expect.stringMatching(/\.clip$/), 'application/octet-stream', expect.objectContaining({ extensions: ['clip'] }))
  })
  it('shows exact cropping before generation and sends fixed canvas only when selected', async () => {
    vi.mocked(loadClipImages).mockResolvedValue({ one: { width: 1757, height: 1243, channels: 4, data: new Uint8Array() } })
    show(assigned); await ready()
    expect(screen.getByText(/出力サイズ：1754 × 1240 → 1757 × 1243px/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('キャンバスサイズを自動拡張'))
    expect(screen.getByText(/切り捨て：左1・右2・上1・下2px/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'CLIPを作成して保存…' }))
    await waitFor(() => expect(generateClipFile).toHaveBeenCalledOnce())
    expect(vi.mocked(generateClipFile).mock.calls[0][0].fit).toBe('crop')
  })
  it('blocks unavailable assigned images but allows an explicit image-free output', async () => {
    vi.mocked(loadClipImages).mockRejectedValue(new Error('素材を再接続してください'))
    show(assigned); await screen.findByRole('alert')
    expect((screen.getByRole('button', { name: 'CLIPを作成して保存…' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('画像も登録する')); await ready()
    fireEvent.click(screen.getByRole('button', { name: 'CLIPを作成して保存…' }))
    await waitFor(() => expect(generateClipFile).toHaveBeenCalledOnce())
    expect(vi.mocked(generateClipFile).mock.calls[0][0].images).toEqual({})
  })
  it('requires a template only in template mode and aborts generation on close', async () => {
    vi.mocked(generateClipFile).mockImplementation(() => new Promise(() => {}))
    const callbacks = show(); await ready()
    fireEvent.click(screen.getByRole('button', { name: 'テンプレートCLIPを使用' }))
    expect((screen.getByRole('button', { name: 'CLIPを作成して保存…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(inspectClipFile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '設定から新規作成' }))
    fireEvent.click(screen.getByRole('button', { name: 'CLIPを作成して保存…' }))
    await waitFor(() => expect(generateClipFile).toHaveBeenCalledOnce())
    const signal = vi.mocked(generateClipFile).mock.calls[0][2]!
    fireEvent.click(screen.getByRole('button', { name: '中止' }))
    expect(signal.aborted).toBe(true); expect(callbacks.onClose).toHaveBeenCalledOnce(); expect(saveBinaryFile).not.toHaveBeenCalled()
  })
  it('cannot silently reuse the previous template after its replacement fails to load', async () => {
    vi.mocked(inspectClipFile).mockResolvedValueOnce({ width: 32, height: 24, dpi: 150, basisWidth: 24, basisHeight: 16, offsetX: 0, offsetY: 0 })
      .mockRejectedValueOnce(new Error('CLIPを読み込めませんでした'))
    show(); await ready()
    fireEvent.click(screen.getByRole('button', { name: 'テンプレートCLIPを使用' }))
    const input = screen.getByLabelText('テンプレートCLIP')
    const file = (name: string) => Object.assign(new File([], name), { arrayBuffer: async () => new ArrayBuffer(4) })
    fireEvent.change(input, { target: { files: [file('first.clip')] } })
    await ready()
    expect(screen.getByText(/first.clip — 32 × 24px/)).toBeTruthy()
    fireEvent.change(input, { target: { files: [file('broken.clip')] } })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'CLIPを読み込めませんでした')
    expect((screen.getByRole('button', { name: 'CLIPを作成して保存…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(/first.clip/)).toBeNull()
    expect(screen.queryByText('テンプレートを確認しています…')).toBeNull()
    expect(generateClipFile).not.toHaveBeenCalled()
  })
})
