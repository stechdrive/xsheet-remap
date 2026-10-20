import type { TimedRangeCue } from '@xsheet-remap/core'
import type { DialogueAudioCutState } from './dialogueAudioProject'
import type { DialogueAudioSelectionState } from './dialogueAudioSelectionModel'
import { moveDialogueClips, trimDialogueAudioClip } from './dialogueAudioCommands'
import { bindingForCue, synchronizeDialogueBindingsFromCues } from './dialogueAudioBinding'
import type { DialogueAudioTimelineProps } from './dialogueAudioTimelinePresentation'

function FrameInput({ label, value, onChange, disabled }: { label: string; value: number; onChange: (value: number) => void; disabled?: boolean }) {
  return <label>{label}<input key={value} aria-label={label} type="number" step="1" defaultValue={value} disabled={disabled}
    onBlur={event => { const next = Number(event.target.value); if (event.target.value && Number.isSafeInteger(next) && next !== value) onChange(next); event.target.value = String(value) }}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = String(value); event.currentTarget.blur() } }} />F</label>
}

export function DialogueAudioInspector({ state, selection, cues, selectedCue, revision, frameOrigin, disabled, onCommand, onTransform }: {
  state: DialogueAudioCutState; selection: DialogueAudioSelectionState; cues: TimedRangeCue[]; selectedCue?: TimedRangeCue
  revision: string; frameOrigin: number; disabled: boolean; onCommand: (command: () => DialogueAudioCutState) => void; onTransform: DialogueAudioTimelineProps['onSoundCueTransform']
}) {
  const refs = selection.entities.filter(entity => entity.kind === 'clip')
  const track = refs.length === 1 ? state.tracks.find(item => item.trackId === refs[0].trackId) : undefined
  const clip = track?.clips.find(item => item.clipId === refs[0].id)
  const binding = selectedCue ? bindingForCue(state, selectedCue.cueId, revision) : undefined
  return <div className="dialogueAudioInspector" aria-label="音声とSOUNDのプロパティ">
    {clip && track && <>
      <strong>{state.assets.find(asset => asset.assetId === clip.assetId)?.sourceName ?? '音声クリップ'}</strong>
      <FrameInput label="クリップ開始" value={clip.timelineStartFrame} disabled={disabled || track.locked} onChange={frame => onCommand(() => moveDialogueClips(state, track.trackId, [clip.clipId], frame - clip.timelineStartFrame, track.trackId, frameOrigin))} />
      <FrameInput label="クリップ長" value={clip.durationFrames} disabled={disabled || track.locked} onChange={length => onCommand(() => trimDialogueAudioClip(state, track.trackId, clip.clipId, 'end', clip.timelineStartFrame + length, frameOrigin))} />
      <span>素材IN {clip.sourceOffsetFrames}F</span>
    </>}
    {selectedCue && <>
      <strong>SOUND {selectedCue.label || '名称なし'}</strong>
      <FrameInput label="収録開始" value={selectedCue.frameStart} disabled={disabled} onChange={frame => onTransform(selectedCue.cueId, { laneId: selectedCue.laneId, frameStart: Math.max(frameOrigin, Math.min(frame, selectedCue.frameEnd)), frameEnd: selectedCue.frameEnd }, 'resize-cue')} />
      <FrameInput label="収録終了" value={selectedCue.frameEnd} disabled={disabled} onChange={frame => onTransform(selectedCue.cueId, { laneId: selectedCue.laneId, frameStart: selectedCue.frameStart, frameEnd: Math.max(selectedCue.frameStart, frame) }, 'resize-cue')} />
      {binding && <>
        <label>音声との関係<select aria-label="SOUNDの追従方法" value={binding.rangeMode ?? 'follow-audio'} disabled={disabled} onChange={event => {
          const rangeMode = event.target.value as 'follow-audio' | 'fixed'
          onCommand(() => synchronizeDialogueBindingsFromCues({ ...state, soundBindings: state.soundBindings.map(item => item === binding ? { ...item, rangeMode } : item) }, cues, revision))
        }}><option value="follow-audio">前後の余白を保って追従</option><option value="fixed">収録区間を固定</option></select></label>
        <span>前 {binding.headPaddingFrames > 0 ? '+' : ''}{binding.headPaddingFrames}F / 後 {binding.tailPaddingFrames > 0 ? '+' : ''}{binding.tailPaddingFrames}F</span>
        {binding.status !== 'linked' && <span className="isInvalid">{binding.status === 'orphaned' ? '音声なし・指示は保持' : 'リンクを確認'} {binding.reviewReason}</span>}
      </>}
    </>}
    {!clip && !selectedCue && <small>V 選択・移動 / C 分割 / R 範囲 · クリップ端をドラッグしてトリム</small>}
  </div>
}
