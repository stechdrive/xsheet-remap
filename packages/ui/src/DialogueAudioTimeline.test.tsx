import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DialogueAudioTimeline } from './DialogueAudioTimeline'
import { createDefaultDialogueAudioCutState } from './dialogueAudioProject'

afterEach(cleanup)

describe('DialogueAudioTimeline', () => {
  it('shows three tracks and keeps cut-head playback distinct from cue looping', () => {
    render(<DialogueAudioTimeline
      cutState={createDefaultDialogueAudioCutState(1)}
      fps={24}
      frameOrigin={1}
      durationFrames={144}
      soundCues={[{ cueId: 'cue_1', role: 'sound', laneId: 'sound_lane_1', frameStart: 25, frameEnd: 48, label: 'A', text: '' }]}
      selectedSoundCueId="cue_1"
      onCutStateChange={vi.fn()}
      onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()}
      onSoundCueTransform={vi.fn()}
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
      soundCues={[]}
      selectedSoundCueId={null}
      onCutStateChange={onCutStateChange}
      onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()}
      onSoundCueTransform={vi.fn()}
    />)
    fireEvent.click(screen.getByLabelText('セリフ 2を録音対象にする'))
    expect(onCutStateChange.mock.calls[0][0].activeTrackId).toBe('dialogue-2')
  })
})
