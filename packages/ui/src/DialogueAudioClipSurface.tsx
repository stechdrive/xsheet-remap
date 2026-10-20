import type { CSSProperties, MouseEvent, PointerEvent } from 'react'
import type { DialogueAudioAsset, DialogueAudioClip } from './dialogueAudioProject'
import { DialogueAudioWaveform } from './DialogueAudioWaveform'
import { rangeStyle } from './dialogueAudioTimelinePresentation'

export function DialogueAudioClipSurface({ clip, asset, trackId, color, selected, frameOrigin, durationFrames, lane, onPointerDown, onContextMenu }: {
  clip: DialogueAudioClip; asset: DialogueAudioAsset; trackId: string; color: string; selected: boolean
  frameOrigin: number; durationFrames: number; lane: number
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  return <button type="button" className={`dialogueAudioClipHandle ${selected ? 'isSelected' : ''} ${clip.muted ? 'isMuted' : ''}`}
    data-track-id={trackId} data-clip-id={clip.clipId} data-source-name={asset.sourceName ?? ''}
    data-frame-start={clip.timelineStartFrame} data-frame-end={clip.timelineStartFrame + clip.durationFrames - 1}
    style={{ ...rangeStyle(clip.timelineStartFrame, clip.timelineStartFrame + clip.durationFrames - 1, frameOrigin, durationFrames), top: 4 + lane * 16, '--clip-color': color } as CSSProperties}
    aria-label={`音声クリップ ${asset.sourceName ?? clip.clipId}`} aria-pressed={selected}
    onPointerDown={onPointerDown} onContextMenu={onContextMenu}>
    <span className="dialogueAudioClipName">{asset.sourceName ?? '音声'}{clip.muted ? ' · M' : ''}</span>
    <DialogueAudioWaveform asset={asset} clip={clip} color={color} frameOrigin={clip.timelineStartFrame} durationFrames={clip.durationFrames} />
    <span className="dialogueAudioClipEdge isStart" data-clip-edge="start" aria-label="クリップの開始をトリム" />
    <span className="dialogueAudioClipEdge isEnd" data-clip-edge="end" aria-label="クリップの終了をトリム" />
  </button>
}
