import { type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { TimedRangeCue } from '@xsheet-remap/core'
import { synchronizeDialogueBindingsAfterAudioEdit } from './dialogueAudioBinding'
import { moveDialogueClips, trimDialogueAudioClip } from './dialogueAudioCommands'
import type { DialogueAudioClip, DialogueAudioCutState } from './dialogueAudioProject'
import type { DialogueAudioSelectionFocus } from './dialogueAudioContextMenuModel'
import type { DialogueAudioSelectionState } from './dialogueAudioSelectionModel'
import { clipSelectionForIds } from './dialogueAudioTimelinePresentation'
import { usePointerDragSession } from './usePointerDragSession'
import { useTouchLongPress } from './useTouchLongPress'

interface ClipGesture {
  pointerId: number; state: DialogueAudioCutState; trackId: string; destination: string
  clipIds: string[]; clip: DialogueAudioClip; edge?: 'start' | 'end'
  clientX: number; scrollLeft: number; pixelsPerFrame: number; delta: number
}

export function useDialogueAudioClipDrag(options: {
  cutState: DialogueAudioCutState; soundCues: TimedRangeCue[]; activeRevisionId: string; frameOrigin: number
  recording: boolean; playing: boolean; touchAdditiveSelection: boolean; audioSelectionState: DialogueAudioSelectionState
  timelineScrollerRef: RefObject<HTMLDivElement | null>; getPixelsPerFrame: () => number
  fitTimelineActive: () => boolean; onDisableFitTimeline: (pixelsPerFrame: number) => void
  onSelection: (selection: DialogueAudioSelectionFocus | null) => void; onActivateTrack: (trackId: string) => void
  onCommit: (cutState: DialogueAudioCutState) => boolean; onStatus: (message: string) => void
  snap?: boolean; playhead?: number
}) {
  const touch = useTouchLongPress()
  function result(drag: ClipGesture) {
    try {
      const next = drag.edge
        ? trimDialogueAudioClip(drag.state, drag.trackId, drag.clip.clipId, drag.edge, (drag.edge === 'start' ? drag.clip.timelineStartFrame : drag.clip.timelineStartFrame + drag.clip.durationFrames) + drag.delta, options.frameOrigin)
        : moveDialogueClips(drag.state, drag.trackId, drag.clipIds, drag.delta, drag.destination, options.frameOrigin)
      const sync = synchronizeDialogueBindingsAfterAudioEdit(next, options.soundCues, options.activeRevisionId)
      return { cutState: sync.state, cueUpdates: sync.cueUpdates, error: '', next }
    } catch (error) {
      return { cutState: drag.state, cueUpdates: [], error: error instanceof Error ? error.message : String(error), next: null }
    }
  }
  const session = usePointerDragSession<ClipGesture>({
    onUpdate: (drag, point) => {
      const scroller = options.timelineScrollerRef.current
      if (scroller) {
        const rect = scroller.getBoundingClientRect()
        if (rect.width > 0) {
          scrollTimeline(scroller, point.clientX, rect)
        }
      }
      let delta = Math.round((point.clientX - drag.clientX + (scroller?.scrollLeft ?? 0) - drag.scrollLeft) / drag.pixelsPerFrame)
      const hit = document.elementsFromPoint?.(point.clientX, point.clientY).find(element => element.classList.contains('dialogueAudioTrack')) as HTMLElement | undefined
      const destination = drag.edge ? drag.trackId : hit?.dataset.trackId ?? drag.destination
      if (options.snap !== false && delta !== 0) {
        const boundaries = [options.frameOrigin, options.playhead ?? options.frameOrigin, ...drag.state.tracks.flatMap(track => track.clips.filter(clip => !drag.clipIds.includes(clip.clipId)).flatMap(clip => [clip.timelineStartFrame, clip.timelineStartFrame + clip.durationFrames]))]
        const edges = drag.edge ? [drag.edge === 'start' ? drag.clip.timelineStartFrame : drag.clip.timelineStartFrame + drag.clip.durationFrames] : [drag.clip.timelineStartFrame, drag.clip.timelineStartFrame + drag.clip.durationFrames]
        let correction = Infinity
        for (const edge of edges) for (const boundary of boundaries) if (Math.abs(boundary - edge - delta) < Math.abs(correction)) correction = boundary - edge - delta
        if (Math.abs(correction) <= Math.min(4, 8 / drag.pixelsPerFrame)) delta += correction
      }
      return { ...drag, delta, destination }
    },
    onFinish: (drag, finish) => {
      if (finish.cancelled || drag.delta === 0 && drag.destination === drag.trackId) return
      const preview = result(drag)
      if (!preview.next) { options.onStatus(preview.error); return }
      if (options.onCommit(preview.next)) {
        const track = preview.next.tracks.find(item => item.trackId === drag.destination)!
        options.onSelection(clipSelectionForIds(track, drag.clipIds))
        options.onStatus(drag.edge ? 'クリップをトリミングしました。素材の元データは保持しています。' : `${drag.clipIds.length}個のクリップを移動しました。`)
      }
    },
  })
  const drag = session.active
  const preview = drag && (drag.delta !== 0 || drag.destination !== drag.trackId) ? { ...result(drag), drag } : null
  function begin(event: ReactPointerEvent<HTMLButtonElement>, trackId: string, clip: DialogueAudioClip) {
    if (options.recording || options.playing || event.button !== 0) return
    event.stopPropagation()
    const track = options.cutState.tracks.find(item => item.trackId === trackId)
    if (!track || track.locked) { options.onStatus('音声トラックをロック解除してください。'); return }
    const edge = (event.target as HTMLElement).dataset.clipEdge as 'start' | 'end' | undefined
    const currentIds = options.audioSelectionState.entities.filter(entity => entity.kind === 'clip' && entity.trackId === trackId).map(entity => entity.id)
    const additive = event.ctrlKey || event.metaKey || event.shiftKey || (event.pointerType === 'touch' && options.touchAdditiveSelection)
    const clipIds = edge ? [clip.clipId] : additive ? currentIds.includes(clip.clipId) ? currentIds.filter(id => id !== clip.clipId) : [...currentIds, clip.clipId] : currentIds.includes(clip.clipId) ? currentIds : [clip.clipId]
    const selection = clipSelectionForIds(track, clipIds)
    options.onSelection(selection)
    if (!selection || !clipIds.includes(clip.clipId)) return
    const start = (pointerId: number, clientX: number, target: HTMLElement) => {
      const pixelsPerFrame = options.getPixelsPerFrame()
      if (options.fitTimelineActive()) options.onDisableFitTimeline(pixelsPerFrame)
      session.begin({ pointerId, state: options.cutState, trackId, destination: trackId, clipIds, clip, edge, clientX, scrollLeft: options.timelineScrollerRef.current?.scrollLeft ?? 0, pixelsPerFrame, delta: 0 }, target)
      if (options.cutState.activeTrackId !== trackId) options.onActivateTrack(trackId)
    }
    if (event.pointerType === 'touch') touch.begin(event, activation => start(activation.pointerId, activation.clientX, activation.target))
    else { event.preventDefault(); start(event.pointerId, event.clientX, event.currentTarget) }
  }
  return { begin, preview, cancel: session.cancel }
}

function scrollTimeline(scroller: HTMLDivElement, clientX: number, rect: DOMRect) {
  if (clientX > rect.right - 24) scroller.scrollLeft += 12
  else if (clientX < rect.left + 24) scroller.scrollLeft = Math.max(0, scroller.scrollLeft - 12)
}
