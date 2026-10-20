import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { DialogueAudioTimeline } from './DialogueAudioTimeline'
import { createDefaultDialogueAudioCutState } from './dialogueAudioProject'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
function mount() {
  const initial=createDefaultDialogueAudioCutState(1)
  initial.assets=[{assetId:'voice',audioDataUrl:'data:audio/wav;base64,AA==',durationFrames:120,waveform:[.1,.5,.2],sourceName:'voice.wav'}]
  initial.tracks[0].clips=[{clipId:'clip',placementId:'placement',assetId:'voice',timelineStartFrame:13,sourceOffsetFrames:12,durationFrames:48}]
  const committed=vi.fn(), assign=vi.fn()
  function Harness() {
    const [state,setState]=useState(initial)
    return <DialogueAudioTimeline cutState={state} fps={24} frameOrigin={1} cutDurationFrames={144} activeRevisionId="main" soundCues={[]} selectedSoundCueId={null}
      onCutStateChange={change=>{setState(change.cutState);if(change.recordHistory!==false) committed(change)}} onPlayheadChange={vi.fn()}
      onSoundCueSelect={vi.fn()} onSoundCueEdit={vi.fn()} onSoundCueTransform={vi.fn()} onSoundCandidateEdit={assign} onAutoCreateDialogueRegions={state=>state} />
  }
  render(<Harness />); fireEvent.click(screen.getByRole('button',{name:'音声タイムラインを開く'}))
  return {committed,assign}
}
describe('clip tools',()=>{
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
