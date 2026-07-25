import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { DialogueAudioTimeline } from './DialogueAudioTimeline'
import { createDefaultDialogueAudioCutState } from './dialogueAudioProject'
import { linkDialogueAudioCandidates } from './dialogueAudioBinding'

let restoreMediaDevices: (() => void) | undefined

afterEach(() => {
  cleanup()
  restoreMediaDevices?.()
  restoreMediaDevices = undefined
  vi.unstubAllGlobals()
})

describe('DialogueAudioTimeline', () => {
  it('shows three tracks and keeps cut-head playback distinct from cue looping', () => {
    render(<DialogueAudioTimeline
      cutState={createDefaultDialogueAudioCutState(1)}
      fps={24}
      frameOrigin={1}
      durationFrames={144}
      activeRevisionId="revision_1"
      soundCues={[{ cueId: 'cue_1', role: 'sound', laneId: 'sound_lane_1', frameStart: 25, frameEnd: 48, label: 'A', text: '' }]}
      selectedSoundCueId="cue_1"
      onCutStateChange={vi.fn()}
      onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={vi.fn()}
      onSoundCueTransform={vi.fn()}
      onSoundCuesTransform={vi.fn()}
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateSoundCues={state => state}
    />)
    expect(screen.getByRole('region', { name: 'セリフ音声タイムライン' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '音声タイムラインを開く' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '▶ 再生ヘッドから' })).toBeNull()
    openAudioTimeline()
    expect(screen.getByRole('button', { name: '⏮ カット頭から' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '▶ 再生ヘッドから' })).toBeTruthy()
    expect(screen.getAllByLabelText(/を録音対象にする/)).toHaveLength(3)
    expect((screen.getByLabelText('選択SOUNDをループ') as HTMLInputElement).checked).toBe(false)
  })

  it('uses the shared application tooltip foundation without native title attributes', async () => {
    const state = createDefaultDialogueAudioCutState(1, 96)
    state.assets = [{
      assetId: 'asset-1',
      audioDataUrl: 'data:audio/wav;base64,UklGRg==',
      durationFrames: 24,
      waveform: [0.2, 0.4],
      sourceName: 'test.wav',
    }]
    state.tracks[0].clips = [{
      clipId: 'clip-1',
      placementId: 'placement-1',
      assetId: 'asset-1',
      timelineStartFrame: 1,
      sourceOffsetFrames: 0,
      durationFrames: 24,
    }]
    state.tracks[0].speechCandidates = [{ candidateId: 'vad-1', frameStart: 3, frameEnd: 8, status: 'pending' }]

    render(<DialogueAudioTimeline
      cutState={state}
      fps={24}
      frameOrigin={1}
      cutDurationFrames={48}
      activeRevisionId="revision-1"
      soundCues={[{ cueId: 'cue-1', role: 'sound', laneId: 'sound-lane-1', frameStart: 12, frameEnd: 18, label: '主人公', text: '' }]}
      selectedSoundCueId={null}
      onCutStateChange={vi.fn()}
      onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={vi.fn()}
      onSoundCueTransform={vi.fn()}
      onSoundCuesTransform={vi.fn()}
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateSoundCues={current => current}
    />)
    openAudioTimeline()

    const timeline = screen.getByRole('region', { name: 'セリフ音声タイムライン' })
    expect(timeline.querySelectorAll('[title]')).toHaveLength(0)

    const playButton = screen.getByRole('button', { name: '▶ 再生ヘッドから' })
    const tooltipTrigger = playButton.closest('.appTooltipTrigger')
    expect(tooltipTrigger).toBeTruthy()
    fireEvent.pointerEnter(tooltipTrigger!)
    expect((await screen.findByRole('tooltip')).textContent).toBe('再生。末尾では頭から再開')
  })

  it('selects the armed track without changing the SOUND selection', () => {
    const onCutStateChange = vi.fn()
    render(<DialogueAudioTimeline
      cutState={createDefaultDialogueAudioCutState(1)}
      fps={24}
      frameOrigin={1}
      durationFrames={72}
      activeRevisionId="revision_1"
      soundCues={[]}
      selectedSoundCueId={null}
      onCutStateChange={onCutStateChange}
      onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={vi.fn()}
      onSoundCueTransform={vi.fn()}
      onSoundCuesTransform={vi.fn()}
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateSoundCues={state => state}
    />)
    openAudioTimeline()
    fireEvent.click(screen.getByLabelText('セリフ 2を録音対象にする'))
    expect(onCutStateChange.mock.calls[0][0].activeTrackId).toBe('dialogue-2')
  })

  it('opens SOUND creation directly from a detected speech candidate', () => {
    const state = createDefaultDialogueAudioCutState(1)
    state.tracks[0].speechCandidates = [{ candidateId: 'candidate-1', frameStart: 12, frameEnd: 24, status: 'pending' }]
    const onSoundCandidateEdit = vi.fn()
    render(<DialogueAudioTimeline
      cutState={state}
      fps={24}
      frameOrigin={1}
      durationFrames={72}
      activeRevisionId="revision_1"
      soundCues={[]}
      selectedSoundCueId={null}
      onCutStateChange={vi.fn()}
      onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={vi.fn()}
      onSoundCueTransform={vi.fn()}
      onSoundCuesTransform={vi.fn()}
      onSoundCandidateEdit={onSoundCandidateEdit}
      onAutoCreateSoundCues={state => state}
    />)
    openAudioTimeline()
    fireEvent.doubleClick(screen.getByLabelText('発話候補 12–24F VAD'))
    expect(onSoundCandidateEdit).toHaveBeenCalledWith('dialogue-1', ['candidate-1'], 12, 24)
  })

  it('moves a linked SOUND cue with inserted track silence', () => {
    let state = createDefaultDialogueAudioCutState(1)
    state.assets = [{ assetId: 'asset-1', audioDataUrl: 'data:audio/wav;base64,UklGRg==', durationFrames: 48, waveform: [] }]
    state.tracks[0].clips = [{ clipId: 'clip-1', placementId: 'placement-1', assetId: 'asset-1', timelineStartFrame: 1, sourceOffsetFrames: 0, durationFrames: 48 }]
    state.tracks[0].speechCandidates = [{
      candidateId: 'candidate-1',
      frameStart: 15,
      frameEnd: 20,
      status: 'linked',
      cueLinks: [{ revisionId: 'revision-1', cueId: 'cue-1' }],
    }]
    state = linkDialogueAudioCandidates(
      state,
      'dialogue-1',
      ['candidate-1'],
      { cueId: 'cue-1', frameStart: 15, frameEnd: 20 },
      'revision-1',
    )
    const onSoundCuesTransform = vi.fn()
    render(<DialogueAudioTimeline
      cutState={state}
      fps={24}
      frameOrigin={1}
      durationFrames={72}
      activeRevisionId="revision-1"
      soundCues={[{ cueId: 'cue-1', role: 'sound', laneId: 'sound_lane_1', frameStart: 15, frameEnd: 20, label: '主人公', text: '' }]}
      selectedSoundCueId={null}
      onCutStateChange={vi.fn()}
      onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={vi.fn()}
      onSoundCueTransform={vi.fn()}
      onSoundCuesTransform={onSoundCuesTransform}
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateSoundCues={state => state}
    />)
    openAudioTimeline()
    fireEvent.click(screen.getByRole('button', { name: '+1F' }))
    expect(onSoundCuesTransform).toHaveBeenCalledWith([{ cueId: 'cue-1', frameStart: 16, frameEnd: 21 }])
  })

  it('uses the sheet 0+1 counter with a template-defined 25 fps rate', () => {
    render(<DialogueAudioTimeline
      cutState={createDefaultDialogueAudioCutState(1)}
      fps={25}
      frameOrigin={1}
      durationFrames={52}
      activeRevisionId="revision-1"
      soundCues={[]}
      selectedSoundCueId={null}
      onCutStateChange={vi.fn()}
      onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={vi.fn()}
      onSoundCueTransform={vi.fn()}
      onSoundCuesTransform={vi.fn()}
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateSoundCues={state => state}
    />)
    openAudioTimeline()
    expect(screen.getAllByText('0+1 / 1F').length).toBeGreaterThan(0)
    expect(screen.getByText('1+1 / 26F')).toBeTruthy()
  })

  it('renders linked labels over their audio track and keeps audio-less SOUND in the unlinked lane', () => {
    let state = createDefaultDialogueAudioCutState(1)
    state.assets = [{ assetId: 'asset-1', audioDataUrl: 'data:audio/wav;base64,UklGRg==', durationFrames: 24, waveform: [] }]
    state.tracks[0].clips = [{ clipId: 'clip-1', placementId: 'placement-1', assetId: 'asset-1', timelineStartFrame: 1, sourceOffsetFrames: 0, durationFrames: 24 }]
    state.tracks[0].speechCandidates = [{ candidateId: 'vad-1', frameStart: 3, frameEnd: 8, status: 'pending' }]
    state = linkDialogueAudioCandidates(state, 'dialogue-1', ['vad-1'], { cueId: 'cue-1', frameStart: 2, frameEnd: 10 }, 'revision-1')
    const onSoundCueEdit = vi.fn()
    render(<DialogueAudioTimeline
      cutState={state}
      fps={24}
      frameOrigin={1}
      durationFrames={48}
      activeRevisionId="revision-1"
      soundCues={[
        { cueId: 'cue-1', role: 'sound', laneId: 'sound_lane_1', frameStart: 2, frameEnd: 10, label: '主人公', text: '' },
        { cueId: 'cue-2', role: 'sound', laneId: 'sound_lane_1', frameStart: 20, frameEnd: 25, label: '音声なし', text: '' },
      ]}
      selectedSoundCueId={null}
      onCutStateChange={vi.fn()}
      onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={onSoundCueEdit}
      onSoundCueTransform={vi.fn()}
      onSoundCuesTransform={vi.fn()}
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateSoundCues={current => current}
    />)
    openAudioTimeline()
    expect(document.querySelector('.dialogueAudioTrackCueLayer .dialogueAudioCue.isTrackLayer')?.textContent).toContain('主人公')
    expect(document.querySelector('.dialogueAudioCueLane .dialogueAudioCue.isUnlinked')?.textContent).toContain('音声なし')
    fireEvent.doubleClick(screen.getByRole('button', { name: '主人公' }))
    expect(onSoundCueEdit).toHaveBeenCalledWith('cue-1')
  })

  it('groups multiple selected VAD regions into one SOUND creation request', () => {
    const state = createDefaultDialogueAudioCutState(1)
    state.tracks[0].speechCandidates = [
      { candidateId: 'vad-1', frameStart: 12, frameEnd: 20, status: 'pending' },
      { candidateId: 'vad-2', frameStart: 24, frameEnd: 35, status: 'pending' },
    ]
    const onSoundCandidateEdit = vi.fn()
    render(<DialogueAudioTimeline
      cutState={state}
      fps={24}
      frameOrigin={1}
      durationFrames={48}
      activeRevisionId="revision-1"
      soundCues={[]}
      selectedSoundCueId={null}
      onCutStateChange={vi.fn()}
      onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={vi.fn()}
      onSoundCueTransform={vi.fn()}
      onSoundCuesTransform={vi.fn()}
      onSoundCandidateEdit={onSoundCandidateEdit}
      onAutoCreateSoundCues={current => current}
    />)
    openAudioTimeline()
    fireEvent.pointerDown(screen.getByLabelText('発話候補 12–20F VAD'))
    fireEvent.pointerDown(screen.getByLabelText('発話候補 24–35F VAD'), { ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: '選択区間を紙シートへSOUND反映' }))
    expect(onSoundCandidateEdit).toHaveBeenCalledWith('dialogue-1', ['vad-1', 'vad-2'], 12, 35)
  })

  it('drags the playhead from the ruler and moves it one frame with focused arrow keys', () => {
    const onPlayheadChange = vi.fn()
    render(<DialogueAudioTimeline
      cutState={createDefaultDialogueAudioCutState(1)}
      fps={24}
      frameOrigin={1}
      durationFrames={72}
      activeRevisionId="revision-1"
      soundCues={[]}
      selectedSoundCueId={null}
      onCutStateChange={vi.fn()}
      onPlayheadChange={onPlayheadChange}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={vi.fn()}
      onSoundCueTransform={vi.fn()}
      onSoundCuesTransform={vi.fn()}
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateSoundCues={current => current}
    />)
    openAudioTimeline()
    const timeline = screen.getByRole('group', { name: '音声トラック編集領域' })
    const ruler = document.querySelector('.dialogueAudioRuler') as HTMLDivElement
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue(rectangle(0, 720))
    Object.defineProperties(ruler, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    })

    fireEvent.pointerDown(ruler, { button: 0, pointerId: 7, clientX: 0 })
    fireEvent.pointerMove(ruler, { pointerId: 7, clientX: 360 })
    fireEvent.pointerUp(ruler, { pointerId: 7, clientX: 360 })
    expect(onPlayheadChange).toHaveBeenLastCalledWith(37)
    expect(document.activeElement).toBe(timeline)

    fireEvent.keyDown(timeline, { key: 'ArrowLeft' })
    expect(onPlayheadChange).toHaveBeenLastCalledWith(36)
    fireEvent.keyDown(timeline, { key: 'ArrowRight' })
    expect(onPlayheadChange).toHaveBeenLastCalledWith(37)
  })

  it('shows a non-empty waveform immediately after microphone recording is committed', async () => {
    const mediaTrack = { stop: vi.fn() }
    const stream = { getTracks: () => [mediaTrack] } as unknown as MediaStream
    stubNavigatorMediaDevices({ getUserMedia: vi.fn(async () => stream) })
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    vi.stubGlobal('AudioContext', FakeAudioContext)

    function RecordingHarness() {
      const [state, setState] = useState(() => {
        const initial = createDefaultDialogueAudioCutState(1)
        initial.tracks[0].vadMode = 'off'
        return initial
      })
      return <DialogueAudioTimeline
        cutState={state}
        fps={24}
        frameOrigin={1}
        durationFrames={72}
        activeRevisionId="revision-1"
        soundCues={[]}
        selectedSoundCueId={null}
        onCutStateChange={setState}
        onPlayheadChange={vi.fn()}
        onSoundCueSelect={vi.fn()}
        onSoundCueEdit={vi.fn()}
        onSoundCueTransform={vi.fn()}
        onSoundCuesTransform={vi.fn()}
        onSoundCandidateEdit={vi.fn()}
        onAutoCreateSoundCues={current => current}
      />
    }

    render(<RecordingHarness />)
    openAudioTimeline()
    fireEvent.click(screen.getByRole('button', { name: '● 録音' }))
    await screen.findByRole('button', { name: '■ 録音終了' })
    fireEvent.click(screen.getByRole('button', { name: '■ 録音終了' }))

    await waitFor(() => {
      const waveform = document.querySelector('.dialogueWaveform path')
      expect(waveform?.getAttribute('d')?.length).toBeGreaterThan(20)
    })
    expect(screen.getByRole('button', { name: '音声クリップ マイク録音' })).toBeTruthy()
    expect(mediaTrack.stop).toHaveBeenCalled()
  })

  it('opens the timeline tool menu from right click and applies a track-height preset', () => {
    render(<DialogueAudioTimeline
      cutState={createDefaultDialogueAudioCutState(1, 72)}
      fps={24}
      frameOrigin={1}
      cutDurationFrames={72}
      activeRevisionId="revision-1"
      soundCues={[]}
      selectedSoundCueId={null}
      onCutStateChange={vi.fn()}
      onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={vi.fn()}
      onSoundCueTransform={vi.fn()}
      onSoundCuesTransform={vi.fn()}
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateSoundCues={current => current}
    />)
    openAudioTimeline()
    const track = document.querySelector('.dialogueAudioTrack') as HTMLDivElement
    fireEvent.contextMenu(track, { clientX: 80, clientY: 120 })
    expect(screen.getByRole('menu', { name: '音声タイムラインの操作' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'トラック高 大' }))
    expect((track.getAttribute('style') ?? '')).toContain('132px')
  })

  it('offers to extend the paper cut before reflecting a detected region beyond it', async () => {
    const state = createDefaultDialogueAudioCutState(1, 96)
    state.tracks[0].speechCandidates = [{ candidateId: 'long-line', frameStart: 60, frameEnd: 90, status: 'pending' }]
    const onCutDurationChange = vi.fn()
    const onSoundCandidateEdit = vi.fn()
    function ExtensionHarness() {
      const [cutDurationFrames, setCutDurationFrames] = useState(72)
      return <DialogueAudioTimeline
        cutState={state}
        fps={24}
        frameOrigin={1}
        cutDurationFrames={cutDurationFrames}
        activeRevisionId="revision-1"
        soundCues={[]}
        selectedSoundCueId={null}
        onCutStateChange={vi.fn()}
        onCutDurationChange={value => {
          onCutDurationChange(value)
          setCutDurationFrames(value)
        }}
        onPlayheadChange={vi.fn()}
        onSoundCueSelect={vi.fn()}
        onSoundCueEdit={vi.fn()}
        onSoundCueTransform={vi.fn()}
        onSoundCuesTransform={vi.fn()}
        onSoundCandidateEdit={onSoundCandidateEdit}
        onAutoCreateSoundCues={current => current}
      />
    }
    render(<ExtensionHarness />)
    openAudioTimeline()
    fireEvent.doubleClick(screen.getByLabelText('発話候補 60–90F VAD'))
    expect(screen.getByRole('alertdialog', { name: 'SOUND区間がカット尺を越えています' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'カット尺を延長して反映' }))
    expect(onCutDurationChange).toHaveBeenCalledWith(90)
    await waitFor(() => expect(onSoundCandidateEdit).toHaveBeenCalledWith('dialogue-1', ['long-line'], 60, 90))
  })

  it('restarts from the audio origin when Play is pressed at the end', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    const onPlayheadChange = vi.fn()
    render(<DialogueAudioTimeline
      cutState={createDefaultDialogueAudioCutState(1, 24)}
      fps={24}
      frameOrigin={1}
      cutDurationFrames={24}
      activeRevisionId="revision-1"
      soundCues={[]}
      selectedSoundCueId={null}
      onCutStateChange={vi.fn()}
      onPlayheadChange={onPlayheadChange}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={vi.fn()}
      onSoundCueTransform={vi.fn()}
      onSoundCuesTransform={vi.fn()}
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateSoundCues={current => current}
    />)
    openAudioTimeline()
    const timeline = screen.getByRole('group', { name: '音声トラック編集領域' })
    const ruler = document.querySelector('.dialogueAudioRuler') as HTMLDivElement
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue(rectangle(0, 720))
    Object.defineProperties(ruler, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    })
    fireEvent.pointerDown(ruler, { button: 0, pointerId: 8, clientX: 720 })
    fireEvent.pointerUp(ruler, { pointerId: 8, clientX: 720 })
    expect(onPlayheadChange).toHaveBeenLastCalledWith(24)
    fireEvent.click(screen.getByRole('button', { name: '▶ 再生ヘッドから' }))
    await waitFor(() => expect(onPlayheadChange).toHaveBeenLastCalledWith(1))
  })
})

