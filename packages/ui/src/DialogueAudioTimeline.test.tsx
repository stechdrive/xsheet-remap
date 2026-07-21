import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DialogueAudioTimeline } from './DialogueAudioTimeline'
import { createDefaultDialogueAudioCutState } from './dialogueAudioProject'
import { linkDialogueAudioCandidates } from './dialogueAudioBinding'

afterEach(cleanup)

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
    expect(screen.getByRole('button', { name: '⏮ カット頭から' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '▶ 再生ヘッドから' })).toBeTruthy()
    expect(screen.getAllByLabelText(/を録音対象にする/)).toHaveLength(3)
    expect((screen.getByLabelText('選択SOUNDをループ') as HTMLInputElement).checked).toBe(false)
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
    fireEvent.pointerDown(screen.getByLabelText('発話候補 12–20F VAD'))
    fireEvent.pointerDown(screen.getByLabelText('発話候補 24–35F VAD'), { ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: '候補をまとめてSOUND作成' }))
    expect(onSoundCandidateEdit).toHaveBeenCalledWith('dialogue-1', ['vad-1', 'vad-2'], 12, 35)
  })
})
