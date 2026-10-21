import { ActionMenu } from './AppControls'
import type { DialogueAudioTrackState } from './dialogueAudioProject'
import { DialogueAudioIcon } from './DialogueAudioIcons'
import { TooltipTarget } from './Tooltip'

export function DialogueAudioTrackControls({ track, index, count, disabled, soundLabel, onUpdate, onReorder, onRemove }: {
  track: DialogueAudioTrackState; index: number; count: number; disabled: boolean
  soundLabel: string
  onUpdate: (updates: Partial<DialogueAudioTrackState>) => void; onReorder: (index: number) => void; onRemove: () => void
}) {
  return <>
    <TooltipTarget label={track.solo ? 'ソロを解除。通常のトラック再生に戻す' : 'ソロ。ソロにしたトラックだけを再生（ミュートは優先）'}>
      {tooltipProps => <button {...tooltipProps} type="button" className="dialogueAudioTrackSolo" aria-label={`音声トラック${index + 1}をソロ`} aria-pressed={Boolean(track.solo)} disabled={disabled} onClick={() => onUpdate({ solo: !track.solo })}>S</button>}
    </TooltipTarget>
    <TooltipTarget label={track.locked ? 'トラックのロックを解除して編集を許可' : 'トラックをロック。クリップの移動・トリム・削除を防ぐ'}>
      {tooltipProps => <button {...tooltipProps} type="button" className="dialogueAudioTrackLock" aria-label={`音声トラック${index + 1}をロック`} aria-pressed={Boolean(track.locked)} disabled={disabled} onClick={() => onUpdate({ locked: !track.locked })}><DialogueAudioIcon name={track.locked ? 'lock' : 'unlock'} /></button>}
    </TooltipTarget>
    <ActionMenu label="⋯" ariaLabel={`音声トラック${index + 1}の操作`} tooltipLabel={`A${index + 1}：${track.name ?? ''}。名前の変更・並べ替え・削除`}>
      <TooltipTarget label="トラック名を変更。Enterで確定、Escで取消。CLIP入出力でも使用">
        {tooltipProps => <label {...tooltipProps} className="dialogueAudioTrackName">トラック名<input aria-label={`音声トラック${index + 1}の名前`} key={`${track.trackId}:${track.name}`} defaultValue={track.name ?? `音声 ${index + 1}`} disabled={disabled || track.locked}
          onBlur={event => { tooltipProps.onBlur(); const name = event.target.value.trim(); if (name && name !== track.name) onUpdate({ name }); else event.target.value = track.name ?? '' }}
          onKeyDown={event => { if (event.nativeEvent.isComposing) { event.stopPropagation(); return }; if (event.key === 'Escape') { event.currentTarget.value = track.name ?? ''; return }; event.stopPropagation(); if (event.key === 'Enter') event.currentTarget.blur() }} /></label>}
      </TooltipTarget>
      <button type="button" disabled={disabled || index === 0} onClick={() => onReorder(index - 1)}>上へ移動</button>
      <button type="button" disabled={disabled || index === count - 1} onClick={() => onReorder(index + 1)}>下へ移動</button>
      <button type="button" disabled={disabled || track.locked || count === 1} onClick={onRemove}>トラックと音声を削除</button>
      <small>{soundLabel}の指示は残ります。元に戻すで復元できます。</small>
    </ActionMenu>
  </>
}
