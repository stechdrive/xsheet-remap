import type { TimedRangeCue } from '@xsheet-remap/core'
import type { DialogueAudioCutState } from './dialogueAudioProject'
import type { DialogueAudioSelectionState } from './dialogueAudioSelectionModel'
import { moveDialogueClips, trimDialogueAudioClip } from './dialogueAudioCommands'
import { bindingForCue, synchronizeDialogueBindingsFromCues } from './dialogueAudioBinding'
import type { DialogueAudioTimelineProps } from './dialogueAudioTimelinePresentation'
import { Tooltip, TooltipTarget } from './Tooltip'

const frameHelp: Record<string, string> = {
  'クリップ開始': 'クリップの配置位置をフレームで指定。長さを保って移動',
  'クリップ長': 'クリップの長さをフレームで指定。終了端をトリム（元の音声は保持）',
  '指示開始': 'シートの指示開始フレーム。音声との前余白を調整',
  '指示終了': 'シートの指示終了フレーム。音声との後余白を調整',
}

function FrameInput({ label, value, onChange, disabled }: { label: string; value: number; onChange: (value: number) => void; disabled?: boolean }) {
  return <TooltipTarget label={`${frameHelp[label]}。Enterで確定、Escで取消`}>
    {tooltipProps => <label {...tooltipProps}>{label}<input key={value} aria-label={label} type="number" step="1" defaultValue={value} disabled={disabled}
    onBlur={event => { const next = Number(event.target.value); if (event.target.value && Number.isSafeInteger(next) && next !== value) onChange(next); event.target.value = String(value) }}
    onKeyDown={event => { event.stopPropagation(); if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = String(value); event.currentTarget.blur() } }} />F</label>}
  </TooltipTarget>
}

export function DialogueAudioInspector({ state, selection, cues, selectedCue, soundLabel, laneLabel, linkedClipCount, onRevealAudio, revision, frameOrigin, disabled, onCommand, onTransform }: {
  state: DialogueAudioCutState; selection: DialogueAudioSelectionState; cues: TimedRangeCue[]; selectedCue?: TimedRangeCue
  soundLabel: string; laneLabel?: string; linkedClipCount: number; onRevealAudio: () => void
  revision: string; frameOrigin: number; disabled: boolean; onCommand: (command: () => DialogueAudioCutState) => void; onTransform: DialogueAudioTimelineProps['onSoundCueTransform']
}) {
  const refs = selection.entities.filter(entity => entity.kind === 'clip')
  const track = refs.length === 1 ? state.tracks.find(item => item.trackId === refs[0].trackId) : undefined
  const clip = track?.clips.find(item => item.clipId === refs[0].id)
  const binding = selectedCue ? bindingForCue(state, selectedCue.cueId, revision) : undefined
  return <div className="dialogueAudioInspector" aria-label={`音声と${soundLabel}のプロパティ`}>
    {clip && track && <>
      <strong>{state.assets.find(asset => asset.assetId === clip.assetId)?.sourceName ?? '音声クリップ'}</strong>
      <FrameInput label="クリップ開始" value={clip.timelineStartFrame} disabled={disabled || track.locked} onChange={frame => onCommand(() => moveDialogueClips(state, track.trackId, [clip.clipId], frame - clip.timelineStartFrame, track.trackId, frameOrigin))} />
      <FrameInput label="クリップ長" value={clip.durationFrames} disabled={disabled || track.locked} onChange={length => onCommand(() => trimDialogueAudioClip(state, track.trackId, clip.clipId, 'end', clip.timelineStartFrame + length, frameOrigin))} />
      <TooltipTarget label="元の音声素材での開始位置（0F起点）。開始端のトリムで変わります">
        {tooltipProps => <span {...tooltipProps}>素材IN {clip.sourceOffsetFrames}F</span>}
      </TooltipTarget>
    </>}
    {selectedCue && <>
      <TooltipTarget label={`${soundLabel}・${laneLabel ?? ''}・${selectedCue.label || '名称なし'}：${selectedCue.frameStart}–${selectedCue.frameEnd}F。波形上の金色のガイドで指示区間を確認`}>
        {tooltipProps => <strong {...tooltipProps}>{soundLabel}・{laneLabel} {selectedCue.label || '名称なし'}</strong>}
      </TooltipTarget>
      <Tooltip label="対応する音声クリップを表示。複数ある場合は押すたびに順番に移動。選択や再生位置は保持">
        <button type="button" disabled={!linkedClipCount} onClick={onRevealAudio}>対応する音声へ</button>
      </Tooltip>
      <FrameInput label="指示開始" value={selectedCue.frameStart} disabled={disabled} onChange={frame => onTransform(selectedCue.cueId, { laneId: selectedCue.laneId, frameStart: Math.max(frameOrigin, Math.min(frame, selectedCue.frameEnd)), frameEnd: selectedCue.frameEnd }, 'resize-cue')} />
      <FrameInput label="指示終了" value={selectedCue.frameEnd} disabled={disabled} onChange={frame => onTransform(selectedCue.cueId, { laneId: selectedCue.laneId, frameStart: selectedCue.frameStart, frameEnd: Math.max(selectedCue.frameStart, frame) }, 'resize-cue')} />
      {binding && <>
        <TooltipTarget label={`追従：音声の移動に合わせて前後の余白を保つ。固定：音声を動かしても${soundLabel}の指示区間を保つ`}>
        {tooltipProps => <label {...tooltipProps}>音声との関係<select aria-label={`${soundLabel}の追従方法`} value={binding.rangeMode ?? 'follow-audio'} disabled={disabled} onChange={event => {
          const rangeMode = event.target.value as 'follow-audio' | 'fixed'
          onCommand(() => synchronizeDialogueBindingsFromCues({ ...state, soundBindings: state.soundBindings.map(item => item === binding ? { ...item, rangeMode } : item) }, cues, revision))
        }}><option value="follow-audio">前後の余白を保って追従</option><option value="fixed">指示区間を固定</option></select></label>}
        </TooltipTarget>
        <TooltipTarget label="指示区間と音声の前後の余白。正の値は指示区間内の余白、負の値は音声のはみ出し">
          {tooltipProps => <span {...tooltipProps}>前 {binding.headPaddingFrames > 0 ? '+' : ''}{binding.headPaddingFrames}F / 後 {binding.tailPaddingFrames > 0 ? '+' : ''}{binding.tailPaddingFrames}F</span>}
        </TooltipTarget>
        {binding.status !== 'linked' && <span className="isInvalid">{binding.status === 'orphaned' ? '音声なし・指示は保持' : 'リンクを確認'} {binding.reviewReason}</span>}
      </>}
    </>}
    {!clip && !selectedCue && <small>V 選択 / C レーザー / S スナップ / Space 再生・停止 · クリップ端でトリム</small>}
  </div>
}
