import { useMemo, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { TimedRangeCue } from '@xsheet-remap/core'
import { createDialogueAudioClipDragPreview } from './dialogueAudioBinding'
import { moveDialogueAudioClips } from './dialogueAudioEditing'
import type { DialogueAudioClip, DialogueAudioCutState } from './dialogueAudioProject'
import type { DialogueAudioSelectionFocus } from './dialogueAudioContextMenuModel'
import type { DialogueAudioSelectionState } from './dialogueAudioSelectionModel'
import { clipSelectionForIds } from './dialogueAudioTimelinePresentation'
import { useTouchLongPress } from './useTouchLongPress'

interface DialogueAudioClipDragSession {
  trackId: string
  clipIds: string[]
  clientX: number
  minimumOriginFrame: number
  deltaFrames: number
  pixelsPerFrame: number
}

export function useDialogueAudioClipDrag(options: {
  cutState: DialogueAudioCutState
  soundCues: TimedRangeCue[]
  activeRevisionId: string
  frameOrigin: number
  recording: boolean
  playing: boolean
  touchAdditiveSelection: boolean
  audioSelectionState: DialogueAudioSelectionState
  timelineScrollerRef: RefObject<HTMLDivElement | null>
  getPixelsPerFrame: () => number
  fitTimelineActive: () => boolean
  onDisableFitTimeline: (pixelsPerFrame: number) => void
  onSelection: (selection: DialogueAudioSelectionFocus | null) => void
  onActivateTrack: (trackId: string) => void
  onCommit: (cutState: DialogueAudioCutState) => boolean
  onStatus: (message: string) => void
}) {
  const [drag, setDrag] = useState<DialogueAudioClipDragSession | null>(null)
  const touchLongPress = useTouchLongPress()
  const preview = useMemo(
    () => drag && drag.deltaFrames !== 0
      ? createDialogueAudioClipDragPreview(
          options.cutState,
          options.soundCues,
          options.activeRevisionId,
          drag.trackId,
          drag.clipIds,
          drag.deltaFrames,
        )
      : null,
    [drag, options.activeRevisionId, options.cutState, options.soundCues],
  )

  function begin(event: ReactPointerEvent<HTMLButtonElement>, trackId: string, clip: DialogueAudioClip) {
    if (options.recording || options.playing || event.button !== 0) return
    event.stopPropagation()
    const track = options.cutState.tracks.find(item => item.trackId === trackId)
    if (!track) return
    const currentIds = options.audioSelectionState.entities
      .filter(entity => entity.kind === 'clip' && entity.trackId === trackId)
      .map(entity => entity.id)
    const additive = event.ctrlKey || event.metaKey || event.shiftKey
      || (event.pointerType === 'touch' && options.touchAdditiveSelection)
    const clipIds = additive
      ? currentIds.includes(clip.clipId)
        ? currentIds.filter(clipId => clipId !== clip.clipId)
        : [...currentIds, clip.clipId]
      : currentIds.includes(clip.clipId)
        ? currentIds
        : [clip.clipId]
    const selection = clipSelectionForIds(track, clipIds)
    options.onSelection(selection)
    if (!selection || !selection.clipIds.includes(clip.clipId)) return
    if (event.pointerType === 'touch') {
      touchLongPress.begin(event, activation => {
        start(activation.pointerId, activation.clientX, activation.target, trackId, selection)
      })
      return
    }
    start(event.pointerId, event.clientX, event.currentTarget, trackId, selection)
  }

  function start(
    pointerId: number,
    clientX: number,
    captureTarget: HTMLElement,
    trackId: string,
    selection: Extract<DialogueAudioSelectionFocus, { kind: 'clip' }>,
  ) {
    const track = options.cutState.tracks.find(item => item.trackId === trackId)
    if (!track) return
    captureTarget.setPointerCapture?.(pointerId)
    const selectedClips = track.clips.filter(item => selection.clipIds.includes(item.clipId))
    const pixelsPerFrame = options.getPixelsPerFrame()
    setDrag({
      trackId,
      clipIds: selection.clipIds,
      clientX,
      minimumOriginFrame: Math.min(...selectedClips.map(item => item.timelineStartFrame)),
      deltaFrames: 0,
      pixelsPerFrame,
    })
    if (options.fitTimelineActive()) options.onDisableFitTimeline(pixelsPerFrame)
    if (options.cutState.activeTrackId !== trackId) options.onActivateTrack(trackId)
  }

  function move(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!drag) return
    const requestedDelta = Math.round((event.clientX - drag.clientX) / drag.pixelsPerFrame)
    const deltaFrames = Math.max(options.frameOrigin - drag.minimumOriginFrame, requestedDelta)
    if (deltaFrames !== drag.deltaFrames) setDrag({ ...drag, deltaFrames })

    const scroller = options.timelineScrollerRef.current
    if (!scroller) return
    autoScrollDialogueTimeline(scroller, event.clientX, drag.pixelsPerFrame)
  }

  function finish(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) {
    if (!drag) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!cancelled && drag.deltaFrames !== 0) {
      const track = options.cutState.tracks.find(item => item.trackId === drag.trackId)
      if (track) {
        const nextTrack = moveDialogueAudioClips(track, drag.clipIds, drag.deltaFrames)
        const nextCutState = {
          ...options.cutState,
          tracks: options.cutState.tracks.map(item => item.trackId === track.trackId ? nextTrack : item),
        }
        if (options.onCommit(nextCutState)) {
          options.onStatus(`${drag.clipIds.length}個の音声クリップを${Math.abs(drag.deltaFrames)}F${drag.deltaFrames < 0 ? '左' : '右'}へ移動し、リンクSOUNDを追従しました。`)
        }
      }
    }
    setDrag(null)
  }

  return { begin, move, finish, preview }
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
