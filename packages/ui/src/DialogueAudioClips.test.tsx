import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { DialogueAudioTimeline } from './DialogueAudioTimeline'
import { createDefaultDialogueAudioCutState, type DialogueAudioCutState } from './dialogueAudioProject'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
function mount(configure?: (state: DialogueAudioCutState) => void) {
  const initial=createDefaultDialogueAudioCutState(1)
  initial.assets=[{assetId:'voice',audioDataUrl:'data:audio/wav;base64,AA==',durationFrames:120,waveform:[.1,.5,.2],sourceName:'voice.wav'}]
  initial.tracks[0].clips=[{clipId:'clip',placementId:'placement',assetId:'voice',timelineStartFrame:13,sourceOffsetFrames:12,durationFrames:48}]
  configure?.(initial)
  const committed=vi.fn(), assign=vi.fn(), playhead=vi.fn()
  function Harness() {
    const [state,setState]=useState(initial)
    return <DialogueAudioTimeline cutState={state} fps={24} frameOrigin={1} cutDurationFrames={144} activeRevisionId="main" soundCues={[]} selectedSoundCueId={null}
      onCutStateChange={change=>{setState(change.cutState);if(change.recordHistory!==false) committed(change)}} onPlayheadChange={playhead}
      onSoundCueSelect={vi.fn()} onSoundCueEdit={vi.fn()} onSoundCueTransform={vi.fn()} onSoundCandidateEdit={assign} onAutoCreateDialogueRegions={state=>state} />
  }
  render(<Harness />); fireEvent.click(screen.getByRole('button',{name:'音声タイムラインを開く'}))
  return {committed,assign,playhead}
}
describe('clip tools',()=>{
  it('keeps track menu keyboard input from editing selected clips behind the menu', () => {
    const { committed } = mount()
    const clip = screen.getByRole('button', { name: '音声クリップ voice.wav' })
    fireEvent.pointerDown(clip, { button: 0, pointerId: 1, clientX: 0 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 0 })
    fireEvent.click(screen.getByLabelText('音声トラック1の操作'))
    const command = screen.getByRole('button', { name: 'トラックと音声を削除' })
    fireEvent.keyDown(command, { key: 'Delete' })
    fireEvent.keyDown(command, { key: 's' })
    expect(committed).not.toHaveBeenCalled()
    expect(clip.dataset.frameStart).toBe('13')
    expect(screen.getByRole('button', { name: 'スナップ' }).getAttribute('aria-pressed')).toBe('true')
  })
  it('keeps playhead stepping separate from clip nudging and leaves inputs and IME alone', () => {
    const { committed, playhead } = mount()
    const editor = screen.getByRole('group', { name: '音声トラック編集領域' })
    const clip = screen.getByRole('button', { name: '音声クリップ voice.wav' })
    fireEvent.pointerDown(clip, { button: 0, pointerId: 1, clientX: 0 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 0 })
    fireEvent.keyDown(editor, { key: 'ArrowRight' })
    expect(playhead).toHaveBeenLastCalledWith(2)
    expect(committed).not.toHaveBeenCalled()
    fireEvent.keyDown(editor, { key: 'ArrowRight', shiftKey: true })
    expect(playhead).toHaveBeenLastCalledWith(7)
    fireEvent.keyDown(editor, { key: 'ArrowRight', altKey: true })
    expect(clip.dataset.frameStart).toBe('14')
    fireEvent.keyDown(editor, { key: 'ArrowRight', altKey: true, shiftKey: true })
    expect(clip.dataset.frameStart).toBe('19')
    fireEvent.keyDown(editor, { key: 'ArrowLeft', metaKey: true })
    expect(clip.dataset.frameStart).toBe('18')
    fireEvent.keyDown(editor, { key: 'ArrowRight', ctrlKey: true, altKey: true })
    fireEvent.keyDown(editor, { key: 'Delete', isComposing: true })
    fireEvent.keyDown(editor, { key: 'c', isComposing: true })
    fireEvent.click(screen.getByLabelText('音声トラック1の操作'))
    fireEvent.keyDown(screen.getByLabelText('音声トラック1の名前'), { key: 'ArrowRight', altKey: true })
    fireEvent.keyDown(screen.getByLabelText('音声トラック1の名前'), { key: 'Escape' })
    fireEvent.keyDown(screen.getByLabelText('クリップ開始'), { key: 'Delete' })
    expect(committed).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('button', { name: '選択ツール' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(editor, { key: 'End' })
    expect(playhead).toHaveBeenLastCalledWith(144)
    fireEvent.keyDown(editor, { key: 'Home' })
    expect(playhead).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(editor, { key: 's' })
    expect(screen.getByRole('button', { name: 'スナップ' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.keyDown(editor, { key: 'c' })
    expect(clip.dataset.tool).toBe('razor')
    fireEvent.keyDown(editor, { key: 'r' })
    expect(clip.dataset.tool).toBe('razor')
    fireEvent.keyDown(editor, { key: 'v' })
    expect(clip.dataset.tool).toBe('select')
  })

  it('adds edits to all unlocked tracks with Ctrl+Shift+K and with Shift+razor, never on right-click', () => {
    const { committed } = mount(state => {
      state.tracks[1].clips = [{ ...state.tracks[0].clips[0], clipId: 'second' }]
      state.tracks[2].clips = [{ ...state.tracks[0].clips[0], clipId: 'locked' }]
      state.tracks[2].locked = true
    })
    const editor = screen.getByRole('group', { name: '音声トラック編集領域' })
    for (let i = 0; i < 4; i++) fireEvent.keyDown(editor, { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(editor, { key: 'k', ctrlKey: true, shiftKey: true })
    expect(committed).toHaveBeenCalledTimes(1)
    expect(committed.mock.calls[0][0].cutState.tracks.map((track: { clips: unknown[] }) => track.clips.length)).toEqual([2, 2, 1])
    fireEvent.keyDown(editor, { key: 'c' })
    const clip = document.querySelector<HTMLButtonElement>('[data-clip-id="clip-split"]')!
    fireEvent.pointerDown(clip, { button: 2, pointerId: 2, clientX: 50, shiftKey: true })
    expect(committed).toHaveBeenCalledTimes(1)
    fireEvent.pointerDown(clip, { button: 0, pointerId: 3, clientX: 50, shiftKey: true })
    expect(committed).toHaveBeenCalledTimes(2)
    expect(committed.mock.calls[1][0].cutState.tracks.map((track: { clips: unknown[] }) => track.clips.length)).toEqual([3, 3, 1])
  })

  it.each(['keyboard', 'menu'])('ripple deletes only selected clip intervals via %s and preserves unselected clips between them', method => {
    const { committed } = mount(state => {
      const source = state.tracks[0].clips[0]
      state.tracks[0].clips = [
        { ...source, durationFrames: 10 },
        { ...source, clipId: 'between', timelineStartFrame: 30, durationFrames: 10 },
        { ...source, clipId: 'selected-last', timelineStartFrame: 50, durationFrames: 10 },
        { ...source, clipId: 'tail', timelineStartFrame: 80, durationFrames: 10 },
      ]
    })
    for (const id of ['clip', 'selected-last']) {
      fireEvent.pointerDown(document.querySelector(`[data-clip-id="${id}"]`)!, { button: 0, pointerId: 1, clientX: 0, shiftKey: id !== 'clip' })
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 0 })
    }
    if (method === 'keyboard') fireEvent.keyDown(screen.getByRole('group', { name: '音声トラック編集領域' }), { key: 'Delete', shiftKey: true })
    else {
      fireEvent.contextMenu(document.querySelector('[data-clip-id="clip"]')!, { clientX: 100, clientY: 100 })
      fireEvent.click(screen.getByRole('menuitem', { name: /^リップル削除/ }))
    }
    expect(committed).toHaveBeenCalledTimes(1)
    expect(committed.mock.calls[0][0].cutState.tracks[0].clips.map((clip: { clipId: string; timelineStartFrame: number }) => [clip.clipId, clip.timelineStartFrame])).toEqual([['between', 20], ['tail', 60]])
  })

  it('explains controls and trim edges in shared tooltips and dismisses them when dragging starts', async () => {
    mount()
    for (const [name, description] of [
      ['範囲選択', 'ドラッグして音声の一部分を選択'],
      ['レーザーツール（C）', 'Shift+クリック'],
      ['スナップ', '吸着'],
      ['音声トラック1をソロ', 'ソロにしたトラックだけ'],
      ['音声トラック1をロック', '移動・トリム・削除'],
      ['音声トラック1を録音対象にする', '録音・音声読込・貼り付け先'],
    ]) {
      const button = screen.getByRole('button', { name })
      const trigger = button.closest('.appTooltipTrigger') ?? button
      fireEvent.pointerEnter(trigger)
      expect((await screen.findByRole('tooltip')).textContent).toContain(description)
      fireEvent.pointerLeave(trigger)
    }
    const clip = screen.getByRole('button', { name: '音声クリップ voice.wav' })
    const edge = clip.querySelector('[data-clip-edge="start"]')!
    fireEvent.pointerEnter(clip)
    fireEvent.pointerMove(edge, { buttons: 0 })
    expect((await screen.findByRole('tooltip')).textContent).toContain('開始をトリム')
    fireEvent.pointerDown(edge, { button: 0, pointerId: 1, clientX: 0 })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 30 })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(clip.dataset.frameStart).toBe('13')
  })
  it('trims by an edge, cancels a move with Escape, moves to another track, and blocks locked editing',()=>{
    const {committed}=mount(), clip=screen.getByRole('button',{name:'音声クリップ voice.wav'})
    fireEvent.click(screen.getByRole('button',{name:'スナップ'}))
    const edge=clip.querySelector('[data-clip-edge="start"]')!
    fireEvent.pointerDown(edge,{button:0,buttons:1,pointerId:1,clientX:0})
    fireEvent.pointerMove(window,{buttons:1,pointerId:1,clientX:30})
    expect(committed).not.toHaveBeenCalled()
    fireEvent.pointerUp(window,{pointerId:1,clientX:30})
    expect(committed).toHaveBeenCalledTimes(1)
    const trimmed=committed.mock.calls[0][0].cutState.tracks[0].clips[0]
    expect(trimmed.timelineStartFrame).toBeGreaterThan(13)
    expect(trimmed.sourceOffsetFrames).toBe(12+trimmed.timelineStartFrame-13)
    expect(trimmed.timelineStartFrame+trimmed.durationFrames).toBe(61)
    fireEvent.pointerDown(clip,{button:0,buttons:1,pointerId:2,clientX:0})
    fireEvent.pointerMove(window,{buttons:1,pointerId:2,clientX:30})
    fireEvent.keyDown(window,{key:'Escape'})
    fireEvent.pointerUp(window,{pointerId:2,clientX:30})
    expect(committed).toHaveBeenCalledTimes(1)
    const target=document.querySelector('.dialogueAudioTrack[data-track-id="dialogue-2"]')!
    Object.defineProperty(document,'elementsFromPoint',{configurable:true,value:()=>[target]})
    fireEvent.pointerDown(clip,{button:0,buttons:1,pointerId:3,clientX:0})
    fireEvent.pointerMove(window,{buttons:1,pointerId:3,clientX:30})
    fireEvent.pointerUp(window,{pointerId:3,clientX:30})
    expect(committed.mock.calls.at(-1)?.[0].cutState.tracks[0].clips).toHaveLength(0)
    expect(committed.mock.calls.at(-1)?.[0].cutState.tracks[1].clips[0].placementId).toBe('placement')
    fireEvent.click(screen.getByRole('button',{name:'音声トラック2をロック'}))
    const calls=committed.mock.calls.length
    fireEvent.pointerDown(screen.getByRole('button',{name:'音声クリップ voice.wav'}),{button:0,buttons:1,pointerId:4,clientX:0})
    fireEvent.pointerMove(window,{buttons:1,pointerId:4,clientX:90}); fireEvent.pointerUp(window,{pointerId:4,clientX:90})
    expect(committed).toHaveBeenCalledTimes(calls)
    Reflect.deleteProperty(document,'elementsFromPoint')
  })
  it('creates independent clip-based SOUND requests and cuts/pastes with the original embedded asset',()=>{
    const {committed,assign}=mount(), clip=screen.getByRole('button',{name:'音声クリップ voice.wav'})
    fireEvent.pointerDown(clip,{button:0,buttons:1,pointerId:1,clientX:0}); fireEvent.pointerUp(window,{pointerId:1,clientX:0})
    fireEvent.click(screen.getByRole('button',{name:'SOUNDへ割付…'}))
    expect(assign).toHaveBeenCalledWith('dialogue-1',[],13,60,undefined,[{trackId:'dialogue-1',clipId:'clip'}])
    const editor=screen.getByRole('group',{name:'音声トラック編集領域'})
    fireEvent.keyDown(editor,{key:'x',ctrlKey:true})
    expect(committed.mock.calls.at(-1)?.[0].cutState.assets).toHaveLength(0)
    fireEvent.keyDown(editor,{key:'v',ctrlKey:true})
    expect(committed.mock.calls.at(-1)?.[0].cutState.assets[0].audioDataUrl).toBe('data:audio/wav;base64,AA==')
    expect(committed.mock.calls.at(-1)?.[0].cutState.tracks[0].clips).toHaveLength(1)
  })
})