function openAudioTimeline() {
  fireEvent.click(screen.getByRole('button', { name: '音声タイムラインを開く' }))
}

function rectangle(left: number, width: number): DOMRect {
  return {
    x: left,
    y: 0,
    left,
    right: left + width,
    top: 0,
    bottom: 249,
    width,
    height: 249,
    toJSON: () => ({}),
  }
}

function stubNavigatorMediaDevices(mediaDevices: Pick<MediaDevices, 'getUserMedia'>) {
  const hadOwnProperty = Object.prototype.hasOwnProperty.call(navigator, 'mediaDevices')
  const previous = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices })
  restoreMediaDevices = () => {
    if (hadOwnProperty && previous) Object.defineProperty(navigator, 'mediaDevices', previous)
    else Reflect.deleteProperty(navigator, 'mediaDevices')
  }
}

class FakeMediaRecorder {
  readonly mimeType = 'audio/webm'
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onstop: ((event: Event) => void) | null = null

  start() { /* recording is completed explicitly by the test */ }

  stop() {
    const data = new Blob([new Uint8Array([1, 2, 3, 4])], { type: this.mimeType })
    this.ondataavailable?.({ data } as BlobEvent)
    this.onstop?.(new Event('stop'))
  }
}

class FakeAudioContext {
  readonly destination = {} as AudioDestinationNode
  readonly currentTime = 0
  readonly state = 'running'

  async resume() { /* already running */ }
  async close() { /* nothing to release */ }

  async decodeAudioData() {
    const samples = Float32Array.from([0, 0.25, -0.8, 0.4, -0.2, 0.7, -0.5, 0])
    return {
      length: samples.length,
      numberOfChannels: 1,
      sampleRate: 8,
      getChannelData: () => samples,
    } as unknown as AudioBuffer
  }
}
