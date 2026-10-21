import type { LogicalTimelineLane, TimedRangeCue } from '@xsheet-remap/core'
import type { DialogueAudioTimelineProps } from './dialogueAudioTimelinePresentation'
import { rangeStyle } from './dialogueAudioTimelinePresentation'
import { usePointerDragSession } from './usePointerDragSession'
import { TooltipTarget } from './Tooltip'
import { SOUND_LIST_HEADER_HEIGHT, SOUND_LIST_ROW_HEIGHT, soundListHeight } from './dialogueAudioSoundView'

export function DialogueAudioSoundBand({ cues, lanes, sectionLabel, expanded, selected, frameOrigin, durationFrames, cutEnd, pixelsPerFrame, disabled, onSelect, onEdit, onTransform, onPreview }: {
  cues: TimedRangeCue[]; selected: string | null; frameOrigin: number; durationFrames: number; cutEnd: number; pixelsPerFrame: number; disabled: boolean
  lanes: LogicalTimelineLane[]; sectionLabel: string; expanded: boolean; onPreview: (cue: TimedRangeCue | null) => void
  onSelect: (id: string) => void; onEdit: (id: string) => void; onTransform: DialogueAudioTimelineProps['onSoundCueTransform']
}) {
  const drag = usePointerDragSession<{ pointerId: number; cue: TimedRangeCue; clientX: number; edge?: string; start: number; end: number }>({
    onUpdate: (session, point) => {
      const delta = Math.round((point.clientX - session.clientX) / pixelsPerFrame), cue = session.cue
      const start = session.edge === 'start' ? Math.max(frameOrigin, Math.min(cue.frameEnd, cue.frameStart + delta))
        : session.edge === 'end' ? cue.frameStart : Math.max(frameOrigin, Math.min(cutEnd - (cue.frameEnd - cue.frameStart), cue.frameStart + delta))
      const end = session.edge === 'end' ? Math.min(cutEnd, Math.max(cue.frameStart, cue.frameEnd + delta))
        : session.edge === 'start' ? cue.frameEnd : start + cue.frameEnd - cue.frameStart
      onPreview({ ...cue, frameStart: start, frameEnd: end })
      return { ...session, start, end }
    },
    onFinish: (session, finish) => {
      onPreview(null)
      if (!finish.cancelled && (session.start !== session.cue.frameStart || session.end !== session.cue.frameEnd)) onTransform(session.cue.cueId, { laneId: session.cue.laneId, frameStart: session.start, frameEnd: session.end }, 'resize-cue')
    },
  })
  return <div className="dialogueAudioSoundBand" style={{ height: soundListHeight(lanes, expanded) }} aria-label={`${sectionLabel}の指示区間`}>
    <div className="dialogueAudioSoundSummary">{cues.length ? `${cues.length}区間` : `クリップを選択して「${sectionLabel}へ割付」`}</div>
    {expanded && lanes.map(lane => <div key={lane.laneId} className="dialogueAudioSoundRow" data-sound-lane-id={lane.laneId} />)}
    {expanded && cues.map(cue => {
      const current = drag.active?.cue.cueId === cue.cueId ? { ...cue, frameStart: drag.active.start, frameEnd: drag.active.end } : cue
      const laneIndex = lanes.findIndex(lane => lane.laneId === cue.laneId)
      return <TooltipTarget key={cue.cueId} label={`${sectionLabel}・${lanes[laneIndex]?.label ?? ''}・${cue.label || '名称なし'}：${current.frameStart}–${current.frameEnd}F。ドラッグで指示区間を移動、両端で範囲を変更。ダブルクリックで指示を編集`}>
        {tooltipProps => <button {...tooltipProps} type="button" className={`dialogueAudioSoundLabel ${selected === cue.cueId ? 'isSelected' : ''}`}
        data-sound-lane-id={cue.laneId}
        style={{ ...rangeStyle(current.frameStart, current.frameEnd, frameOrigin, durationFrames), top: SOUND_LIST_HEADER_HEIGHT + 2 + laneIndex * SOUND_LIST_ROW_HEIGHT }}
        aria-label={`${sectionLabel} ${cue.label || '名称なし'} ${current.frameStart}–${current.frameEnd}F`} onClick={() => onSelect(cue.cueId)} onDoubleClick={() => onEdit(cue.cueId)}
        onPointerDown={event => { tooltipProps.onPointerDown(); if (disabled || event.button !== 0) return; event.preventDefault(); onSelect(cue.cueId); drag.begin({ pointerId: event.pointerId, cue, clientX: event.clientX, edge: (event.target as HTMLElement).dataset.soundEdge, start: cue.frameStart, end: cue.frameEnd }, event.currentTarget) }}>
        <span className="dialogueAudioClipEdge isStart" data-sound-edge="start" />{cue.label || '名称なし'}<span className="dialogueAudioClipEdge isEnd" data-sound-edge="end" />
      </button>}
      </TooltipTarget>
    })}
  </div>
}
