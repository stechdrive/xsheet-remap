import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DialogueAudioTimeline } from './DialogueAudioTimeline'
import { createDefaultDialogueAudioCutState } from './dialogueAudioProject'
import { decodeAudioDataUrl } from './dialogueAudioEngine'

vi.mock('./dialogueAudioEngine', async importOriginal => ({
  ...await importOriginal<object>(),
  decodeAudioDataUrl: vi.fn(async () => ({ samples: new Float32Array(48000).fill(0.25), sampleRate: 48000 })),
}))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('shares decoding and a lossless full buffer across split clips while preserving all playback offsets', async () => {
  const lengths: number[] = [], starts: unknown[][] = [], buffers: unknown[] = []
  class AudioContextProbe {
    destination = {}; currentTime = 0; state = 'running'
    async resume() {}
    async close() {}
    createBuffer(_channels: number, length: number, sampleRate: number) {
      lengths.push(length)
      const samples = new Float32Array(length)
      return { length, sampleRate, duration: length / sampleRate, getChannelData: () => samples }
    }
    createBufferSource() {
      return { buffer: null, connect() {}, disconnect() {}, stop() {}, start(...args: unknown[]) { starts.push(args); buffers.push(this.buffer) } }
    }
  }
  vi.stubGlobal('AudioContext', AudioContextProbe)
  const state = createDefaultDialogueAudioCutState(1, 24)
  state.assets = [{ assetId: 'shared', audioDataUrl: 'data:audio/wav;base64,AA==', durationFrames: 24, waveform: [] }]
  state.tracks[0].clips = [0, 1, 2].map(i => ({ clipId: `part-${i}`, placementId: 'source', assetId: 'shared',
    timelineStartFrame: i * 8 + 1, sourceOffsetFrames: i * 8, durationFrames: 8 }))
  render(<DialogueAudioTimeline cutState={state} fps={24} frameOrigin={1} cutDurationFrames={24}
    activeRevisionId="revision-1" soundCues={[]} selectedSoundCueId={null} onCutStateChange={vi.fn()}
    onPlayheadChange={vi.fn()} onSoundCueSelect={vi.fn()} onSoundCueEdit={vi.fn()} onSoundCueTransform={vi.fn()}
    onSoundCandidateEdit={vi.fn()} onAutoCreateDialogueRegions={current => current} />)
  fireEvent.click(screen.getByRole('button', { name: '音声タイムラインを開く' }))
  fireEvent.click(screen.getByRole('button', { name: '▶ 再生ヘッドから' }))
  await waitFor(() => expect(starts).toHaveLength(3))
  expect(decodeAudioDataUrl).toHaveBeenCalledTimes(1)
  expect(lengths).toEqual([48000])
  expect(new Set(buffers).size).toBe(1)
  expect((buffers[0] as AudioBuffer).getChannelData(0)).toEqual(new Float32Array(48000).fill(0.25))
  expect(starts).toEqual([[.05, 0, 8 / 24], [.05 + 8 / 24, 8 / 24, 8 / 24], [.05 + 16 / 24, 16 / 24, 8 / 24]])
})
