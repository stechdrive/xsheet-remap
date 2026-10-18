import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClipNode, createDefaultProject, ensureClipDocument } from '@xsheet-remap/core'
import { readClipAudioFile, type ClipAudioReadResult } from '@xsheet-remap/adapters'
import { ClipAudioImport } from './ClipAudioImport'
import { prepareClipAudio } from './clipAudioTransfer'

vi.mock('@xsheet-remap/adapters', async original => ({ ...await original<object>(), readClipAudioFile: vi.fn() }))
vi.mock('./clipAudioTransfer', async original => ({ ...await original<object>(), prepareClipAudio: vi.fn() }))
const data: ClipAudioReadResult = { fps: 24, clips: [{ objectId: 'object', assetId: 'wave', startFrame: 0, sourceOffsetFrames: 6, durationFrames: 24 }], assets: [] }
beforeEach(() => {
  vi.stubGlobal('AudioContext', class { close = vi.fn().mockResolvedValue(undefined) })
  vi.mocked(readClipAudioFile).mockResolvedValue(data)
  vi.mocked(prepareClipAudio).mockResolvedValue({ fps: 24, importId: 'copy', assets: [{ assetId: 'copy:wave', audioDataUrl: 'data:audio/wav;base64,AA==', durationFrames: 72, waveform: [], sourceName: '音声001' }],
    clips: [{ clipId: 'copy:0', placementId: 'copy:0', assetId: 'copy:wave', timelineStartFrame: 1, sourceOffsetFrames: 6, durationFrames: 24 }] })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })
function props() {
  const project = ensureClipDocument(createDefaultProject()), node = { ...createClipNode('音声001', 'audio', null), sourceLayerId: 10 }
  project.clipDocument = { ...project.clipDocument!, nodes: [...project.clipDocument!.nodes, node], source: { dataUrl: 'data:application/x-clip-studio;base64,AA==', fileName: 'source.clip', fileHash: 'a'.repeat(64) },
    timelineIds: { 'cut-main': 'timeline-one' }, sourceTimelines: [{ id: 'timeline-one', name: 'take1', fps: 24, startFrame: 0, endFrame: 144, tracks: [] }] }
  return { project, node, activeCutId: 'cut-main', revisionId: 'sheet-main', onChange: vi.fn() }
}
describe('CLIP audio import UI ownership', () => {
  it('explains unavailable audio decoding without reading or changing the document', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const input = props(); render(<ClipAudioImport {...input} />)
    fireEvent.click(screen.getByRole('button', { name: 'セリフ音声へ取り込む' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('この環境では音声をデコードできません'))
    expect(readClipAudioFile).not.toHaveBeenCalled(); expect(input.onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'セリフ音声へ取り込む' }).matches(':disabled')).toBe(false)
  })
  it('uses the selected timeline and destination, and commits audio and SOUND together', async () => {
    const input = props(); render(<ClipAudioImport {...input} />)
    fireEvent.change(screen.getByLabelText('音声の取り込み先'), { target: { value: 'dialogue-3' } })
    fireEvent.click(screen.getByRole('button', { name: 'セリフ音声へ取り込む' }))
    await waitFor(() => expect(input.onChange).toHaveBeenCalledTimes(1))
    expect(readClipAudioFile).toHaveBeenCalledWith(expect.any(Uint8Array), 10, 'timeline-one', expect.any(AbortSignal))
    const project = input.onChange.mock.calls[0][0]
    expect(project.extensions['xsheet-remap.dialogue-audio'].data.tracks[2].clips).toHaveLength(1)
    expect(project.timedRangeCues[0]).toMatchObject({ frameStart: 1, frameEnd: 24, label: '音声001' })
  })
  it('does not overwrite edits made while media decoding is pending', async () => {
    let finish!: (value: ClipAudioReadResult) => void
    vi.mocked(readClipAudioFile).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const input = props(), view = render(<ClipAudioImport {...input} />)
    fireEvent.click(screen.getByRole('button', { name: 'セリフ音声へ取り込む' }))
    view.rerender(<ClipAudioImport {...input} project={{ ...input.project, logicalSheet: { ...input.project.logicalSheet, durationFrames: 168 } }} />)
    await act(async () => { finish(data) })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('シートが変更'))
    expect(input.onChange).not.toHaveBeenCalled()
  })
  it('aborts when the selection or document unmounts', async () => {
    let finish!: (value: ClipAudioReadResult) => void
    vi.mocked(readClipAudioFile).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const input = props(), view = render(<ClipAudioImport {...input} />)
    fireEvent.click(screen.getByRole('button', { name: 'セリフ音声へ取り込む' }))
    const signal = vi.mocked(readClipAudioFile).mock.calls[0][3]!
    view.unmount(); expect(signal.aborted).toBe(true)
    await act(async () => { finish(data) })
    expect(input.onChange).not.toHaveBeenCalled(); expect(prepareClipAudio).not.toHaveBeenCalled()
  })
})
