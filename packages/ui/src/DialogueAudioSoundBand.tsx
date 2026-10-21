import type { TimedRangeCue } from '@xsheet-remap/core'
import type { DialogueAudioTimelineProps } from './dialogueAudioTimelinePresentation'
import { rangeStyle } from './dialogueAudioTimelinePresentation'
import { usePointerDragSession } from './usePointerDragSession'
import { TooltipTarget } from './Tooltip'

export function DialogueAudioSoundBand({ cues, selected, frameOrigin, durationFrames, cutEnd, pixelsPerFrame, disabled, onSelect, onEdit, onTransform }: {
  cues: TimedRangeCue[]; selected: string | null; frameOrigin: number; durationFrames: number; cutEnd: number; pixelsPerFrame: number; disabled: boolean
  onSelect: (id: string) => void; onEdit: (id: string) => void; onTransform: DialogueAudioTimelineProps['onSoundCueTransform']
}) {
  const lanes = [...new Set(cues.map(cue => cue.laneId))]
  const drag = usePointerDragSession<{ pointerId: number; cue: TimedRangeCue; clientX: number; edge?: string; start: number; end: number }>({
    onUpdate: (session, point) => {
      const delta = Math.round((point.clientX - session.clientX) / pixelsPerFrame), cue = session.cue
      if (session.edge === 'start') return { ...session, start: Math.max(frameOrigin, Math.min(cue.frameEnd, cue.frameStart + delta)) }
      if (session.edge === 'end') return { ...session, end: Math.min(cutEnd, Math.max(cue.frameStart, cue.frameEnd + delta)) }
      const start = Math.max(frameOrigin, Math.min(cutEnd - (cue.frameEnd - cue.frameStart), cue.frameStart + delta))
      return { ...session, start, end: start + cue.frameEnd - cue.frameStart }
    },
    onFinish: (session, finish) => {
      if (!finish.cancelled && (session.start !== session.cue.frameStart || session.end !== session.cue.frameEnd)) onTransform(session.cue.cueId, { laneId: session.cue.laneId, frameStart: session.start, frameEnd: session.end }, 'resize-cue')
    },
  })
  return <div className="dialogueAudioSoundBand" style={{ height: soundBandHeight(cues) }} aria-label="SOUND収録区間">
    {!cues.length && <small>クリップを選択して「SOUNDへ割付」</small>}
    {cues.map(cue => {
      const current = drag.active?.cue.cueId === cue.cueId ? { ...cue, frameStart: drag.active.start, frameEnd: drag.active.end } : cue
      return <TooltipTarget key={cue.cueId} label={`SOUND ${cue.label || '名称なし'}：${current.frameStart}–${current.frameEnd}F。ドラッグで収録区間を移動、両端で範囲を変更。ダブルクリックで音響指示を編集`}>
        {tooltipProps => <button {...tooltipProps} type="button" className={`dialogueAudioSoundLabel ${selected === cue.cueId ? 'isSelected' : ''}`}
        style={{ ...rangeStyle(current.frameStart, current.frameEnd, frameOrigin, durationFrames), top: 3 + lanes.indexOf(cue.laneId) * 24 }}
        aria-label={`SOUND ${cue.label || '名称なし'} ${current.frameStart}–${current.frameEnd}F`} onClick={() => onSelect(cue.cueId)} onDoubleClick={() => onEdit(cue.cueId)}
        onPointerDown={event => { tooltipProps.onPointerDown(); if (disabled || event.button !== 0) return; event.preventDefault(); onSelect(cue.cueId); drag.begin({ pointerId: event.pointerId, cue, clientX: event.clientX, edge: (event.target as HTMLElement).dataset.soundEdge, start: cue.frameStart, end: cue.frameEnd }, event.currentTarget) }}>
        <span className="dialogueAudioClipEdge isStart" data-sound-edge="start" />{cue.label || '名称なし'}<span className="dialogueAudioClipEdge isEnd" data-sound-edge="end" />
      </button>}
      </TooltipTarget>
    })}
  </div>
}
export function soundBandHeight(cues: TimedRangeCue[]) { return Math.max(1, new Set(cues.map(cue => cue.laneId)).size) * 24 + 6 }
