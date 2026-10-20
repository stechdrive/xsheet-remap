import { ActionMenu } from './AppControls'
import type { DialogueAudioTrackState } from './dialogueAudioProject'

export function DialogueAudioTrackControls({ track, index, count, disabled, onUpdate, onReorder, onRemove }: {
  track: DialogueAudioTrackState; index: number; count: number; disabled: boolean
  onUpdate: (updates: Partial<DialogueAudioTrackState>) => void; onReorder: (index: number) => void; onRemove: () => void
}) {
  return <>
    <input className="dialogueAudioTrackName" aria-label={`音声トラック${index + 1}の名前`} key={`${track.trackId}:${track.name}`} defaultValue={track.name ?? `音声 ${index + 1}`} disabled={disabled || track.locked}
      onBlur={event => { const name = event.target.value.trim(); if (name && name !== track.name) onUpdate({ name }); else event.target.value = track.name ?? '' }}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = track.name ?? ''; event.currentTarget.blur() } }} />
    <button type="button" className="dialogueAudioTrackSolo" aria-label={`音声トラック${index + 1}をソロ`} aria-pressed={Boolean(track.solo)} disabled={disabled} onClick={() => onUpdate({ solo: !track.solo })}>S</button>
    <button type="button" className="dialogueAudioTrackLock" aria-label={`音声トラック${index + 1}をロック`} aria-pressed={Boolean(track.locked)} disabled={disabled} onClick={() => onUpdate({ locked: !track.locked })}>{track.locked ? '🔒' : 'L'}</button>
    <ActionMenu label="⋯" ariaLabel={`音声トラック${index + 1}の操作`}>
      <button type="button" disabled={disabled || index === 0} onClick={() => onReorder(index - 1)}>上へ移動</button>
      <button type="button" disabled={disabled || index === count - 1} onClick={() => onReorder(index + 1)}>下へ移動</button>
      <button type="button" disabled={disabled || track.locked || count === 1} onClick={onRemove}>トラックと音声を削除</button>
      <small>SOUNDの指示は残ります。元に戻すで復元できます。</small>
    </ActionMenu>
  </>
}
