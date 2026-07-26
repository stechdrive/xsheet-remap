import {
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { transformDialogueRegionInterval } from './dialogueAudioEditing'
import { createDialogueRegionFromCandidates } from './dialogueAudioBinding'
import type {
  DialogueAudioCutState,
  DialogueAudioTrackState,
} from './dialogueAudioProject'
import { usePointerDragSession } from './usePointerDragSession'

export interface DialogueAudioSegmentDragTarget {
  kind: 'candidate' | 'region'
  id: string
  frameStart: number
  frameEnd: number
}

export interface DialogueAudioSegmentDragSession extends DialogueAudioSegmentDragTarget {
  pointerId: number
  trackId: string
  mode: 'start' | 'body' | 'end'
  clientX: number
  pixelsPerFrame: number
  frameOrigin: number
  frameEndLimit: number
  originFrameStart: number
  originFrameEnd: number
  previewFrameStart: number
  previewFrameEnd: number
  moved: boolean
}

interface UseDialogueAudioSegmentDragOptions {
  cutState: DialogueAudioCutState
  frameOrigin: number
  getPixelsPerFrame: () => number
  getFrameEnd: () => number
  disabled: boolean
  timelineScrollerRef: RefObject<HTMLDivElement | null>
  onSelect: (
    track: DialogueAudioTrackState,
    target: DialogueAudioSegmentDragTarget,
    additive: boolean,
  ) => void
  onDragStart: () => void
  onCommit: (
    preview: DialogueAudioCutState,
    session: DialogueAudioSegmentDragSession,
  ) => void
}

export function useDialogueAudioSegmentDrag(options: UseDialogueAudioSegmentDragOptions) {
  const suppressClickRef = useRef(false)
  const suppressClickTimerRef = useRef<number | null>(null)
  const drag = usePointerDragSession<DialogueAudioSegmentDragSession>({
    onUpdate: (current, point) => {
      const delta = Math.round((point.clientX - current.clientX) / current.pixelsPerFrame)
      let frameStart = current.originFrameStart
      let rangeFrameEnd = current.originFrameEnd
      if (current.mode === 'start') {
        frameStart = Math.max(current.frameOrigin, Math.min(rangeFrameEnd, frameStart + delta))
      } else if (current.mode === 'end') {
        rangeFrameEnd = Math.min(current.frameEndLimit, Math.max(frameStart, rangeFrameEnd + delta))
      } else {
        const duration = rangeFrameEnd - frameStart
        frameStart = Math.max(current.frameOrigin, Math.min(current.frameEndLimit - duration, frameStart + delta))
        rangeFrameEnd = frameStart + duration
      }
      const next = frameStart === current.previewFrameStart && rangeFrameEnd === current.previewFrameEnd
        ? current
        : {
            ...current,
            previewFrameStart: frameStart,
            previewFrameEnd: rangeFrameEnd,
            moved: frameStart !== current.originFrameStart || rangeFrameEnd !== current.originFrameEnd,
      }
      const scroller = options.timelineScrollerRef.current
      if (scroller) autoScrollDialogueTimeline(scroller, point.clientX, next.pixelsPerFrame)
      return next
    },
    onFinish: (finalSession, finish) => {
      suppressClickRef.current = true
      if (suppressClickTimerRef.current !== null) window.clearTimeout(suppressClickTimerRef.current)
      suppressClickTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false
        suppressClickTimerRef.current = null
      }, 0)
      if (!finish.cancelled && finalSession.moved) {
        const finalPreview = createSegmentDragPreview(options.cutState, finalSession)
        if (finalPreview) options.onCommit(finalPreview, finalSession)
      }
    },
  })

  useEffect(() => {
    return () => {
      if (suppressClickTimerRef.current !== null) window.clearTimeout(suppressClickTimerRef.current)
    }
  }, [])

  const preview = useMemo(
    () => drag.active?.moved ? createSegmentDragPreview(options.cutState, drag.active) : null,
    [drag.active, options.cutState],
  )

  function begin(
    event: ReactPointerEvent<HTMLButtonElement>,
    track: DialogueAudioTrackState,
    target: DialogueAudioSegmentDragTarget,
  ) {
    if (options.disabled || event.button !== 0 || drag.activeRef.current) return
    event.preventDefault()
    event.stopPropagation()
    const edge = (event.target as HTMLElement).closest<HTMLElement>('[data-segment-edge]')?.dataset.segmentEdge
    const next: DialogueAudioSegmentDragSession = {
      ...target,
      pointerId: event.pointerId,
      trackId: track.trackId,
      mode: edge === 'start' || edge === 'end' ? edge : 'body',
      clientX: event.clientX,
      pixelsPerFrame: options.getPixelsPerFrame(),
      frameOrigin: options.frameOrigin,
      frameEndLimit: options.getFrameEnd(),
      originFrameStart: target.frameStart,
      originFrameEnd: target.frameEnd,
      previewFrameStart: target.frameStart,
      previewFrameEnd: target.frameEnd,
      moved: false,
    }
    drag.begin(next, event.currentTarget)
    options.onSelect(track, target, event.ctrlKey || event.metaKey || event.shiftKey)
    options.onDragStart()
  }

  return {
    begin,
    preview,
    suppressClick: () => suppressClickRef.current,
  }
}

function autoScrollDialogueTimeline(
  scroller: HTMLDivElement,
  clientX: number,
  pixelsPerFrame: number,
) {
  const rect = scroller.getBoundingClientRect()
  if (clientX > rect.right - 32) scroller.scrollLeft += Math.max(12, pixelsPerFrame * 2)
  else if (clientX < rect.left + 32) scroller.scrollLeft = Math.max(0, scroller.scrollLeft - Math.max(12, pixelsPerFrame * 2))
}

function createSegmentDragPreview(
  cutState: DialogueAudioCutState,
  session: DialogueAudioSegmentDragSession,
) {
  let state = cutState
  let regionId = session.id
  if (session.kind === 'candidate') {
    const created = createDialogueRegionFromCandidates(state, session.trackId, [session.id])
    if (!created) return null
    state = created.state
    regionId = created.region.regionId
  }
  return transformDialogueRegionInterval(
    state,
    session.trackId,
    regionId,
    session.previewFrameStart,
    session.previewFrameEnd,
  )
}
