import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { DialogueAudioTimeline } from './DialogueAudioTimeline'
import { createDefaultDialogueAudioCutState, type DialogueAudioCutState } from './dialogueAudioProject'
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
    expect(screen.getByRole('region', { name: 'セリフ音声タイムライン' }).style.height).toBe('288px')
    expect(Array.from(document.querySelectorAll<HTMLElement>('.dialogueAudioTrack')).map(track => track.style.height)).toEqual([
      '60px',
      '60px',
      '60px',
    ])
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
    expect(screen.getByRole('region', { name: 'セリフ音声タイムライン' }).dataset).toMatchObject({
      frameOrigin: '1',
      cutDurationFrames: '144',
      timelineDurationFrames: '144',
      audioContentEndFrame: '',
      activeTrackId: 'dialogue-1',
    })
  })

  it('uses the App Shell audio selection as a controlled workspace selection', () => {
    const state = createDefaultDialogueAudioCutState(1)
    state.tracks[0].speechCandidates = [{
      candidateId: 'candidate-1',
      frameStart: 10,
      frameEnd: 12,
      status: 'pending',
    }]
    const onAudioSelectionChange = vi.fn()
    const onWorkspaceFocus = vi.fn()
    render(<DialogueAudioTimeline
      cutState={state}
      audioSelection={{
        entities: [{ kind: 'candidate', trackId: 'dialogue-1', id: 'candidate-1' }],
        timeRange: null,
      }}
      fps={24}
      frameOrigin={1}
      durationFrames={144}
      activeRevisionId="revision-1"
      soundCues={[]}
      selectedSoundCueId={null}
      onCutStateChange={vi.fn()}
      onAudioSelectionChange={onAudioSelectionChange}
      onWorkspaceFocus={onWorkspaceFocus}
      onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={vi.fn()}
      onSoundCueTransform={vi.fn()}
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateDialogueRegions={current => current}
    />)

    fireEvent.pointerDown(screen.getByRole('region', { name: 'セリフ音声タイムライン' }))
    expect(onWorkspaceFocus).toHaveBeenCalledTimes(1)
    openAudioTimeline()
    expect(screen.getByText('セリフ区間1個 / 10–12F')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('セリフ区間候補 10–12F'))
    expect(onAudioSelectionChange).toHaveBeenCalledWith({
      entities: [{ kind: 'candidate', trackId: 'dialogue-1', id: 'candidate-1' }],
      timeRange: null,
    })
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

  it('navigates once when a linked sheet SOUND emits a navigation request without taking audio edit selection', async () => {
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
    const view = render(<DialogueAudioTimeline
      {...commonProps}
      cutState={state}
      selectedSoundCueId="cue-1"
      soundCueNavigationRequest={{ requestId: 1, cueId: 'cue-1' }}
    />)
    expect(onPlayheadChange).not.toHaveBeenCalled()

    view.rerender(<DialogueAudioTimeline
      {...commonProps}
      cutState={linkedState}
      selectedSoundCueId="cue-1"
      soundCueNavigationRequest={{ requestId: 1, cueId: 'cue-1' }}
    />)
    await waitFor(() => expect(onPlayheadChange).toHaveBeenLastCalledWith(25))
    expect(onPlayheadChange).toHaveBeenCalledTimes(1)

    openAudioTimeline()
    const linkedRegion = document.querySelector('[data-region-id]') as HTMLElement
    expect(linkedRegion.classList.contains('isLinkedHighlight')).toBe(true)
    expect(linkedRegion.classList.contains('isSelected')).toBe(false)

    view.rerender(<DialogueAudioTimeline
      {...commonProps}
      cutState={{ ...linkedState }}
      selectedSoundCueId="cue-1"
      soundCueNavigationRequest={{ requestId: 1, cueId: 'cue-1' }}
    />)
    await waitFor(() => expect(onPlayheadChange).toHaveBeenCalledTimes(1))
  })

  it('keeps the armed recording track independent from a linked sheet SOUND selection', async () => {
    const cue = { cueId: 'cue-1', role: 'sound' as const, laneId: 'sound-lane-1', frameStart: 25, frameEnd: 48, label: '主人公', text: '' }
    const initialState = createDefaultDialogueAudioCutState(1, 72)
    initialState.tracks[0].clips = [{
      clipId: 'clip-1',
      placementId: 'placement-1',
      assetId: 'asset-1',
      timelineStartFrame: 1,
      sourceOffsetFrames: 0,
      durationFrames: 72,
    }]
    initialState.tracks[0].speechCandidates = [{ candidateId: 'candidate-1', frameStart: 25, frameEnd: 48, status: 'pending' }]
    const linkedState = linkDialogueAudioCandidates(initialState, 'dialogue-1', ['candidate-1'], cue, 'revision-1')
    const onPlayheadChange = vi.fn()

    function ControlledTimeline() {
      const [state, setState] = useState(linkedState)
      return <DialogueAudioTimeline
        cutState={state}
        fps={24}
        frameOrigin={1}
        durationFrames={72}
        activeRevisionId="revision-1"
        soundCues={[cue]}
        selectedSoundCueId="cue-1"
        soundCueNavigationRequest={{ requestId: 1, cueId: 'cue-1' }}
        onCutStateChange={change => setState(change.cutState)}
        onPlayheadChange={onPlayheadChange}
        onSoundCueSelect={vi.fn()}
        onSoundCueEdit={vi.fn()}
        onSoundCueTransform={vi.fn()}
        onSoundCandidateEdit={vi.fn()}
        onAutoCreateDialogueRegions={current => current}
      />
    }

    render(<ControlledTimeline />)
    openAudioTimeline()
    await waitFor(() => expect(onPlayheadChange).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByLabelText('音声トラック2を録音対象にする'))
    await waitFor(() => expect(screen.getByLabelText('音声トラック2を録音対象にする').getAttribute('aria-pressed')).toBe('true'))
    expect(onPlayheadChange).toHaveBeenCalledTimes(1)
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
    expect(screen.queryByLabelText('録音VAD環境')).toBeNull()
    expect(screen.queryByText('このトラックをミュート')).toBeNull()
  })

  it('keeps global VAD settings in the gear menu instead of edit context menus', () => {
    render(<DialogueAudioTimeline
      cutState={createDefaultDialogueAudioCutState(1)}
      fps={24}
      frameOrigin={1}
      durationFrames={72}
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

    fireEvent.click(screen.getByLabelText('音声タイムライン設定'))
    expect(screen.getByLabelText('録音VAD環境')).toBeTruthy()
    expect(screen.getByLabelText('検出感度')).toBeTruthy()
    expect(screen.getByLabelText('途切れにくさ')).toBeTruthy()
    expect(screen.queryByText('コピー　Ctrl+C')).toBeNull()
    expect(screen.queryByText('トラックをクリア')).toBeNull()
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
    fireEvent.doubleClick(screen.getByLabelText('セリフ区間候補 12–24F'))
    expect(onSoundCandidateEdit).toHaveBeenCalledWith('dialogue-1', ['candidate-1'], 12, 24)
  })

  it('opens only candidate operations when a VAD candidate is right-clicked', () => {
    const state = createDefaultDialogueAudioCutState(1)
    state.tracks[0].speechCandidates = [{ candidateId: 'candidate-1', frameStart: 12, frameEnd: 24, status: 'pending' }]
    render(<DialogueAudioTimeline
      cutState={state}
      fps={24}
      frameOrigin={1}
      durationFrames={72}
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

    fireEvent.contextMenu(screen.getByLabelText('セリフ区間候補 12–24F'), { clientX: 100, clientY: 220 })
    expect(screen.getByRole('menu', { name: 'セリフ区間 1個の操作' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'SOUNDへ割り付け…' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'セリフ区間を無視' })).toBeTruthy()
    expect(screen.queryByText('トラックをクリア')).toBeNull()
    expect(screen.queryByText('録音VAD環境')).toBeNull()
  })

  it('uses the right-clicked candidate instead of a stale prior selection', () => {
    const state = createDefaultDialogueAudioCutState(1)
    state.tracks[0].speechCandidates = [
      { candidateId: 'candidate-1', frameStart: 12, frameEnd: 18, status: 'pending' },
      { candidateId: 'candidate-2', frameStart: 30, frameEnd: 36, status: 'pending' },
    ]
    const onSoundCandidateEdit = vi.fn()
    render(<DialogueAudioTimeline
      cutState={state}
      fps={24}
      frameOrigin={1}
      durationFrames={72}
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

    fireEvent.click(screen.getByLabelText('セリフ区間候補 12–18F'))
    fireEvent.contextMenu(screen.getByLabelText('セリフ区間候補 30–36F'), { clientX: 200, clientY: 220 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'SOUNDへ割り付け…' }))
    expect(onSoundCandidateEdit).toHaveBeenCalledWith('dialogue-1', ['candidate-2'], 30, 36)
  })

  it('keeps a dialogue segment in control of its complete pointer sequence', () => {
    const state = createDefaultDialogueAudioCutState(1)
    state.tracks[0].speechCandidates = [{ candidateId: 'candidate-1', frameStart: 12, frameEnd: 24, status: 'pending' }]
    const onSoundCandidateEdit = vi.fn()
    render(<DialogueAudioTimeline
      cutState={state}
      fps={24}
      frameOrigin={1}
      durationFrames={72}
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

    const candidate = screen.getByLabelText('セリフ区間候補 12–24F')
    expect(candidate.dataset).toMatchObject({
      segmentKind: 'candidate',
      trackId: 'dialogue-1',
      segmentId: 'candidate-1',
      frameStart: '12',
      frameEnd: '24',
      linked: 'false',
    })
    fireEvent.pointerDown(candidate, { button: 0, pointerId: 4, clientX: 100 })
    fireEvent.pointerUp(candidate, { pointerId: 4, clientX: 100 })
    fireEvent.click(candidate)
    expect(candidate.classList.contains('isSelected')).toBe(true)
    expect(screen.getByText('セリフ区間1個 / 12–24F')).toBeTruthy()
    expect(document.querySelector('.dialogueAudioSelection')).toBeNull()

    fireEvent.doubleClick(candidate)
    expect(onSoundCandidateEdit).toHaveBeenCalledWith('dialogue-1', ['candidate-1'], 12, 24)
    fireEvent.contextMenu(candidate, { clientX: 160, clientY: 220 })
    expect(screen.getByRole('menu', { name: 'セリフ区間 1個の操作' })).toBeTruthy()
  })

  it('creates a time range only after dragging with the range tool', () => {
    const state = createDefaultDialogueAudioCutState(1)
    state.tracks[0].speechCandidates = [{ candidateId: 'candidate-1', frameStart: 12, frameEnd: 24, status: 'pending' }]
    render(<DialogueAudioTimeline
      cutState={state}
      fps={24}
      frameOrigin={1}
      durationFrames={72}
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

    const timeline = screen.getByRole('group', { name: '音声トラック編集領域' })
    const lane = document.querySelector('.dialogueAudioWaveformLane') as HTMLDivElement
    const candidate = screen.getByLabelText('セリフ区間候補 12–24F')
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue(rectangle(0, 720))
    Object.defineProperties(lane, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    })

    fireEvent.click(screen.getByRole('button', { name: '時間範囲選択ツール' }))
    fireEvent.pointerDown(lane, { button: 0, pointerId: 4, clientX: 100, clientY: 50 })
    fireEvent.pointerUp(lane, { pointerId: 4, clientX: 100, clientY: 50 })
    expect(document.querySelector('.dialogueAudioSelection')).toBeNull()

    fireEvent.pointerDown(candidate, { button: 0, pointerId: 5, clientX: 100, clientY: 50 })
    fireEvent.pointerMove(lane, { pointerId: 5, clientX: 300, clientY: 50 })
    fireEvent.pointerUp(lane, { pointerId: 5, clientX: 300, clientY: 50 })
    fireEvent.contextMenu(candidate, { clientX: 160, clientY: 220 })

    expect(screen.getByRole('menu', { name: '選択範囲 11–31Fの操作' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'コピー　Ctrl+C' })).toBeTruthy()
  })

  it('leaves a select-tool touch swipe to native timeline scrolling and reveals touch-only actions', () => {
    const onAudioSelectionChange = vi.fn()
    const onPlayheadChange = vi.fn()
    render(<DialogueAudioTimeline
      cutState={createDefaultDialogueAudioCutState(1)}
      audioSelection={{ entities: [], timeRange: null }}
      fps={24}
      frameOrigin={1}
      durationFrames={72}
      activeRevisionId="revision-1"
      soundCues={[]}
      selectedSoundCueId={null}
      onCutStateChange={vi.fn()}
      onAudioSelectionChange={onAudioSelectionChange}
      onPlayheadChange={onPlayheadChange}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={vi.fn()}
      onSoundCueTransform={vi.fn()}
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateDialogueRegions={current => current}
    />)
    openAudioTimeline()

    const timeline = screen.getByRole('group', { name: '音声トラック編集領域' })
    const lane = document.querySelector('.dialogueAudioWaveformLane') as HTMLDivElement
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue(rectangle(0, 720))
    onPlayheadChange.mockClear()

    const down = createEvent.pointerDown(lane, {
      button: 0,
      buttons: 1,
      pointerId: 41,
      pointerType: 'touch',
      clientX: 300,
      clientY: 50,
      cancelable: true,
    })
    fireEvent(lane, down)
    const move = createEvent.pointerMove(lane, {
      buttons: 1,
      pointerId: 41,
      pointerType: 'touch',
      clientX: 260,
      clientY: 50,
      cancelable: true,
    })
    fireEvent(lane, move)
    fireEvent.pointerUp(lane, {
      button: 0,
      pointerId: 41,
      pointerType: 'touch',
      clientX: 260,
      clientY: 50,
    })

    expect(down.defaultPrevented).toBe(false)
    expect(move.defaultPrevented).toBe(false)
    expect(onPlayheadChange).not.toHaveBeenCalled()
    expect(onAudioSelectionChange).not.toHaveBeenCalled()
    expect(document.querySelector('.dialogueAudioSelection')).toBeNull()
    expect(screen.getByRole('button', { name: '項目を追加選択' })).toBeTruthy()
    expect((screen.getByRole('button', { name: '選択中の音声操作メニュー' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('moves only the playhead when an empty track position is clicked', () => {
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
    const lane = document.querySelector('.dialogueAudioWaveformLane') as HTMLDivElement
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue(rectangle(0, 720))
    Object.defineProperties(lane, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    })
    onPlayheadChange.mockClear()

    fireEvent.pointerDown(lane, { button: 0, pointerId: 8, clientX: 360, clientY: 50 })
    fireEvent.pointerUp(lane, { pointerId: 8, clientX: 360, clientY: 50 })

    expect(onPlayheadChange).toHaveBeenLastCalledWith(37)
    expect(document.querySelector('.dialogueAudioSelection')).toBeNull()
    expect((screen.getByRole('button', { name: '音響指示へ割付…' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('marquee-selects every timeline object intersecting the dragged rectangle', () => {
    const state = createDefaultDialogueAudioCutState(1)
    state.assets = [{
      assetId: 'asset-1',
      audioDataUrl: 'data:audio/wav;base64,UklGRg==',
      durationFrames: 4,
      waveform: [0.1, 0.2],
      sourceName: 'line.wav',
    }]
    state.tracks[0].clips = [{
      clipId: 'clip-1',
      placementId: 'clip-1',
      assetId: 'asset-1',
      timelineStartFrame: 15,
      sourceOffsetFrames: 0,
      durationFrames: 4,
    }]
    state.tracks[0].speechCandidates = [{
      candidateId: 'candidate-1',
      frameStart: 12,
      frameEnd: 24,
      status: 'pending',
    }]
    render(<DialogueAudioTimeline
      cutState={state}
      fps={24}
      frameOrigin={1}
      durationFrames={72}
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

    const timeline = screen.getByRole('group', { name: '音声トラック編集領域' })
    const lane = document.querySelector('.dialogueAudioWaveformLane') as HTMLDivElement
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue(rectangle(0, 720))
    Object.defineProperties(lane, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    })

    fireEvent.pointerDown(lane, { button: 0, pointerId: 6, clientX: 100, clientY: 50 })
    fireEvent.pointerMove(lane, { pointerId: 6, clientX: 300, clientY: 80 })
    fireEvent.pointerUp(lane, { pointerId: 6, clientX: 300, clientY: 80 })

    expect(screen.getByLabelText('音声クリップ line.wav').classList.contains('isSelected')).toBe(true)
    expect(screen.getByLabelText('セリフ区間候補 12–24F').classList.contains('isSelected')).toBe(true)
    expect(screen.getByText('1クリップ・セリフ区間1個 / 12–24F')).toBeTruthy()
  })

  it('keeps the playhead line from intercepting timeline pointer targets', () => {
    render(<DialogueAudioTimeline
      cutState={createDefaultDialogueAudioCutState(1)}
      fps={24}
      frameOrigin={1}
      durationFrames={72}
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
    const playhead = screen.getByRole('slider', { name: '音声再生ヘッド' })
    expect(playhead.style.pointerEvents).toBe('none')
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

  it('renders one editable linked segment and does not duplicate its VAD candidate or sheet cue', () => {
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
    expect(document.querySelector('.dialogueAudioTrackCueLayer')).toBeNull()
    expect(document.querySelector('.dialogueAudioCueLane')).toBeNull()
    expect(screen.queryByText('音声なし')).toBeNull()
    const region = screen.getByLabelText('セリフ区間 3–8F 主人公へ割付済み')
    expect(region.classList.contains('dialogueSpeechSegment')).toBe(true)
    expect(region.textContent).toBe('主人公')
    expect(screen.queryByLabelText('セリフ区間候補 3–8F')).toBeNull()
    fireEvent.doubleClick(region)
    expect(onSoundCandidateEdit).toHaveBeenCalledWith('dialogue-1', ['vad-1'], 3, 8, 'cue-1')
    expect(onSoundCueEdit).not.toHaveBeenCalled()
  })

  it('keeps a linked segment text-free when the sheet cue label is blank', () => {
    let state = createDefaultDialogueAudioCutState(1)
    state.assets = [{ assetId: 'asset-1', audioDataUrl: 'data:audio/wav;base64,UklGRg==', durationFrames: 24, waveform: [] }]
    state.tracks[0].clips = [{ clipId: 'clip-1', placementId: 'placement-1', assetId: 'asset-1', timelineStartFrame: 1, sourceOffsetFrames: 0, durationFrames: 24 }]
    state.tracks[0].speechCandidates = [{ candidateId: 'vad-1', frameStart: 3, frameEnd: 8, status: 'pending' }]
    state = linkDialogueAudioCandidates(state, 'dialogue-1', ['vad-1'], { cueId: 'cue-1', frameStart: 3, frameEnd: 8 }, 'revision-1')
    render(<DialogueAudioTimeline
      cutState={state}
      fps={24}
      frameOrigin={1}
      cutDurationFrames={48}
      activeRevisionId="revision-1"
      soundCues={[{ cueId: 'cue-1', role: 'sound', laneId: 'sound_lane_1', frameStart: 3, frameEnd: 8, label: '', text: '表示しない本文' }]}
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

    const region = screen.getByLabelText('セリフ区間 3–8F 名称なしへ割付済み')
    expect(region.textContent).toBe('')
    expect(region.classList.contains('is-linked')).toBe(true)
    expect(screen.queryByText('表示しない本文')).toBeNull()
  })

  it('resizes a linked speech segment from its edge and emits one synchronized SOUND update', () => {
    let state = createDefaultDialogueAudioCutState(1)
    state.assets = [{ assetId: 'asset-1', audioDataUrl: 'data:audio/wav;base64,UklGRg==', durationFrames: 24, waveform: [] }]
    state.tracks[0].clips = [{ clipId: 'clip-1', placementId: 'placement-1', assetId: 'asset-1', timelineStartFrame: 1, sourceOffsetFrames: 0, durationFrames: 24 }]
    state.tracks[0].speechCandidates = [{ candidateId: 'vad-1', frameStart: 3, frameEnd: 8, status: 'pending' }]
    const cue = { cueId: 'cue-1', role: 'sound' as const, laneId: 'sound_lane_1', frameStart: 3, frameEnd: 8, label: '主人公', text: '' }
    state = linkDialogueAudioCandidates(state, 'dialogue-1', ['vad-1'], cue, 'revision-1')
    const onCutStateChange = vi.fn()
    render(<DialogueAudioTimeline
      cutState={state}
      fps={24}
      frameOrigin={1}
      cutDurationFrames={48}
      activeRevisionId="revision-1"
      soundCues={[cue]}
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

    const region = screen.getByLabelText('セリフ区間 3–8F 主人公へ割付済み')
    const endHandle = region.querySelector('.dialogueSpeechSegmentHandle.isEnd') as HTMLElement
    fireEvent.pointerDown(endHandle, { button: 0, pointerId: 31, clientX: 120 })
    fireEvent.pointerMove(region, { pointerId: 31, clientX: 150 })
    fireEvent.pointerUp(region, { pointerId: 31, clientX: 150 })

    expect(onCutStateChange).toHaveBeenCalledTimes(1)
    const committed = onCutStateChange.mock.calls[0][0]
    expect(committed.cutState.tracks[0].dialogueRegions[0]).toMatchObject({
      frameStart: 3,
      frameEnd: 10,
      tailPaddingFrames: 2,
    })
    expect(committed.cutState.tracks[0].clips).toEqual(state.tracks[0].clips)
    expect(committed.cueUpdates).toEqual([{ cueId: 'cue-1', frameStart: 3, frameEnd: 10 }])
  })

  it('commits a candidate edge drag after its preview replaces the captured button', () => {
    const state = createDefaultDialogueAudioCutState(1)
    state.tracks[0].speechCandidates = [{ candidateId: 'vad-1', frameStart: 3, frameEnd: 8, status: 'pending' }]
    const onCutStateChange = vi.fn()
    render(<DialogueAudioTimeline
      cutState={state}
      fps={24}
      frameOrigin={1}
      cutDurationFrames={48}
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

    const candidate = screen.getByLabelText('セリフ区間候補 3–8F')
    const endHandle = candidate.querySelector('.dialogueSpeechSegmentHandle.isEnd') as HTMLElement
    fireEvent.pointerDown(endHandle, { button: 0, pointerId: 32, clientX: 120 })
    fireEvent.pointerMove(candidate, { pointerId: 32, clientX: 140, buttons: 1 })
    expect(screen.queryByLabelText('セリフ区間候補 3–8F')).toBeNull()

    fireEvent.pointerUp(window, { pointerId: 32, clientX: 150 })
    expect(onCutStateChange).toHaveBeenCalledTimes(1)
    expect(onCutStateChange.mock.calls[0][0].cutState.tracks[0].dialogueRegions[0]).toMatchObject({
      frameStart: 3,
      frameEnd: 10,
    })

    fireEvent.pointerMove(window, { pointerId: 32, clientX: 180, buttons: 0 })
    expect(onCutStateChange).toHaveBeenCalledTimes(1)
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
    fireEvent.click(screen.getByLabelText('セリフ区間候補 12–20F'))
    fireEvent.click(screen.getByLabelText('セリフ区間候補 24–35F'), { ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: '音響指示へ割付…' }))
    expect(onSoundCandidateEdit).toHaveBeenCalledWith('dialogue-1', ['vad-1', 'vad-2'], 12, 35)
  })

  it('adds selected retake candidates to the selected SOUND without moving either range', () => {
    const state = createDefaultDialogueAudioCutState(1)
    state.assets = [{
      assetId: 'asset-1',
      audioDataUrl: 'data:audio/wav;base64,UklGRg==',
      durationFrames: 48,
      waveform: [],
    }]
    state.tracks[0].clips = [{
      clipId: 'clip-1',
      placementId: 'placement-1',
      assetId: 'asset-1',
      timelineStartFrame: 1,
      sourceOffsetFrames: 0,
      durationFrames: 48,
    }]
    state.tracks[0].speechCandidates = [
      { candidateId: 'base', frameStart: 8, frameEnd: 16, status: 'pending' },
      { candidateId: 'retake', frameStart: 28, frameEnd: 34, status: 'pending' },
    ]
    const cue = {
      cueId: 'cue-1',
      role: 'sound' as const,
      laneId: 'sound_lane_1',
      frameStart: 6,
      frameEnd: 38,
      label: '主人公',
      text: '',
    }
    const withBase = linkDialogueAudioCandidates(state, 'dialogue-1', ['base'], cue, 'revision-1')
    const onCutStateChange = vi.fn()
    render(<DialogueAudioTimeline
      cutState={withBase}
      fps={24}
      frameOrigin={1}
      durationFrames={48}
      activeRevisionId="revision-1"
      soundCues={[cue]}
      selectedSoundCueId={cue.cueId}
      onCutStateChange={onCutStateChange}
      onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()}
      onSoundCueEdit={vi.fn()}
      onSoundCueTransform={vi.fn()}
      onSoundCandidateEdit={vi.fn()}
      onAutoCreateDialogueRegions={current => current}
    />)
    openAudioTimeline()

    fireEvent.click(screen.getByLabelText('セリフ区間候補 28–34F'))
    fireEvent.click(screen.getByRole('button', { name: '選択中のSOUNDへ追加' }))

    expect(onCutStateChange).toHaveBeenCalledTimes(1)
    const committed = onCutStateChange.mock.calls[0][0].cutState as DialogueAudioCutState
    expect(committed.soundBindings[0].members.map(member => member.regionRef)).toEqual([
      { trackId: 'dialogue-1', regionId: 'dialogue-region' },
      { trackId: 'dialogue-1', regionId: 'dialogue-region-2' },
    ])
    expect(committed.tracks[0].dialogueRegions.map(region => [region.frameStart, region.frameEnd])).toEqual([
      [8, 16],
      [28, 34],
    ])
    expect(committed.soundBindings[0]).toMatchObject({
      headPaddingFrames: 2,
      tailPaddingFrames: 4,
    })
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

    const candidate = screen.getByLabelText('セリフ区間候補 1200–1200F')
    expect(candidate.style.width).toBe('16px')
    expect(candidate.querySelector('.dialogueSpeechSegmentVisual')).toBeTruthy()
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

  it('previews the unified linked segment while a clip handle is moving', async () => {
    const cue = { cueId: 'cue-1', role: 'sound' as const, laneId: 'sound-1', frameStart: 3, frameEnd: 6, label: '主人公', text: '' }
    const source = createDefaultDialogueAudioCutState(1, 48)
    source.assets = [{
      assetId: 'asset-1',
      audioDataUrl: 'data:audio/wav;base64,UklGRg==',
      durationFrames: 12,
      waveform: [0.2, 0.4],
      sourceName: 'linked.wav',
    }]
    source.tracks[0].clips = [{
      clipId: 'clip-1',
      placementId: 'placement-1',
      assetId: 'asset-1',
      timelineStartFrame: 1,
      sourceOffsetFrames: 0,
      durationFrames: 12,
    }]
    source.tracks[0].speechCandidates = [{
      candidateId: 'candidate-1',
      frameStart: 3,
      frameEnd: 6,
      status: 'pending',
      source: {
        placementId: 'placement-1',
        assetId: 'asset-1',
        sourceFrameStart: 2,
        sourceFrameEnd: 5,
      },
    }]
    const initial = linkDialogueAudioCandidates(source, 'dialogue-1', ['candidate-1'], cue, 'revision-1')
    const onCutStateChange = vi.fn()
    function LinkedDragHarness() {
      const [state, setState] = useState(initial)
      const [cues, setCues] = useState([cue])
      return <DialogueAudioTimeline
        cutState={state}
        fps={24}
        frameOrigin={1}
        cutDurationFrames={48}
        activeRevisionId="revision-1"
        soundCues={cues}
        selectedSoundCueId={null}
        onCutStateChange={change => {
          onCutStateChange(change)
          setState(change.cutState)
          if (change.cueUpdates?.length) {
            const updates = new Map(change.cueUpdates.map(update => [update.cueId, update]))
            setCues(current => current.map(item => {
              const update = updates.get(item.cueId)
              return update ? { ...item, frameStart: update.frameStart, frameEnd: update.frameEnd } : item
            }))
          }
        }}
        onPlayheadChange={vi.fn()}
        onSoundCueSelect={vi.fn()}
        onSoundCueEdit={vi.fn()}
        onSoundCueTransform={vi.fn()}
        onSoundCandidateEdit={vi.fn()}
        onAutoCreateDialogueRegions={current => current}
      />
    }

    render(<LinkedDragHarness />)
    openAudioTimeline()
    const clip = screen.getByRole('button', { name: '音声クリップ linked.wav' })
    const region = document.querySelector('[data-region-id]') as HTMLButtonElement
    Object.defineProperties(clip, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    })

    expect(screen.queryByLabelText('セリフ区間候補 3–6F')).toBeNull()
    expect(screen.getByLabelText('セリフ区間 3–6F 主人公へ割付済み')).toBeTruthy()
    fireEvent.pointerDown(clip, { button: 0, pointerId: 21, clientX: 0 })
    fireEvent.pointerMove(clip, { pointerId: 21, clientX: 150 })

    expect(onCutStateChange).not.toHaveBeenCalled()
    expect(screen.getByLabelText('セリフ区間 13–16F 主人公へ割付済み')).toBeTruthy()
    expect(region.getAttribute('style')).toContain('--candidate-visual-left')

    fireEvent.pointerUp(clip, { pointerId: 21, clientX: 150 })
    await waitFor(() => {
      expect(screen.getByLabelText('セリフ区間 13–16F 主人公へ割付済み')).toBeTruthy()
      expect(onCutStateChange).toHaveBeenCalledTimes(1)
    })
  })

  it('multi-selects overlapping clip handles and moves the selected clips as one history edit', async () => {
    const initial = createDefaultDialogueAudioCutState(1, 48)
    initial.assets = [
      { assetId: 'asset-a', audioDataUrl: 'data:audio/wav;base64,UklGRg==', durationFrames: 12, waveform: [0.2], sourceName: 'a.wav' },
      { assetId: 'asset-b', audioDataUrl: 'data:audio/wav;base64,UklGRg==', durationFrames: 12, waveform: [0.3], sourceName: 'b.wav' },
    ]
    initial.tracks[0].clips = [
      { clipId: 'clip-a', placementId: 'placement-a', assetId: 'asset-a', timelineStartFrame: 1, sourceOffsetFrames: 0, durationFrames: 12 },
      { clipId: 'clip-b', placementId: 'placement-b', assetId: 'asset-b', timelineStartFrame: 5, sourceOffsetFrames: 0, durationFrames: 12 },
    ]
    const onCutStateChange = vi.fn()
    function MultiDragHarness() {
      const [state, setState] = useState(initial)
      const [previous, setPrevious] = useState<typeof initial | null>(null)
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
          if (change.recordHistory !== false) setPrevious(state)
          setState(change.cutState)
        }}
        canUndo={Boolean(previous)}
        onUndo={() => {
          if (previous) {
            setState(previous)
            setPrevious(null)
          }
        }}
        onPlayheadChange={vi.fn()}
        onSoundCueSelect={vi.fn()}
        onSoundCueEdit={vi.fn()}
        onSoundCueTransform={vi.fn()}
        onSoundCandidateEdit={vi.fn()}
        onAutoCreateDialogueRegions={current => current}
      />
    }

    render(<MultiDragHarness />)
    openAudioTimeline()
    const clipA = screen.getByRole('button', { name: '音声クリップ a.wav' })
    const clipB = screen.getByRole('button', { name: '音声クリップ b.wav' })
    expect(clipA.dataset).toMatchObject({
      trackId: 'dialogue-1',
      clipId: 'clip-a',
      sourceName: 'a.wav',
      frameStart: '1',
      frameEnd: '12',
    })
    expect(clipB.dataset).toMatchObject({
      trackId: 'dialogue-1',
      clipId: 'clip-b',
      sourceName: 'b.wav',
      frameStart: '5',
      frameEnd: '16',
    })
    for (const clip of [clipA, clipB]) {
      Object.defineProperties(clip, {
        setPointerCapture: { configurable: true, value: vi.fn() },
        hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
        releasePointerCapture: { configurable: true, value: vi.fn() },
      })
    }

    fireEvent.pointerDown(clipA, { button: 0, pointerId: 11, clientX: 0 })
    fireEvent.pointerUp(clipA, { pointerId: 11, clientX: 0 })
    fireEvent.pointerDown(clipB, { button: 0, pointerId: 12, clientX: 0, ctrlKey: true })
    fireEvent.pointerUp(clipB, { pointerId: 12, clientX: 0 })

    expect(clipA.classList.contains('isSelected')).toBe(true)
    expect(clipB.classList.contains('isSelected')).toBe(true)
    expect(clipA.style.top).toBe('1px')
    expect(clipB.style.top).toBe('14px')
    expect(screen.getByText(/2クリップ/)).toBeTruthy()

    onCutStateChange.mockClear()
    fireEvent.pointerDown(clipA, { button: 0, pointerId: 13, clientX: 0 })
    fireEvent.pointerMove(clipA, { pointerId: 13, clientX: 150 })
    fireEvent.pointerUp(clipA, { pointerId: 13, clientX: 150 })

    await waitFor(() => {
      const change = onCutStateChange.mock.calls.at(-1)?.[0]
      expect(change?.cutState.tracks[0].clips.map((clip: { timelineStartFrame: number }) => clip.timelineStartFrame)).toEqual([11, 15])
    })
    expect(onCutStateChange).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    await waitFor(() => {
      expect(clipA.style.left).toBe('0%')
      expect(clipB.style.left).toBe(`${4 / 48 * 100}%`)
      expect(clipA.classList.contains('isSelected')).toBe(true)
      expect(clipB.classList.contains('isSelected')).toBe(true)
    })
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
        initial.assets = [{
          assetId: 'existing-asset',
          audioDataUrl: 'data:audio/wav;base64,UklGRg==',
          durationFrames: 24,
          waveform: [0.1, 0.2],
          sourceName: 'existing.wav',
        }]
        initial.tracks[0].clips = [{
          clipId: 'existing-clip',
          placementId: 'existing-placement',
          assetId: 'existing-asset',
          timelineStartFrame: 1,
          sourceOffsetFrames: 0,
          durationFrames: 24,
        }]
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

    await waitFor(() => expect(screen.getByRole('button', { name: '音声クリップ マイク録音' })).toBeTruthy())
    const waveforms = [...document.querySelectorAll('.dialogueWaveform path')]
    expect(waveforms.some(waveform => (waveform.getAttribute('d')?.length ?? 0) > 20)).toBe(true)
    expect(screen.getByRole('button', { name: '音声クリップ existing.wav' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /音声クリップ/ })).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'タイムシート終端 0+12 / 12F' })).toBeTruthy()
    expect(screen.getByRole('img', { name: '最終音声位置 0+24 / 24F' })).toBeTruthy()
    expect(onCutDurationChange).not.toHaveBeenCalled()
    expect(mediaTrack.stop).toHaveBeenCalled()
  })

  it('shows low-level waveform across the full clip independently of its VAD range', () => {
    const state = createDefaultDialogueAudioCutState(1, 24)
    state.assets = [{
      assetId: 'quiet-asset',
      audioDataUrl: 'data:audio/wav;base64,UklGRg==',
      durationFrames: 24,
      waveform: [0.000001, 0, 0.25, 0.000001],
      sourceName: 'quiet.wav',
    }]
    state.tracks[0].clips = [{
      clipId: 'quiet-clip',
      placementId: 'quiet-placement',
      assetId: 'quiet-asset',
      timelineStartFrame: 1,
      sourceOffsetFrames: 0,
      durationFrames: 24,
    }]
    state.tracks[0].speechCandidates = [{
      candidateId: 'middle-vad',
      frameStart: 9,
      frameEnd: 16,
      status: 'pending',
    }]

    render(<DialogueAudioTimeline
      cutState={state}
      fps={24}
      frameOrigin={1}
      cutDurationFrames={24}
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

    expect(screen.getByLabelText('セリフ区間候補 9–16F')).toBeTruthy()
    expect(document.querySelector('.dialogueWaveform path')?.getAttribute('d')).toBe(
      'M0.0 22.75 L333.3 24.00 L666.7 13.50 L1000.0 22.75 L1000.0 25.25 L666.7 34.50 L333.3 24.00 L0.0 25.25 Z',
    )
  })

  it('opens track management from the track header and applies a track-height preset', () => {
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
    const header = document.querySelector('.dialogueAudioTrackHeader') as HTMLDivElement
    fireEvent.contextMenu(header, { clientX: 80, clientY: 740 })
    const menu = screen.getByRole('menu', { name: 'トラックの操作' })
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
    fireEvent.doubleClick(screen.getByLabelText('セリフ区間候補 60–90F'))
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
