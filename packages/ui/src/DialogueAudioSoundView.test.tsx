import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import type { LogicalTimelineLane, TimedRangeCue } from '@xsheet-remap/core'
import { DialogueAudioTimeline } from './DialogueAudioTimeline'
import { createDefaultDialogueAudioCutState } from './dialogueAudioProject'
import { bindDialogueRegionsToCue } from './dialogueAudioBinding'
import { regionsForDialogueClips, splitDialogueAudioClips } from './dialogueAudioCommands'
import { linkedDialogueClips } from './dialogueAudioSoundView'

afterEach(() => { cleanup(); localStorage.clear() })

const cue: TimedRangeCue = { cueId: 'instruction', role: 'sound', laneId: 'lane-2', frameStart: 7, frameEnd: 72, label: '主人公', text: '' }
function fixture() {
  let state = createDefaultDialogueAudioCutState(1)
  state.assets = [{ assetId: 'voice', audioDataUrl: 'data:audio/wav;base64,AA==', durationFrames: 144, waveform: [.2, .4], sourceName: 'voice.wav' }]
  state.tracks = state.tracks.map((track, index) => ({ ...track, name: `元の名前 ${index}`, clips: [
    { clipId: `clip-${index}`, placementId: `placement-${index}`, assetId: 'voice', timelineStartFrame: 13, sourceOffsetFrames: 12, durationFrames: 48 },
  ] }))
  const regions = regionsForDialogueClips(state, [{ trackId: 'dialogue-1', clipId: 'clip-0' }, { trackId: 'dialogue-3', clipId: 'clip-2' }])
  state = bindDialogueRegionsToCue(regions.state, regions.refs, cue, 'main', [cue])
  return state
}

function mount() {
  const changes = vi.fn()
  const initial = fixture()
  function Harness({ lanes }: { lanes: LogicalTimelineLane[] }) {
    const [state, setState] = useState(initial)
    const [selected, setSelected] = useState<string | null>(null)
    return <DialogueAudioTimeline cutState={state} fps={24} frameOrigin={1} cutDurationFrames={144} activeRevisionId="main"
      soundCues={[cue]} selectedSoundCueId={selected} soundSectionLabel="セリフ" soundLanes={lanes}
      onCutStateChange={change => { changes(change); setState(change.cutState) }} onPlayheadChange={vi.fn()}
      onSoundCueSelect={setSelected} onSoundCueEdit={vi.fn()} onSoundCueTransform={vi.fn()} onSoundCandidateEdit={vi.fn()} onAutoCreateDialogueRegions={value => value} />
  }
  const lanes = Array.from({ length: 6 }, (_, index) => ({ laneId: `lane-${index}`, label: `話者 ${index + 1}`, order: index }))
  const view = render(<Harness lanes={[...lanes].reverse()} />)
  fireEvent.click(screen.getByRole('button', { name: '音声タイムラインを開く' }))
  return { changes, initial, lanes, rerender: (next: LogicalTimelineLane[]) => view.rerender(<Harness lanes={next} />) }
}

describe('sheet instruction view', () => {
  it('uses the current column names and order, including empty columns, and follows column changes without a fixed count', () => {
    const { lanes, rerender } = mount()
    const toggle = screen.getByRole('button', { name: 'セリフの指示一覧' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'セリフ 主人公 7–72F' })).toBeNull()
    expect(screen.getByRole('button', { name: '範囲選択' }).textContent).toBe('')
    fireEvent.click(toggle)
    const names = () => Array.from(document.querySelectorAll('.dialogueAudioSoundLaneName')).map(element => element.textContent)
    expect(names()).toEqual(['話者 1', '話者 2', '話者 3', '話者 4', '話者 5', '話者 6'])
    expect(document.querySelectorAll('.dialogueAudioSoundRow')).toHaveLength(6)
    expect(screen.getByRole('button', { name: 'セリフ 主人公 7–72F' }).dataset.soundLaneId).toBe('lane-2')
    rerender([{ ...lanes[2], label: '改名した列', order: 0 }, { ...lanes[0], order: 1 }])
    expect(names()).toEqual(['改名した列', '話者 1'])
    expect(document.querySelectorAll('.dialogueAudioSoundRow')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'セリフへ割付…' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'SOUNDへ割付…' })).toBeNull()
  })

  it('keeps the selected instruction guide and linked clip highlights when its list is folded without changing audio selection', () => {
    const { changes } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'セリフの指示一覧' }))
    fireEvent.click(screen.getByRole('button', { name: 'セリフ 主人公 7–72F' }))
    fireEvent.click(screen.getByRole('button', { name: 'セリフの指示一覧' }))
    expect(screen.getByRole('img', { name: 'セリフの指示区間ガイド 主人公 7–72F' })).toBeTruthy()
    expect(Array.from(document.querySelectorAll<HTMLElement>('[data-linked-highlight="true"]')).map(clip => clip.dataset.clipId)).toEqual(['clip-0', 'clip-2'])
    expect(screen.getAllByRole('button', { name: '音声クリップ voice.wav' }).map(clip => clip.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false'])
    fireEvent.click(screen.getByRole('button', { name: '対応する音声へ' }))
    expect(changes).not.toHaveBeenCalled()
    expect(screen.getByRole('slider', { name: '音声再生ヘッド' }).getAttribute('aria-valuenow')).toBe('1')
  })

  it('retains source track names and clips while renaming through the menu, with Escape and IME cancellation', () => {
    const { changes, initial } = mount()
    expect(screen.queryByRole('textbox', { name: '音声トラック1の名前' })).toBeNull()
    fireEvent.click(screen.getByLabelText('音声トラック1の操作'))
    const input = screen.getByRole('textbox', { name: '音声トラック1の名前' })
    fireEvent.change(input, { target: { value: '取消' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(changes).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('音声トラック1の操作'))
    const renamed = screen.getByRole('textbox', { name: '音声トラック1の名前' })
    fireEvent.change(renamed, { target: { value: '主人公' } })
    fireEvent.keyDown(renamed, { key: 'Enter', isComposing: true })
    expect(changes).not.toHaveBeenCalled()
    fireEvent.blur(renamed)
    expect(changes).toHaveBeenCalledTimes(1)
    expect(changes.mock.calls[0][0].cutState.tracks[0]).toEqual({ ...initial.tracks[0], name: '主人公' })
  })

  it('resolves split clips on multiple tracks from source anchors without highlighting unrelated audio', () => {
    const state = fixture()
    const split = splitDialogueAudioClips(state, ['clip-0'], 25)
    const linked = linkedDialogueClips(split, split.soundBindings[0])
    expect(linked.map(ref => ref.trackId)).toEqual(['dialogue-1', 'dialogue-1', 'dialogue-3'])
    expect(linked.some(ref => ref.clipId === 'clip-1')).toBe(false)
    const deleted = { ...split, tracks: split.tracks.map(track => ({ ...track, clips: [] })) }
    expect(linkedDialogueClips(deleted, deleted.soundBindings[0])).toEqual([])
  })
})
