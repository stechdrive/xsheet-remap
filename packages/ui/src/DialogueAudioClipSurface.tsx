import { useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import type { DialogueAudioAsset, DialogueAudioClip } from './dialogueAudioProject'
import { DialogueAudioWaveform } from './DialogueAudioWaveform'
import { rangeStyle, type DialogueAudioTimelineTool } from './dialogueAudioTimelinePresentation'
import { TooltipTarget } from './Tooltip'

export function DialogueAudioClipSurface({ clip, asset, trackId, color, selected, linkedHighlight = false, frameOrigin, durationFrames, lane, tool, locked, onPointerDown, onContextMenu }: {
  clip: DialogueAudioClip; asset: DialogueAudioAsset; trackId: string; color: string; selected: boolean
  linkedHighlight?: boolean
  frameOrigin: number; durationFrames: number; lane: number
  tool: DialogueAudioTimelineTool; locked: boolean
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  const [edge, setEdge] = useState<string | undefined>()
  const help = locked ? 'トラックをロック中。編集するにはロックを解除'
    : tool === 'razor' ? 'クリック位置で分割。Shift+クリックでロックされていない全トラックを分割'
    : tool === 'range' ? 'ドラッグで時間範囲を選択'
    : edge ? `ドラッグで${edge === 'start' ? '開始' : '終了'}をトリム。元の音声は保持。Escで取消`
    : 'ドラッグで移動、両端でトリム。Shift+クリックで追加選択。Alt+←/→で1F移動（Shift併用で5F）、右クリックで操作メニュー'
  return <TooltipTarget label={`${asset.sourceName ?? '音声'} · ${clip.timelineStartFrame}–${clip.timelineStartFrame + clip.durationFrames - 1}F。${help}`}>
    {tooltipProps => <button {...tooltipProps} type="button" className={`dialogueAudioClipHandle ${selected ? 'isSelected' : ''} ${linkedHighlight ? 'isLinkedHighlight' : ''} ${clip.muted ? 'isMuted' : ''}`}
    data-linked-highlight={linkedHighlight}
    data-track-id={trackId} data-clip-id={clip.clipId} data-source-name={asset.sourceName ?? ''}
    data-frame-start={clip.timelineStartFrame} data-frame-end={clip.timelineStartFrame + clip.durationFrames - 1}
    style={{ ...rangeStyle(clip.timelineStartFrame, clip.timelineStartFrame + clip.durationFrames - 1, frameOrigin, durationFrames), top: 4 + lane * 16, '--clip-color': color } as CSSProperties}
    aria-label={`音声クリップ ${asset.sourceName ?? clip.clipId}`} aria-pressed={selected}
    data-tool={tool} data-locked={locked}
    onPointerMove={event => { if (!event.buttons) setEdge((event.target as HTMLElement).dataset.clipEdge) }}
    onPointerDown={event => { tooltipProps.onPointerDown(); onPointerDown(event) }} onContextMenu={onContextMenu}>
    <span className="dialogueAudioClipName">{asset.sourceName ?? '音声'}{clip.muted ? ' · M' : ''}</span>
    <DialogueAudioWaveform asset={asset} clip={clip} color={color} frameOrigin={clip.timelineStartFrame} durationFrames={clip.durationFrames} />
    <span className="dialogueAudioClipEdge isStart" data-clip-edge="start" aria-label="クリップの開始をトリム" />
    <span className="dialogueAudioClipEdge isEnd" data-clip-edge="end" aria-label="クリップの終了をトリム" />
    </button>}
  </TooltipTarget>
}
