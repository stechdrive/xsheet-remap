import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { DialogueAudioTimeline } from './DialogueAudioTimeline'
import { createDefaultDialogueAudioCutState } from './dialogueAudioProject'
import { linkDialogueAudioCandidates } from './dialogueAudioBinding'

let restoreMediaDevices: (() => void) | undefined

afterEach(() => {
  cleanup()
  localStorage.clear()
  restoreMediaDevices?.()
  restoreMediaDevices = undefined
  vi.unstubAllGlobals()
})

describe('DialogueAudioTimeline', () => {
  it('shows three fixed tracks without the retired SOUND loop control', () => {
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
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateDialogueRegions={state => state}
    />)
    expect(screen.getByRole('region', { name: 'セリフ音声タイムライン' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '音声タイムラインを開く' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '▶ 再生ヘッドから' })).toBeNull()
    openAudioTimeline()
    expect(screen.getByRole('button', { name: '⏮ カット頭から' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '▶ 再生ヘッドから' })).toBeTruthy()
    expect(screen.getAllByLabelText(/を録音対象にする/)).toHaveLength(3)
    expect(screen.queryByLabelText('選択SOUNDをループ')).toBeNull()
    expect(screen.getByRole('separator', { name: '音声タイムラインの高さを変更' })).toBeTruthy()
    const zoomSlider = screen.getByRole('slider', { name: '音声タイムラインのズーム' })
    expect(zoomSlider.getAttribute('aria-valuetext')).toBe('全体表示')
    fireEvent.change(zoomSlider, { target: { value: '50' } })
    expect(zoomSlider.getAttribute('aria-valuetext')).toBe('拡大表示')
    expect(screen.queryByText(/px\/F/)).toBeNull()
    expect(screen.queryByText('範囲未選択')).toBeNull()
    expect(screen.queryByText(/紙 144F/)).toBeNull()
    expect(screen.queryByText(/音声尺 144F/)).toBeNull()
    expect(screen.getByRole('img', { name: 'タイムシート終端 5+24 / 144F' })).toBeTruthy()
    expect(screen.queryByRole('img', { name: /最終音声位置/ })).toBeNull()
    expect(document.querySelector('.dialogueAudioCueLane')).toBeNull()
    expect(screen.queryByText('A')).toBeNull()
  })

  it('shrinks from its top edge and leaves the track body scrollable', () => {
    render(<DialogueAudioTimeline
      cutState={createDefaultDialogueAudioCutState(1)}
      fps={24}
      frameOrigin={1}
      durationFrames={144}
      activeRevisionId="revision-1"
      soundCues={[]}
      selectedSoundCueId={null}
      onCutStateChange={vi.fn()}
      onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={vi.fn()}
      onSoundCueTransform={vi.fn()}
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateDialogueRegions={state => state}
    />)
    openAudioTimeline()
    const timeline = screen.getByRole('region', { name: 'セリフ音声タイムライン' })
    const resizeHandle = screen.getByRole('separator', { name: '音声タイムラインの高さを変更' })

    fireEvent.pointerDown(resizeHandle, { button: 0, clientY: 400 })
    fireEvent.pointerMove(window, { clientY: 1200 })
    fireEvent.pointerUp(window)

    expect(timeline.style.height).toBe('180px')
    expect(document.querySelector('.dialogueAudioScroller')).toBeTruthy()
    expect(document.querySelector('.dialogueAudioCueLane')).toBeNull()
  })

  it('uses the shared application Undo and Redo instead of a separate audio history', () => {
    const onUndo = vi.fn()
    const onRedo = vi.fn()
    render(<DialogueAudioTimeline
      cutState={createDefaultDialogueAudioCutState(1)}
      fps={24}
      frameOrigin={1}
      durationFrames={72}
      activeRevisionId="revision-1"
      soundCues={[]}
      selectedSoundCueId={null}
      onCutStateChange={vi.fn()}
      canUndo
      canRedo
      onUndo={onUndo}
      onRedo={onRedo}
      onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={vi.fn()}
      onSoundCueTransform={vi.fn()}
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateDialogueRegions={state => state}
    />)
    openAudioTimeline()

    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    fireEvent.click(screen.getByRole('button', { name: 'やり直す' }))

    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onRedo).toHaveBeenCalledTimes(1)
  })

  it('moves the audio playhead when a linked sheet SOUND is selected', async () => {
    const cue = { cueId: 'cue-1', role: 'sound' as const, laneId: 'sound-lane-1', frameStart: 25, frameEnd: 48, label: '主人公', text: '' }
    const state = createDefaultDialogueAudioCutState(1, 72)
    state.tracks[0].clips = [{
      clipId: 'clip-1',
      placementId: 'placement-1',
      assetId: 'asset-1',
      timelineStartFrame: 1,
      sourceOffsetFrames: 0,
      durationFrames: 72,
    }]
    state.tracks[0].speechCandidates = [{ candidateId: 'candidate-1', frameStart: 25, frameEnd: 48, status: 'pending' }]
    const linkedState = linkDialogueAudioCandidates(state, 'dialogue-1', ['candidate-1'], cue, 'revision-1')
    const onPlayheadChange = vi.fn()
    const commonProps = {
      fps: 24,
      frameOrigin: 1,
      durationFrames: 72,
      activeRevisionId: 'revision-1',
      soundCues: [cue],
      onCutStateChange: vi.fn(),
      onPlayheadChange,
      onSoundCueSelect: vi.fn(),
      onSoundCueEdit: vi.fn(),
      onSoundCueTransform: vi.fn(),
      onSoundCandidateEdit: vi.fn(),
      onAutoCreateDialogueRegions: (current: typeof state) => current,
    }
    const view = render(<DialogueAudioTimeline {...commonProps} cutState={state} selectedSoundCueId={null} />)

    view.rerender(<DialogueAudioTimeline {...commonProps} cutState={state} selectedSoundCueId="cue-1" />)
    expect(onPlayheadChange).not.toHaveBeenCalled()

    view.rerender(<DialogueAudioTimeline {...commonProps} cutState={linkedState} selectedSoundCueId="cue-1" />)
    await waitFor(() => expect(onPlayheadChange).toHaveBeenLastCalledWith(25))
  })

  it('uses the shared application tooltip foundation without native title attributes', async () => {
    const state = createDefaultDialogueAudioCutState(1, 96)
    state.timelineDurationFrames = 96
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
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateDialogueRegions={current => current}
    />)
    openAudioTimeline()

    const timeline = screen.getByRole('region', { name: 'セリフ音声タイムライン' })
    expect(timeline.querySelectorAll('[title]')).toHaveLength(0)
    expect(timeline.querySelector('.dialogueAudioPostCut')).toBeNull()
    expect(screen.queryByText('カット外')).toBeNull()
    const cutBoundary = screen.getByRole('img', { name: 'タイムシート終端 1+24 / 48F' })
    expect(cutBoundary).toBeTruthy()
    const audioBoundary = screen.getByRole('img', { name: '最終音声位置 0+24 / 24F' })
    expect(audioBoundary.parentElement?.getAttribute('style')).toContain('25%')
    fireEvent.pointerEnter(cutBoundary)
    expect((await screen.findByRole('tooltip')).textContent).toBe('タイムシート終端 1+24 / 48F')
    fireEvent.pointerLeave(cutBoundary)

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
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateDialogueRegions={state => state}
    />)
    openAudioTimeline()
    fireEvent.click(screen.getByLabelText('音声トラック2を録音対象にする'))
    expect(onCutStateChange.mock.calls[0][0].cutState.activeTrackId).toBe('dialogue-2')
    expect(onCutStateChange.mock.calls[0][0].recordHistory).toBe(false)
  })

  it('uses a compact name-free track rail with icon mute and contextual VAD settings', () => {
    const onCutStateChange = vi.fn()
    render(<DialogueAudioTimeline
      cutState={createDefaultDialogueAudioCutState(1)}
      fps={24}
      frameOrigin={1}
      durationFrames={72}
      activeRevisionId="revision-1"
      soundCues={[]}
      selectedSoundCueId={null}
      onCutStateChange={onCutStateChange}
      onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={vi.fn()}
      onSoundCueTransform={vi.fn()}
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateDialogueRegions={current => current}
    />)
    openAudioTimeline()

    const trackTarget = screen.getByRole('button', { name: '音声トラック1を録音対象にする' })
    expect(trackTarget.getAttribute('aria-pressed')).toBe('true')
    expect(trackTarget.textContent).toBe('')
    expect(trackTarget.querySelector('.dialogueAudioTrackColorBar')).toBeTruthy()
    expect(screen.queryByText('未リンクSOUND / トラック別ラベル')).toBeNull()
    expect(screen.queryByRole('button', { name: /ソロ/ })).toBeNull()

    const muteButton = screen.getByRole('button', { name: '音声トラック1をミュート' })
    expect(muteButton.textContent).toBe('')
    expect(muteButton.querySelector('svg')).toBeTruthy()
    fireEvent.click(muteButton)
    expect(onCutStateChange.mock.calls.at(-1)?.[0].cutState.tracks[0].muted).toBe(true)

    const firstTrackHeader = document.querySelector('.dialogueAudioTrackHeader') as HTMLDivElement
    fireEvent.contextMenu(firstTrackHeader, { clientX: 80, clientY: 120 })
    expect(screen.queryByLabelText('トラック名')).toBeNull()
    const vadMode = screen.getByLabelText('録音後の処理') as HTMLSelectElement
    expect([...vadMode.options].map(option => option.textContent)).toEqual([
      '検出しない',
      '発話区間を検出',
      'セリフ区間を自動作成',
    ])
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
      onSoundCandidateEdit={onSoundCandidateEdit}
      onAutoCreateDialogueRegions={state => state}
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
    }]
    state = linkDialogueAudioCandidates(
      state,
      'dialogue-1',
      ['candidate-1'],
      { cueId: 'cue-1', frameStart: 15, frameEnd: 20 },
      'revision-1',
    )
    const onCutStateChange = vi.fn()
    render(<DialogueAudioTimeline
      cutState={state}
      fps={24}
      frameOrigin={1}
      durationFrames={72}
      activeRevisionId="revision-1"
      soundCues={[{ cueId: 'cue-1', role: 'sound', laneId: 'sound_lane_1', frameStart: 15, frameEnd: 20, label: '主人公', text: '' }]}
      selectedSoundCueId={null}
      onCutStateChange={onCutStateChange}
      onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={vi.fn()}
      onSoundCueTransform={vi.fn()}
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateDialogueRegions={state => state}
    />)
    openAudioTimeline()
    fireEvent.click(screen.getByRole('button', { name: '+1F' }))
    expect(onCutStateChange).toHaveBeenCalledWith(expect.objectContaining({
      cueUpdates: [{ cueId: 'cue-1', frameStart: 16, frameEnd: 21 }],
      recordHistory: true,
    }))
  })

  it('uses the sheet counter and resets the ruler frame row at a template-defined 25 fps rate', () => {
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
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateDialogueRegions={state => state}
    />)
    openAudioTimeline()
    expect(screen.getAllByText('0+1 / 1F').length).toBeGreaterThan(0)
    expect(screen.getByText('1秒')).toBeTruthy()
    expect(Array.from(document.querySelectorAll('.dialogueAudioFrameTick')).slice(0, 26).map(tick => tick.textContent)).toEqual([
      ...Array.from({ length: 25 }, (_, index) => String(index + 1)),
      '1',
    ])
  })

  it('renders linked labels over their audio track without reserving a lane for audio-less SOUND', () => {
    let state = createDefaultDialogueAudioCutState(1)
    state.assets = [{ assetId: 'asset-1', audioDataUrl: 'data:audio/wav;base64,UklGRg==', durationFrames: 24, waveform: [] }]
    state.tracks[0].clips = [{ clipId: 'clip-1', placementId: 'placement-1', assetId: 'asset-1', timelineStartFrame: 1, sourceOffsetFrames: 0, durationFrames: 24 }]
    state.tracks[0].speechCandidates = [{ candidateId: 'vad-1', frameStart: 3, frameEnd: 8, status: 'pending' }]
    state = linkDialogueAudioCandidates(state, 'dialogue-1', ['vad-1'], { cueId: 'cue-1', frameStart: 2, frameEnd: 10 }, 'revision-1')
    const onSoundCueEdit = vi.fn()
    const onSoundCandidateEdit = vi.fn()
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
      onSoundCandidateEdit={onSoundCandidateEdit}
      onAutoCreateDialogueRegions={current => current}
    />)
    openAudioTimeline()
    expect(document.querySelector('.dialogueAudioTrackCueLayer .dialogueAudioCue.isTrackLayer')?.textContent).toContain('主人公')
    expect(document.querySelector('.dialogueAudioCueLane')).toBeNull()
    expect(screen.queryByText('音声なし')).toBeNull()
    const region = screen.getByLabelText('セリフ区間 3–8F 主人公へ割付済み')
    expect(region.classList.contains('dialogueAudioRegion')).toBe(true)
    fireEvent.doubleClick(region)
    expect(onSoundCandidateEdit).toHaveBeenCalledWith('dialogue-1', ['vad-1'], 3, 8, 'cue-1')
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
      onSoundCandidateEdit={onSoundCandidateEdit}
      onAutoCreateDialogueRegions={current => current}
    />)
    openAudioTimeline()
    fireEvent.pointerDown(screen.getByLabelText('発話候補 12–20F VAD'))
    fireEvent.pointerDown(screen.getByLabelText('発話候補 24–35F VAD'), { ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: '音響指示へ割付…' }))
    expect(onSoundCandidateEdit).toHaveBeenCalledWith('dialogue-1', ['vad-1', 'vad-2'], 12, 35)
  })

  it('keeps a wide VAD hit target while preserving the exact detected range visual', () => {
    const state = createDefaultDialogueAudioCutState(1, 2400)
    state.tracks[0].speechCandidates = [{ candidateId: 'one-frame', frameStart: 1200, frameEnd: 1200, status: 'pending' }]
    render(<DialogueAudioTimeline
      cutState={state}
      fps={24}
      frameOrigin={1}
      cutDurationFrames={2400}
      activeRevisionId="revision-1"
      soundCues={[]}
      selectedSoundCueId={null}
      onCutStateChange={vi.fn()}
      onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={vi.fn()}
      onSoundCueTransform={vi.fn()}
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateDialogueRegions={current => current}
    />)
    openAudioTimeline()

    const candidate = screen.getByLabelText('発話候補 1200–1200F VAD')
    expect(candidate.style.width).toBe('16px')
    expect(candidate.querySelector('.dialogueSpeechCandidateVisual')).toBeTruthy()
    expect(candidate.getAttribute('style')).toContain('--candidate-visual-width: 1px')
  })

  it('extends the editable workspace when a clip is dragged past its previous end', async () => {
    const initial = createDefaultDialogueAudioCutState(1, 48)
    initial.assets = [{
      assetId: 'asset-1',
      audioDataUrl: 'data:audio/wav;base64,UklGRg==',
      durationFrames: 12,
      waveform: [0.2, 0.4],
      sourceName: 'drag.wav',
    }]
    initial.tracks[0].clips = [{
      clipId: 'clip-1',
      placementId: 'clip-1',
      assetId: 'asset-1',
      timelineStartFrame: 1,
      sourceOffsetFrames: 0,
      durationFrames: 12,
    }]
    const onCutStateChange = vi.fn()

    function DragHarness() {
      const [state, setState] = useState(initial)
      return <DialogueAudioTimeline
        cutState={state}
        fps={24}
        frameOrigin={1}
        cutDurationFrames={48}
        activeRevisionId="revision-1"
        soundCues={[]}
        selectedSoundCueId={null}
        onCutStateChange={change => {
          onCutStateChange(change)
          setState(change.cutState)
        }}
        onPlayheadChange={vi.fn()}
        onSoundCueSelect={vi.fn()}
        onSoundCueEdit={vi.fn()}
        onSoundCueTransform={vi.fn()}
        onSoundCandidateEdit={vi.fn()}
        onAutoCreateDialogueRegions={current => current}
      />
    }

    render(<DragHarness />)
    openAudioTimeline()
    const clip = screen.getByRole('button', { name: '音声クリップ drag.wav' })
    Object.defineProperties(clip, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    })

    fireEvent.pointerDown(clip, { button: 0, pointerId: 9, clientX: 0 })
    fireEvent.pointerMove(clip, { pointerId: 9, clientX: 900 })
    fireEvent.pointerUp(clip, { pointerId: 9, clientX: 900 })

    await waitFor(() => {
      const next = onCutStateChange.mock.calls.at(-1)?.[0]
      expect(next?.cutState.tracks[0].clips[0].timelineStartFrame).toBe(61)
      expect(next?.cutState.timelineDurationFrames).toBe(72)
    })
    expect(screen.getByRole('img', { name: '最終音声位置 2+24 / 72F' })).toBeTruthy()
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
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateDialogueRegions={current => current}
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
    const onCutDurationChange = vi.fn()
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
        cutDurationFrames={12}
        activeRevisionId="revision-1"
        soundCues={[]}
        selectedSoundCueId={null}
        onCutStateChange={change => setState(change.cutState)}
        onCutDurationChange={onCutDurationChange}
        onPlayheadChange={vi.fn()}
        onSoundCueSelect={vi.fn()}
        onSoundCueEdit={vi.fn()}
        onSoundCueTransform={vi.fn()}
        onSoundCandidateEdit={vi.fn()}
        onAutoCreateDialogueRegions={current => current}
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
    expect(screen.getByRole('img', { name: 'タイムシート終端 0+12 / 12F' })).toBeTruthy()
    expect(screen.getByRole('img', { name: '最終音声位置 0+24 / 24F' })).toBeTruthy()
    expect(onCutDurationChange).not.toHaveBeenCalled()
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
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateDialogueRegions={current => current}
    />)
    openAudioTimeline()
    const track = document.querySelector('.dialogueAudioTrack') as HTMLDivElement
    fireEvent.contextMenu(track, { clientX: 80, clientY: 740 })
    const menu = screen.getByRole('menu', { name: '音声タイムラインの操作' })
    expect(menu.parentElement).toBe(document.body)
    expect(Number.parseFloat(menu.style.top)).toBeLessThan(740)
    fireEvent.click(screen.getByRole('button', { name: 'トラック高 大' }))
    expect((track.getAttribute('style') ?? '')).toContain('132px')
  })

  it('offers to extend the timesheet cut before reflecting a detected region beyond it', async () => {
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
        onSoundCandidateEdit={onSoundCandidateEdit}
        onAutoCreateDialogueRegions={current => current}
      />
    }
    render(<ExtensionHarness />)
    openAudioTimeline()
    fireEvent.doubleClick(screen.getByLabelText('発話候補 60–90F VAD'))
    expect(screen.getByRole('alertdialog', { name: '音響指示がカット尺を越えます' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'カット尺を延長して割り付け' }))
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
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateDialogueRegions={current => current}
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
