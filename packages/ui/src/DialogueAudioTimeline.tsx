import { DialogueAudioCache } from './dialogueAudioCache'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { TimedRangeCue } from '@xsheet-remap/core'
import {
  addDialogueAudioClip,
  copyDialogueAudioClips,
  copyDialogueAudioRange,
  ignoreDialogueSpeechCandidate,
  insertDialogueAudioSilence,
  moveDialogueRegionAudioToFrame,
  moveDialogueAnchors,
  nextUniqueId,
  normalizeDialogueAudioRange,
  pasteDialogueAudioClipboard,
  reconcileDialogueSpeechCandidates,
  removeDialogueAudioClips,
  restoreDialogueSpeechCandidate,
  rippleDeleteDialogueAudioRange,
  silenceDialogueAudioRange,
  type DialogueAudioClipboard,
  type DialogueAudioRange,
} from './dialogueAudioEditing'
import {
  audioBufferFromPcm,
  blobToDataUrl,
  decodeAudioBlob,
  decodeAudioDataUrl,
  durationFramesForAudio,
  normalizeDetectedDialogueSpeech,
  pcmToWavBlob,
  slicePcmForDialogueScrub,
  summarizeDialogueWaveform,
  type PcmAudio,
} from './dialogueAudioEngine'
import {
  analyzeDialogueAudioWithSileroVad,
  type DialogueSileroAnalysis,
  type DialogueVadEngineStatus,
} from './dialogueAudioSileroVad'
import {
  applyDialogueSoundBindingCommand,
  bindingForRegion,
  bindingForCandidate,
  bindingForCue,
  createDialogueRegionFromCandidates,
  removeDialogueAudioRegion,
  resolveDialogueBinding,
  resolveDialogueRegion,
  synchronizeDialogueBindingsAfterAudioEdit,
  synchronizeDialogueBindingsFromCues,
  unlinkDialogueAudioCue,
  unlinkDialogueAudioRegion,
} from './dialogueAudioBinding'
import {
  pruneUnusedDialogueAudioAssets,
  type DialogueAudioAsset,
  type DialogueAudioClip,
  type DialogueAudioCutState,
  type DialogueAudioTrackState,
  type DialogueRegion,
  type DialogueSpeechCandidate,
} from './dialogueAudioProject'
import {
  DIALOGUE_AUDIO_TRACK_HEIGHT_PRESETS,
  clampDialogueAudioPanelHeight,
  clampDialogueAudioPixelsPerFrame,
  clampDialogueAudioTrackHeight,
  dialogueAudioContentEndFrame,
  dialogueAudioPixelsPerFrameFromZoomSlider,
  dialogueAudioZoomSliderValue,
  effectiveDialogueAudioPixelsPerFrame,
  ensureDialogueAudioTimelineDuration,
  fitDialogueAudioPixelsPerFrame,
  loadDialogueAudioViewPreferences,
  planDialogueAudioClipPlayback,
  saveDialogueAudioViewPreferences,
  type DialogueAudioTrackHeightPreset,
} from './dialogueAudioTimelineModel'
import {
  dialogueAudioContextCommands,
  resolveDialogueAudioContextTarget,
  type DialogueAudioContextCommand,
  type DialogueAudioContextTarget,
  type DialogueAudioSelectionFocus,
} from './dialogueAudioContextMenuModel'
import {
  applyDialogueAudioMarqueeSelection,
  collectDialogueAudioMarqueeEntities,
  dialogueAudioSelectionContains,
  dialogueAudioSelectionFrameRange,
  EMPTY_DIALOGUE_AUDIO_SELECTION,
  reconcileDialogueAudioSelection,
  replaceDialogueAudioSelection,
  toggleDialogueAudioSelectionEntity,
  type DialogueAudioSelectionState,
} from './dialogueAudioSelectionModel'
import {
  AudioImportIcon,
  candidateHitStyle,
  candidatePresentation,
  candidateSelection,
  clipSelectionForIds,
  contextCommandLabel,
  contextMenuAriaLabel,
  contextMenuTitle,
  dialogueAudioClipHandleLane,
  dialogueAudioSelectionSummary,
  DialogueSpeechSegmentButton,
  type DialogueAudioTimelineProps,
  DialogueAudioTimelineBoundaryMarker as TimelineBoundaryMarker,
  DialogueAudioTimeRuler as TimeRuler,
  dialogueVadEngineLabel as vadEngineLabel,
  dialogueVadResultSuffix as vadResultSuffix,
  formatDialogueAudioFrame as formatFrame,
  mergeDialogueAudioRanges as mergeRanges,
  RangeToolIcon,
  rangeStyle,
  resolveDialogueAudioSelectionFocus,
  SelectionToolIcon,
  stopDialogueAudioSources as stopSources,
  timelineMarqueeStyle,
  type DialogueAudioTimelineGesture,
  type DialogueAudioTimelineTool,
} from './dialogueAudioTimelinePresentation'
import { ActionMenu } from './AppControls'
import { DialogueAudioIcon } from './DialogueAudioIcons'
import { DialogueAudioClipSurface } from './DialogueAudioClipSurface'
import { DialogueAudioInspector } from './DialogueAudioInspector'
import { DialogueAudioTrackControls } from './DialogueAudioTrackControls'
import { DialogueAudioSoundBand, soundBandHeight } from './DialogueAudioSoundBand'
import { addDialogueAudioTrack, removeDialogueAudioTrack, reorderDialogueAudioTrack, splitDialogueAudioClips, moveDialogueClips, isDialogueTrackAudible } from './dialogueAudioCommands'
import { DialogueAudioTouchControls, dialogueAudioContextTargetForSelection } from './DialogueAudioTouchControls'
import { Tooltip, TooltipTarget } from './Tooltip'
import { useDialogueAudioClipDrag } from './useDialogueAudioClipDrag'
import {
  useDialogueAudioSegmentDrag,
  type DialogueAudioSegmentDragSession,
} from './useDialogueAudioSegmentDrag'
import { usePointerDragSession } from './usePointerDragSession'

const SCRUB_EDGE_FADE_SECONDS = 0.001
const TIME_RULER_HEIGHT = 40
const CONTEXT_MENU_EDGE = 8
const CONTEXT_MENU_WIDTH = 260
const TIMELINE_DRAG_THRESHOLD = 4

export function DialogueAudioTimeline(props: DialogueAudioTimelineProps) {
  const {
    cutState, fps, frameOrigin, activeRevisionId, soundCues, selectedSoundCueId, soundCueNavigationRequest,
    onCutStateChange, onPlayheadChange, onSoundCueSelect, onSoundCueEdit, onSoundCueTransform,
    canUndo = false, canRedo = false, onUndo = () => undefined, onRedo = () => undefined,
    onSoundCandidateEdit, onAutoCreateDialogueRegions, onCutDurationChange,
    audioSelection: controlledAudioSelection, onAudioSelectionChange, onWorkspaceFocus,
  } = props
  const cutDurationFrames = Math.max(1, props.cutDurationFrames ?? props.durationFrames ?? 144)
  const [collapsed, setCollapsed] = useState(true)
  const [playheadFrame, setPlayheadFrame] = useState(frameOrigin)
  const [viewPreferences, setViewPreferences] = useState(loadDialogueAudioViewPreferences)
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(720)
  const [playing, setPlaying] = useState(false)
  const [recording, setRecording] = useState(false)
  const [localAudioSelectionState, setLocalAudioSelectionState] = useState<DialogueAudioSelectionState>(EMPTY_DIALOGUE_AUDIO_SELECTION)
  const audioSelectionState = controlledAudioSelection ?? localAudioSelectionState
  const setAudioSelectionState = useCallback((update: SetStateAction<DialogueAudioSelectionState>) => {
    const next = typeof update === 'function' ? update(audioSelectionState) : update
    if (next === audioSelectionState) return
    if (controlledAudioSelection === undefined) setLocalAudioSelectionState(next)
    onAudioSelectionChange?.(next)
  }, [audioSelectionState, controlledAudioSelection, onAudioSelectionChange])
  const [timelineTool, setTimelineTool] = useState<DialogueAudioTimelineTool>('select')
  const [snap, setSnap] = useState(true)
  const [showCandidates, setShowCandidates] = useState(true)
  const [inputModality, setInputModality] = useState<'mouse' | 'pen' | 'touch'>('mouse')
  const [touchAdditiveSelection, setTouchAdditiveSelection] = useState(false)
  const [silenceFrameCount, setSilenceFrameCount] = useState(1)
  const [clipboard, setClipboard] = useState<DialogueAudioClipboard | null>(null)
  const clipboardAssetsRef = useRef<DialogueAudioAsset[]>([])
  const [vadEngine, setVadEngine] = useState<{ status: DialogueVadEngineStatus; error?: string }>({ status: 'idle' })
  const [contextMenu, setContextMenu] = useState<{
    anchorX: number
    anchorY: number
    x: number
    y: number
    target: DialogueAudioContextTarget
  } | null>(null)
  const [pendingSoundRequest, setPendingSoundRequest] = useState<{
    trackId: string
    candidates: DialogueSpeechCandidate[]
    frameStart: number
    frameEnd: number
    requiredCutDuration: number
    awaitingCutUpdate: boolean
  } | null>(null)
  const [panelResize, setPanelResize] = useState<{ startY: number; startHeight: number } | null>(null)
  const [trackResize, setTrackResize] = useState<{ trackId: string; startY: number; startHeight: number } | null>(null)
  const [status, setStatus] = useState('')
  const touchTimelineTapRef = useRef<{
    pointerId: number; trackId: string
    startX: number
    startY: number
    clientX: number; clientY: number
  } | null>(null)
  const timelineScrollerRef = useRef<HTMLDivElement | null>(null)
  const {
    begin: beginClipDrag,
    cancel: cancelClipDrag,
    preview: clipDragDisplay,
  } = useDialogueAudioClipDrag({
    cutState,
    soundCues,
    activeRevisionId,
    frameOrigin,
    recording,
    playing,
    touchAdditiveSelection,
    audioSelectionState,
    timelineScrollerRef,
    getPixelsPerFrame: () => pixelsPerFrame,
    fitTimelineActive: () => viewPreferences.fitTimeline,
    onDisableFitTimeline: value => setViewPreferences(current => ({ ...current, fitTimeline: false, pixelsPerFrame: value })),
    onSelection: setSelectionFromFocus,
    onActivateTrack: trackId => onCutStateChange({ cutState: { ...cutState, activeTrackId: trackId }, recordHistory: false }),
    onCommit: commitCutState,
    onStatus: setStatus,
    snap,
    playhead: playheadFrame,
  })
  const {
    begin: beginSegmentDrag,
    preview: segmentDragDisplay,
    suppressClick: suppressSegmentClick,
  } = useDialogueAudioSegmentDrag({
    cutState,
    frameOrigin,
    getPixelsPerFrame: () => pixelsPerFrame,
    getFrameEnd: () => frameEnd,
    disabled: recording || playing || timelineTool !== 'select',
    touchAdditiveSelection,
    timelineScrollerRef,
    onSelect: selectSegmentEntity,
    onDragStart: () => {
      if (viewPreferences.fitTimeline) {
        setViewPreferences(current => ({ ...current, fitTimeline: false, pixelsPerFrame }))
      }
    },
    onCommit: commitSegmentDrag,
  })
  const displayCutState = segmentDragDisplay ?? clipDragDisplay?.cutState ?? cutState
  const audioContentFrameEnd = dialogueAudioContentEndFrame(displayCutState)
  const audioContentDurationFrames = audioContentFrameEnd === null ? 0 : audioContentFrameEnd - frameOrigin + 1
  const timelineDurationFrames = Math.max(cutDurationFrames, cutState.timelineDurationFrames, audioContentDurationFrames)
  const cutStateRef = useRef(cutState)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourcesRef = useRef<AudioBufferSourceNode[]>([])
  const playbackRequestRef = useRef(0)
  const scrubSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const scrubRequestRef = useRef(0)
  const scrubDragRef = useRef<{ pointerId: number; lastFrame: number } | null>(null)
  const animationRef = useRef<number | null>(null)
  const playSessionRef = useRef<{ contextStart: number; frameStart: number; frameEnd: number } | null>(null)
  const recorderRef = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startFrame: number; trackId: string } | null>(null)
  const decodedRef = useRef(new DialogueAudioCache())
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const pendingImportRef = useRef<{ trackId: string; frame: number } | null>(null)
  const timelineContentRef = useRef<HTMLDivElement | null>(null)
  const timelineHeaderRef = useRef<HTMLElement | null>(null)
  const fittedPixelsPerFrame = fitDialogueAudioPixelsPerFrame(timelineViewportWidth, timelineDurationFrames)
  const pixelsPerFrame = effectiveDialogueAudioPixelsPerFrame(viewPreferences, timelineViewportWidth, timelineDurationFrames)
  const zoomSliderValue = dialogueAudioZoomSliderValue(pixelsPerFrame, fittedPixelsPerFrame)
  const timelineWidth = Math.max(timelineViewportWidth, timelineDurationFrames * pixelsPerFrame)
  const frameEnd = frameOrigin + timelineDurationFrames - 1
  const cutFrameEnd = frameOrigin + cutDurationFrames - 1
  const activeTrack = cutState.tracks.find(track => track.trackId === cutState.activeTrackId) ?? cutState.tracks[0]
  const contextTrack = contextMenu
    ? cutState.tracks.find(track => track.trackId === ('trackId' in contextMenu.target ? contextMenu.target.trackId : cutState.activeTrackId)) ?? activeTrack
    : null
  const selectedCue = soundCues.find(cue => cue.cueId === selectedSoundCueId) ?? null
  const selectedCueBinding = selectedCue ? bindingForCue(cutState, selectedCue.cueId, activeRevisionId) : undefined
  const linkedHighlightRegionKeys = new Set(
    selectedCueBinding?.members.map(member => `${member.regionRef.trackId}:${member.regionRef.regionId}`) ?? [],
  )
  const audioSelection = resolveDialogueAudioSelectionFocus(audioSelectionState, cutState)
  const selectedCandidateRefs = audioSelectionState.entities.filter(entity => entity.kind === 'candidate')
  const selectedRegionRefs = audioSelectionState.entities.filter(entity => entity.kind === 'region')
  const selectedCandidateIds = selectedCandidateRefs
    .filter(entity => entity.trackId === activeTrack?.trackId)
    .map(entity => entity.id)
  const selectedCandidates = activeTrack?.speechCandidates.filter(candidate => selectedCandidateIds.includes(candidate.candidateId)) ?? []
  const selectedCandidate = selectedCandidates[0] ?? null
  const selectedRegions = activeTrack?.dialogueRegions.filter(region =>
    selectedRegionRefs.some(entity => entity.trackId === activeTrack.trackId && entity.id === region.regionId)) ?? []
  const selectedFrameRange = dialogueAudioSelectionFrameRange(audioSelectionState, cutState)
  const timelineGestureDrag = usePointerDragSession<DialogueAudioTimelineGesture>({
    onUpdate: (current, point) => {
      const moved = current.moved || Math.hypot(
        point.clientX - current.startClientX,
        point.clientY - current.startClientY,
      ) >= TIMELINE_DRAG_THRESHOLD
      const next = {
        ...current,
        currentClientX: point.clientX,
        currentClientY: point.clientY,
        moved,
      }
      if (!moved) return next
      const frame = frameForClientX(point.clientX)
      const range = normalizeDialogueAudioRange(current.anchorFrame, frame)
      if (current.tool === 'range') {
        setAudioSelectionState({
          entities: current.initialSelection.entities,
          timeRange: { trackId: current.trackId, ...range },
        })
      } else {
        const trackIds = tracksIntersectingMarquee(current.startClientY, point.clientY)
        const hits = collectDialogueAudioMarqueeEntities(cutState, trackIds, range)
        setAudioSelectionState(applyDialogueAudioMarqueeSelection(
          current.initialSelection,
          hits,
          current.additive,
        ))
      }
      return next
    },
    onFinish: (current, finish) => {
      if (finish.cancelled) {
        setAudioSelectionState(current.initialSelection)
      } else if (!current.moved) {
        if (current.tool === 'range') {
          setAudioSelectionState({ entities: current.initialSelection.entities, timeRange: null })
        } else if (!current.additive) {
          clearAudioFocus()
        }
        setPlayhead(frameForClientX(finish.clientX))
      }
    },
  })
  const timelineGesture = timelineGestureDrag.active
  const marqueeStyle = timelineGesture?.moved && timelineGesture.tool === 'select'
    ? timelineMarqueeStyle(timelineGesture, TIME_RULER_HEIGHT)
    : null

  useEffect(() => {
    cutStateRef.current = cutState
  }, [cutState])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setAudioSelectionState(current => reconcileDialogueAudioSelection(current, cutState))
    })
    return () => { cancelled = true }
  }, [cutState, setAudioSelectionState])

  useEffect(() => {
    saveDialogueAudioViewPreferences(viewPreferences)
  }, [viewPreferences])

  useEffect(() => {
    if (!status || recording) return
    const timeout = window.setTimeout(() => setStatus(''), 3600)
    return () => window.clearTimeout(timeout)
  }, [recording, status])

  useEffect(() => {
    const scroller = timelineScrollerRef.current
    if (!scroller || typeof ResizeObserver === 'undefined') return
    const updateWidth = () => setTimelineViewportWidth(Math.max(1, scroller.clientWidth))
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [collapsed])

  useEffect(() => {
    if (!pendingSoundRequest?.awaitingCutUpdate || cutDurationFrames < pendingSoundRequest.requiredCutDuration) return
    const request = pendingSoundRequest
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setPendingSoundRequest(null)
      onSoundCandidateEdit(
        request.trackId,
        request.candidates.map(candidate => candidate.candidateId),
        request.frameStart,
        request.frameEnd,
      )
    })
    return () => { cancelled = true }
  }, [cutDurationFrames, onSoundCandidateEdit, pendingSoundRequest])

  useEffect(() => {
    if (!panelResize) return
    const move = (event: PointerEvent) => {
      const maximum = Math.max(180, window.innerHeight - 96)
      const height = clampDialogueAudioPanelHeight(panelResize.startHeight + panelResize.startY - event.clientY, maximum)
      setViewPreferences(current => ({ ...current, panelHeight: height }))
    }
    const finish = () => setPanelResize(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
    window.addEventListener('pointercancel', finish, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  }, [panelResize])

  useEffect(() => {
    if (!trackResize) return
    const move = (event: PointerEvent) => {
      const height = clampDialogueAudioTrackHeight(trackResize.startHeight + event.clientY - trackResize.startY)
      setViewPreferences(current => ({ ...current, trackHeights: { ...current.trackHeights, [trackResize.trackId]: height } }))
    }
    const finish = () => setTrackResize(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
    window.addEventListener('pointercancel', finish, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  }, [trackResize])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [contextMenu])

  useLayoutEffect(() => {
    const menu = contextMenuRef.current
    if (!contextMenu || !menu) return
    const width = menu.offsetWidth || CONTEXT_MENU_WIDTH
    const height = menu.offsetHeight || 120
    const x = Math.max(CONTEXT_MENU_EDGE, Math.min(window.innerWidth - width - CONTEXT_MENU_EDGE, contextMenu.anchorX))
    const y = contextMenu.anchorY + height <= window.innerHeight - CONTEXT_MENU_EDGE
      ? Math.max(CONTEXT_MENU_EDGE, contextMenu.anchorY)
      : Math.max(CONTEXT_MENU_EDGE, contextMenu.anchorY - height)
    if (x !== contextMenu.x || y !== contextMenu.y) setContextMenu(current => current ? { ...current, x, y } : current)
  }, [contextMenu])

  const publishedPlayhead = useRef<{ frame: number; listener: typeof onPlayheadChange } | null>(null)
  const setPlayhead = useCallback((frame: number) => {
    const liveFrameEnd = frameOrigin + Math.max(cutDurationFrames, cutStateRef.current.timelineDurationFrames) - 1
    const next = Math.max(frameOrigin, Math.min(liveFrameEnd, Math.round(frame)))
    if (publishedPlayhead.current?.frame === next && publishedPlayhead.current.listener === onPlayheadChange) return
    publishedPlayhead.current = { frame: next, listener: onPlayheadChange }
    setPlayheadFrame(next)
    onPlayheadChange(next)
  }, [cutDurationFrames, frameOrigin, onPlayheadChange])

  const consumedSoundCueNavigationRequestRef = useRef(0)
  useEffect(() => {
    if (!soundCueNavigationRequest || soundCueNavigationRequest.requestId === consumedSoundCueNavigationRequestRef.current) return
    const cue = soundCues.find(item => item.cueId === soundCueNavigationRequest.cueId)
    if (!cue || !bindingForCue(cutState, cue.cueId, activeRevisionId)) return
    consumedSoundCueNavigationRequestRef.current = soundCueNavigationRequest.requestId
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      stopSources(sourcesRef.current)
      stopSources(scrubSourcesRef.current)
      sourcesRef.current = []
      scrubSourcesRef.current = []
      scrubRequestRef.current += 1
      playSessionRef.current = null
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current)
      animationRef.current = null
      setPlaying(false)
      setPlayhead(cue.frameStart)
    })
    return () => { cancelled = true }
  }, [activeRevisionId, cutState, setPlayhead, soundCueNavigationRequest, soundCues])

  useEffect(() => { decodedRef.current.retain(cutState.assets) }, [cutState.assets])

  useEffect(() => () => {
    decodedRef.current.clear()
    playbackRequestRef.current += 1
    stopSources(sourcesRef.current)
    stopSources(scrubSourcesRef.current)
    scrubRequestRef.current += 1
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current)
    recorderRef.current?.stream.getTracks().forEach(track => track.stop())
    void audioContextRef.current?.close()
  }, [])

  function audioContext(): AudioContext {
    const current = audioContextRef.current
    if (current && current.state !== 'closed') return current
    const next = new AudioContext()
    audioContextRef.current = next
    return next
  }

  async function decodedAsset(asset: DialogueAudioAsset, context: AudioContext): Promise<PcmAudio> {
    return decodedRef.current.getOrDecode(asset, () => decodeAudioDataUrl(asset.audioDataUrl, context))
  }

  function stopPlayback(updateFrame = true) {
    playbackRequestRef.current += 1
    const session = playSessionRef.current
    const context = audioContextRef.current
    if (updateFrame && session && context) {
      setPlayhead(session.frameStart + (context.currentTime - session.contextStart) * fps)
    }
    stopSources(sourcesRef.current)
    sourcesRef.current = []
    playSessionRef.current = null
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current)
    animationRef.current = null
    setPlaying(false)
  }

  function stopScrubPlayback() {
    scrubRequestRef.current += 1
    stopSources(scrubSourcesRef.current)
    scrubSourcesRef.current = []
  }

  async function startPlayback(fromFrame = playheadFrame, omitTrackId?: string) {
    stopScrubPlayback()
    stopPlayback(false)
    const requestId = playbackRequestRef.current
    const context = audioContext()
    await context.resume()
    if (requestId !== playbackRequestRef.current) return
    const state = cutStateRef.current
    const requestedStart = fromFrame
    const playbackEnd = frameOrigin + Math.max(cutDurationFrames, state.timelineDurationFrames) - 1
    const restartAtOrigin = !recorderRef.current && requestedStart >= playbackEnd
    const playbackStart = Math.max(frameOrigin, Math.min(playbackEnd, restartAtOrigin ? frameOrigin : requestedStart))
    const assetById = new Map(state.assets.map(asset => [asset.assetId, asset]))
    const sources: AudioBufferSourceNode[] = []
    const clipRequests: Array<{ clip: DialogueAudioClip; asset: DialogueAudioAsset }> = []
    for (const track of state.tracks) {
      if (track.trackId === omitTrackId || !isDialogueTrackAudible(state, track)) continue
      for (const clip of track.clips) {
        if (clip.muted) continue
        const clipEnd = clip.timelineStartFrame + clip.durationFrames - 1
        if (clipEnd < playbackStart || clip.timelineStartFrame > playbackEnd) continue
        const asset = assetById.get(clip.assetId)
        if (!asset) continue
        clipRequests.push({ clip, asset })
      }
    }
    const decoded = await Promise.all(clipRequests.map(async request => {
      try {
        return { ...request, audio: await decodedAsset(request.asset, context) }
      } catch {
        return null
      }
    }))
    if (requestId !== playbackRequestRef.current || cutStateRef.current !== state) return
    const startAt = context.currentTime + 0.05
    let failedClipCount = decoded.filter(request => request === null).length
    const buffers = new Map<PcmAudio, AudioBuffer>()
    for (const request of decoded) {
      if (!request) continue
      const segment = planDialogueAudioClipPlayback(request.clip, playbackStart, playbackEnd, fps, {
        sampleLength: request.audio.samples.length,
        sampleRate: request.audio.sampleRate,
      })
      if (!segment) {
        failedClipCount += 1
        continue
      }
      try {
        const source = context.createBufferSource()
        let buffer = buffers.get(request.audio)
        if (!buffer) { buffer = audioBufferFromPcm(context, request.audio); buffers.set(request.audio, buffer) }
        source.buffer = buffer
        source.connect(context.destination)
        source.start(startAt + segment.delaySeconds, segment.sourceOffsetSeconds, segment.durationSeconds)
        sources.push(source)
      } catch {
        failedClipCount += 1
      }
    }
    if (failedClipCount > 0) setStatus(`${failedClipCount}個の音声クリップを再生できませんでした。`)
    sourcesRef.current = sources
    playSessionRef.current = { contextStart: startAt, frameStart: playbackStart, frameEnd: playbackEnd }
    setPlayhead(playbackStart)
    setPlaying(true)
    tickPlayback()
  }

  function tickPlayback() {
    const session = playSessionRef.current
    const context = audioContextRef.current
    if (!session || !context) return
    const next = session.frameStart + Math.max(0, context.currentTime - session.contextStart) * fps
    if (next > session.frameEnd + 0.5) {
      if (recorderRef.current) {
        const extension = Math.max(Math.ceil(fps * 10), 1)
        session.frameEnd += extension
        const state = cutStateRef.current
        const requiredDuration = session.frameEnd - frameOrigin + 1
        if (requiredDuration > state.timelineDurationFrames) {
          const extended = { ...state, timelineDurationFrames: requiredDuration }
          cutStateRef.current = extended
          onCutStateChange({ cutState: extended, recordHistory: false })
        }
        setPlayhead(next)
        animationRef.current = requestAnimationFrame(tickPlayback)
      } else {
        setPlayhead(session.frameEnd)
        stopPlayback(false)
      }
      return
    }
    setPlayhead(next)
    animationRef.current = requestAnimationFrame(tickPlayback)
  }

  async function playDialogueScrub(previousFrame: number, nextFrame: number) {
    const direction = nextFrame < previousFrame ? -1 : nextFrame > previousFrame ? 1 : 0
    if (direction === 0 || typeof AudioContext === 'undefined') return
    const state = cutStateRef.current
    const audibleTracks = state.tracks.filter(track => isDialogueTrackAudible(state, track))
    if (!audibleTracks.some(track => track.clips.length > 0)) {
      stopScrubPlayback()
      return
    }

    // Scrub feedback must match the destination project frame exactly; do not audition future frames.
    const windowStart = nextFrame
    const windowEnd = nextFrame
    const assetById = new Map(state.assets.map(asset => [asset.assetId, asset]))
    const clips = audibleTracks.flatMap(track => track.clips.flatMap(clip => {
      const clipEnd = clip.timelineStartFrame + clip.durationFrames - 1
      const intersectionStart = Math.max(windowStart, clip.timelineStartFrame)
      const intersectionEnd = Math.min(windowEnd, clipEnd)
      const asset = assetById.get(clip.assetId)
      return !clip.muted && asset && intersectionEnd >= intersectionStart
        ? [{ asset, clip, intersectionStart, intersectionEnd }]
        : []
    }))
    if (clips.length === 0) {
      stopScrubPlayback()
      return
    }

    const requestId = scrubRequestRef.current + 1
    scrubRequestRef.current = requestId
    stopSources(scrubSourcesRef.current)
    scrubSourcesRef.current = []
    const context = audioContext()
    await context.resume()
    const decoded = await Promise.all(clips.map(async item => ({ ...item, audio: await decodedAsset(item.asset, context) })))
    if (requestId !== scrubRequestRef.current) return

    const startAt = context.currentTime + 0.008
    const sources: AudioBufferSourceNode[] = []
    decoded.forEach(({ audio, clip, intersectionStart, intersectionEnd }) => {
      const frameCount = intersectionEnd - intersectionStart + 1
      const sourceFrameStart = clip.sourceOffsetFrames + intersectionStart - clip.timelineStartFrame
      const sliced = slicePcmForDialogueScrub(audio, sourceFrameStart, frameCount, fps, direction < 0)
      if (sliced.samples.length === 0) return
      const source = context.createBufferSource()
      const gain = context.createGain()
      const delayFrames = direction > 0 ? intersectionStart - windowStart : windowEnd - intersectionEnd
      const sourceStart = startAt + delayFrames / Math.max(1, fps)
      const durationSeconds = sliced.samples.length / sliced.sampleRate
      const fadeSeconds = Math.min(SCRUB_EDGE_FADE_SECONDS, durationSeconds / 3)
      source.buffer = audioBufferFromPcm(context, sliced)
      source.connect(gain)
      gain.connect(context.destination)
      gain.gain.setValueAtTime(0, sourceStart)
      gain.gain.linearRampToValueAtTime(0.88, sourceStart + fadeSeconds)
      gain.gain.setValueAtTime(0.88, Math.max(sourceStart + fadeSeconds, sourceStart + durationSeconds - fadeSeconds))
      gain.gain.linearRampToValueAtTime(0, sourceStart + durationSeconds)
      source.onended = () => {
        source.disconnect()
        gain.disconnect()
      }
      source.start(sourceStart)
      sources.push(source)
    })
    scrubSourcesRef.current = sources
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.recorder.stop()
      return
    }
    if (vadEngine.status === 'loading') return
    if (!activeTrack || activeTrack.locked) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setStatus('この環境ではマイク録音を利用できません。')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      recorder.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data) }
      recorder.onstop = () => void finishRecording(recorder.mimeType, chunks, playheadFrame, stream, activeTrack.trackId)
      recorderRef.current = { recorder, stream, chunks, startFrame: playheadFrame, trackId: activeTrack.trackId }
      recorder.start(100)
      setRecording(true)
      setStatus('パンチイン録音中。ほかのトラックは再生されます。')
      void startPlayback(playheadFrame, activeTrack.trackId)
    } catch (error) {
      setStatus(`録音を開始できませんでした: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function finishRecording(mimeType: string, chunks: Blob[], startFrame: number, stream: MediaStream, trackId: string) {
    stream.getTracks().forEach(item => item.stop())
    recorderRef.current = null
    setRecording(false)
    stopPlayback()
    if (chunks.length === 0) {
      setStatus('録音データがありませんでした。')
      return
    }
    try {
      const recorded = await decodeAudioBlob(new Blob(chunks, { type: mimeType }), audioContext())
      const analysis = await addAudioAssetClip(recorded, startFrame, trackId, 'マイク録音', true)
      setPlayhead(startFrame + Math.max(0, durationFramesForAudio(recorded, fps) - 1))
      const normalizationMessage = analysis?.speechRanges.length
        ? `検出した${analysis.speechRanges.length}区間をノーマライズしました。`
        : '検出区間がないため音量は変更していません。'
      setStatus(`録音を非破壊クリップとして反映しました。${normalizationMessage}${vadResultSuffix(analysis)}`)
    } catch (error) {
      setStatus(`録音を処理できませんでした: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function addAudioAssetClip(
    audio: PcmAudio,
    timelineStartFrame: number,
    trackId: string,
    sourceName: string,
    normalizeDetectedSpeech = false,
    original?: Blob,
  ): Promise<DialogueSileroAnalysis | undefined> {
    const current = cutStateRef.current
    const track = current.tracks.find(item => item.trackId === trackId)
    if (!track || track.locked) throw new Error('取り込み先の音声トラックをロック解除してください。')
    const duration = durationFramesForAudio(audio, fps)
    const usedAssetIds = new Set(current.assets.map(asset => asset.assetId))
    const usedClipIds = new Set(current.tracks.flatMap(item => item.clips.map(clip => clip.clipId)))
    const assetId = nextUniqueId('dialogue-asset', usedAssetIds)
    const clipId = nextUniqueId(`${trackId}-clip`, usedClipIds)
    const audioDataUrl = await blobToDataUrl(original ?? pcmToWavBlob(audio))
    const asset: DialogueAudioAsset = { assetId, audioDataUrl, durationFrames: duration, waveform: summarizeDialogueWaveform(audio.samples, 1024), sourceName }
    const clip: DialogueAudioClip = { clipId, placementId: clipId, assetId, timelineStartFrame, sourceOffsetFrames: 0, durationFrames: duration }
    decodedRef.current.set(assetId, { dataUrl: audioDataUrl, audio })
    const nextTrack = addDialogueAudioClip(track, clip)
    const waveformState: DialogueAudioCutState = {
      ...current,
      timelineDurationFrames: Math.max(current.timelineDurationFrames, timelineStartFrame + duration - frameOrigin),
      assets: [...current.assets, asset],
      tracks: current.tracks.map(item => item.trackId === trackId ? nextTrack : item),
    }
    commitCutState(waveformState)
    if (track.vadMode === 'off') return

    setStatus(`${sourceName}の波形を反映しました。セリフ区間を解析しています…`)
    const analysis = await analyzeSpeech(audio, timelineStartFrame, waveformState)
    let latest = cutStateRef.current
    if (normalizeDetectedSpeech && analysis.speechRanges.length > 0) {
      const normalized = normalizeDetectedDialogueSpeech(audio, analysis.speechRanges, timelineStartFrame, fps)
      const normalizedDataUrl = await blobToDataUrl(pcmToWavBlob(normalized))
      const normalizedAsset = {
        ...asset,
        audioDataUrl: normalizedDataUrl,
        waveform: summarizeDialogueWaveform(normalized.samples, 1024),
      }
      decodedRef.current.set(assetId, { dataUrl: normalizedDataUrl, audio: normalized })
      latest = {
        ...latest,
        assets: latest.assets.map(item => item.assetId === assetId ? normalizedAsset : item),
      }
      cutStateRef.current = latest
      onCutStateChange({ cutState: latest, recordHistory: false })
    }
    const latestTrack = latest.tracks.find(item => item.trackId === trackId)
    const currentClip = latestTrack?.clips.find(item => item.clipId === clipId)
    if (!latestTrack || !currentClip) return analysis
    const currentClipRange = {
      frameStart: currentClip.timelineStartFrame,
      frameEnd: currentClip.timelineStartFrame + currentClip.durationFrames - 1,
    }
    const detectedRanges = analysis.speechRanges.flatMap(detected => {
      const mappedStart = currentClip.timelineStartFrame + detected.frameStart - timelineStartFrame - currentClip.sourceOffsetFrames
      const mappedEnd = currentClip.timelineStartFrame + detected.frameEnd - timelineStartFrame - currentClip.sourceOffsetFrames
      const frameStart = Math.max(currentClipRange.frameStart, mappedStart)
      const frameEnd = Math.min(currentClipRange.frameEnd, mappedEnd)
      return frameEnd >= frameStart ? [{ frameStart, frameEnd }] : []
    })
    const analyzedCandidates = reconcileDialogueSpeechCandidates(
      latestTrack.speechCandidates,
      detectedRanges,
      trackId,
      {
        placementId: currentClip.placementId,
        assetId: currentClip.assetId,
        timelineStartFrame: currentClip.timelineStartFrame,
        sourceOffsetFrames: currentClip.sourceOffsetFrames,
        sourceFrameStart: currentClip.sourceOffsetFrames,
        sourceFrameEnd: currentClip.sourceOffsetFrames + currentClip.durationFrames - 1,
      },
    )
    const analyzedTrack = {
      ...latestTrack,
      speechCandidates: analyzedCandidates,
    }
    let analyzedState: DialogueAudioCutState = {
      ...latest,
      tracks: latest.tracks.map(item => item.trackId === trackId ? analyzedTrack : item),
    }
    if (track.vadMode === 'auto-region') {
      const previousIds = new Set(latestTrack.speechCandidates.map(candidate => candidate.candidateId))
      const candidateIds = analyzedTrack.speechCandidates.filter(candidate => candidate.status === 'pending' && !previousIds.has(candidate.candidateId)).map(candidate => candidate.candidateId)
      analyzedState = onAutoCreateDialogueRegions(analyzedState, trackId, candidateIds)
    }
    commitCutState(analyzedState, false)
    return analysis
  }

  async function importAudio(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    const target = pendingImportRef.current ?? (activeTrack ? { trackId: activeTrack.trackId, frame: playheadFrame } : null)
    pendingImportRef.current = null
    if (!file || !target) return
    try {
      const audio = await decodeAudioBlob(file, audioContext())
      const original = /\.(wav|mp3)$/i.test(file.name) ? new Blob([file], { type: /\.mp3$/i.test(file.name) ? 'audio/mpeg' : 'audio/wav' }) : undefined
      const analysis = await addAudioAssetClip(audio, target.frame, target.trackId, file.name, false, original)
      setStatus(`${file.name}を${target.frame}Fへ読み込みました。${vadResultSuffix(analysis)}`)
    } catch (error) {
      setStatus(`音声を読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function requestAudioImport(trackId: string, frame: number) {
    pendingImportRef.current = { trackId, frame }
    fileInputRef.current?.click()
  }

  function updateTrack(trackId: string, updates: Partial<DialogueAudioTrackState>, recordHistory = true) {
    const next = { ...cutState, tracks: cutState.tracks.map(track => track.trackId === trackId ? { ...track, ...updates } : track) }
    if (recordHistory) commitCutState(next)
    else {
      cutStateRef.current = next
      onCutStateChange({ cutState: next, recordHistory: false })
    }
  }

  function runClipCommand(command: () => DialogueAudioCutState) {
    try { const next = command(); return next === cutState || commitCutState(next) }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); return false }
  }

  function splitAtPlayhead(allTracks = false) {
    const selected = audioSelectionState.entities.filter(entity => entity.kind === 'clip').map(entity => entity.id)
    const ids = allTracks ? cutState.tracks.filter(track => !track.locked).flatMap(track => track.clips.map(clip => clip.clipId))
      : selected.length ? selected : activeTrack?.clips.map(clip => clip.clipId) ?? []
    runClipCommand(() => splitDialogueAudioClips(cutState, ids, Math.round(playheadFrame)))
  }

  function rippleDeleteSelectedClips(selection: Extract<DialogueAudioSelectionFocus, { kind: 'clip' }>) {
    applyTrackEditTo(selection.trackId, track => {
      const ranges = mergeRanges(track.clips.filter(clip => selection.clipIds.includes(clip.clipId)).map(clip => ({
        frameStart: clip.timelineStartFrame, frameEnd: clip.timelineStartFrame + clip.durationFrames - 1,
      })))
      return ranges.reverse().reduce((next, range) => rippleDeleteDialogueAudioRange(next, range), track)
    }, '選択クリップをリップル削除し、後続音声を詰めました。')
    clearAudioFocus()
  }

  function commitCutState(nextInput: DialogueAudioCutState, recordHistory = true): boolean {
    if (cutState.tracks.some(track => track.locked && (!nextInput.tracks.some(item => item.trackId === track.trackId) || JSON.stringify(track.clips) !== JSON.stringify(nextInput.tracks.find(item => item.trackId === track.trackId)?.clips)))) {
      setStatus('音声トラックをロック解除してください。')
      return false
    }
    const synchronized = synchronizeDialogueBindingsAfterAudioEdit(
      pruneUnusedDialogueAudioAssets(nextInput),
      soundCues,
      activeRevisionId,
    )
    const next = ensureDialogueAudioTimelineDuration(
      synchronized.state,
      frameOrigin,
      1,
    )
    const accepted = onCutStateChange({
      cutState: next,
      cueUpdates: synchronized.cueUpdates,
      recordHistory,
    })
    if (accepted === false) return false
    cutStateRef.current = next
    return true
  }

  function applyTrackEditTo(trackId: string, edit: (track: DialogueAudioTrackState) => DialogueAudioTrackState, message: string) {
    const source = cutState.tracks.find(track => track.trackId === trackId)
    if (!source || source.locked) { setStatus('音声トラックをロック解除してください。'); return }
    const nextTrack = edit(source)
    if (commitCutState({ ...cutState, tracks: cutState.tracks.map(track => track.trackId === trackId ? nextTrack : track) })) {
      setStatus(message)
    }
  }

  function insertSilence(frameCount = silenceFrameCount) {
    if (!activeTrack) return
    insertSilenceAt(activeTrack.trackId, playheadFrame, frameCount)
  }

  function insertSilenceAt(trackId: string, frame: number, frameCount = silenceFrameCount) {
    applyTrackEditTo(
      trackId,
      track => insertDialogueAudioSilence(track, frame, frameCount),
      `${frame}Fへ無音${frameCount}フレームを挿入しました。`,
    )
  }

  function rippleDelete(rangeInput?: DialogueAudioRange & { trackId: string }) {
    const range = rangeInput
      ?? { frameStart: playheadFrame, frameEnd: playheadFrame, trackId: activeTrack?.trackId ?? '' }
    if (!range.trackId) return
    applyTrackEditTo(
      range.trackId,
      track => rippleDeleteDialogueAudioRange(track, range),
      `${range.frameStart}–${range.frameEnd}Fを削除し、後続音声とリンクSOUNDを詰めました。`,
    )
    clearAudioFocus()
  }

  function silenceSelection() {
    if (audioSelection) silenceRange(audioSelection)
  }

  function silenceRange(range: DialogueAudioRange & { trackId: string }) {
    applyTrackEditTo(range.trackId, track => silenceDialogueAudioRange(track, range), `${range.frameStart}–${range.frameEnd}Fを無音化しました。リンク済みSOUNDは確認待ちとして残します。`)
  }

  function copySelection(cut: boolean) {
    if (!audioSelection) return
    if (audioSelection.kind === 'clip') copyClipSelection(audioSelection, cut)
    else copyRange(audioSelection, cut)
  }

  function copyRange(range: DialogueAudioRange & { trackId: string }, cut: boolean) {
    const track = cutState.tracks.find(item => item.trackId === range.trackId)
    if (!track) return
    setClipboard(copyDialogueAudioRange(track, range))
    clipboardAssetsRef.current = cutState.assets
    if (cut) silenceRange(range)
    setStatus(`${range.frameStart}–${range.frameEnd}Fを${cut ? '切り取り' : 'コピー'}しました。`)
  }

  function copyClipSelection(selection: Extract<DialogueAudioSelectionFocus, { kind: 'clip' }>, cut: boolean) {
    const track = cutState.tracks.find(item => item.trackId === selection.trackId)
    if (!track) return
    const copied = copyDialogueAudioClips(track, selection.clipIds)
    if (!copied) return
    setClipboard(copied)
    clipboardAssetsRef.current = cutState.assets
    if (cut) deleteClipSelection(selection)
    setStatus(`${selection.clipIds.length}個の音声クリップを${cut ? '切り取り' : 'コピー'}しました。`)
  }

  function deleteClipSelection(selection: Extract<DialogueAudioSelectionFocus, { kind: 'clip' }>) {
    applyTrackEditTo(
      selection.trackId,
      track => removeDialogueAudioClips(track, selection.clipIds),
      `${selection.clipIds.length}個の音声クリップを削除しました。`,
    )
    clearAudioFocus()
  }

  function pasteClipboard(mode: 'overwrite' | 'insert') {
    if (!clipboard || !activeTrack) return
    pasteClipboardAt(activeTrack.trackId, playheadFrame, mode)
  }

  function pasteClipboardAt(trackId: string, frame: number, mode: 'overwrite' | 'insert') {
    if (!clipboard) return
    const track = cutState.tracks.find(item => item.trackId === trackId)
    if (!track || track.locked) { setStatus('音声トラックをロック解除してください。'); return }
    const nextTrack = pasteDialogueAudioClipboard(track, clipboard, frame, mode)
    const assets = [...cutState.assets, ...clipboardAssetsRef.current.filter(asset => !cutState.assets.some(item => item.assetId === asset.assetId))]
    if (commitCutState({ ...cutState, assets, tracks: cutState.tracks.map(item => item === track ? nextTrack : item) })) setStatus(`${frame}Fへ${mode === 'insert' ? '挿入' : '上書き'}貼り付けしました。`)
  }

  async function redetectTrack(trackId: string, range?: DialogueAudioRange, clipIds?: string[]) {
    const sourceTrack = cutState.tracks.find(track => track.trackId === trackId)
    if (!sourceTrack?.clips.length) return
    try {
      setVadEngine({ status: 'loading' })
      const assetById = new Map(cutState.assets.map(asset => [asset.assetId, asset]))
      const selectedClipIds = clipIds ? new Set(clipIds) : null
      let candidates = sourceTrack.speechCandidates
      let detectedCount = 0
      let lastAnalysis: DialogueSileroAnalysis | undefined
      for (const clip of sourceTrack.clips) {
        if (selectedClipIds && !selectedClipIds.has(clip.clipId)) continue
        const clipFrameEnd = clip.timelineStartFrame + clip.durationFrames - 1
        if (range && (clipFrameEnd < range.frameStart || clip.timelineStartFrame > range.frameEnd)) continue
        const asset = assetById.get(clip.assetId)
        if (!asset) continue
        const audio = await decodedAsset(asset, audioContext())
        const timelineStart = range ? Math.max(range.frameStart, clip.timelineStartFrame) : clip.timelineStartFrame
        const timelineEnd = range ? Math.min(range.frameEnd, clipFrameEnd) : clipFrameEnd
        const clipOffset = timelineStart - clip.timelineStartFrame
        const durationFrames = timelineEnd - timelineStart + 1
        const sourceStart = Math.round((clip.sourceOffsetFrames + clipOffset) * audio.sampleRate / fps)
        const sourceEnd = Math.min(audio.samples.length, Math.round((clip.sourceOffsetFrames + clipOffset + durationFrames) * audio.sampleRate / fps))
        const analysis = await analyzeSpeech(
          { samples: audio.samples.slice(sourceStart, sourceEnd), sampleRate: audio.sampleRate },
          timelineStart,
          cutState,
        )
        lastAnalysis = analysis
        detectedCount += analysis.speechRanges.length
        candidates = reconcileDialogueSpeechCandidates(
          candidates,
          mergeRanges(analysis.speechRanges),
          sourceTrack.trackId,
          {
            placementId: clip.placementId,
            assetId: clip.assetId,
            timelineStartFrame: timelineStart,
            sourceOffsetFrames: clip.sourceOffsetFrames + clipOffset,
            sourceFrameStart: clip.sourceOffsetFrames + clipOffset,
            sourceFrameEnd: clip.sourceOffsetFrames + clipOffset + durationFrames - 1,
          },
        )
      }
      updateTrack(sourceTrack.trackId, { speechCandidates: candidates })
      setStatus(`${detectedCount}区間を再検出しました。処理済みラベルと重なった別クリップは保持しています。${vadResultSuffix(lastAnalysis)}`)
    } catch (error) {
      setStatus(`再検出に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function analyzeSpeech(audio: PcmAudio, timelineStartFrame: number, state: DialogueAudioCutState): Promise<DialogueSileroAnalysis> {
    setVadEngine({ status: 'loading' })
    const analysis = await analyzeDialogueAudioWithSileroVad(
      audio.samples,
      audio.sampleRate,
      fps,
      timelineStartFrame,
      state.detectionPreset,
      state.detectionStability,
      state.detectionSensitivity,
    )
    setVadEngine({ status: analysis.engine, error: analysis.error })
    return analysis
  }

  function createSoundFromSelection() {
    const refs = audioSelectionState.entities.filter(entity => entity.kind === 'clip').map(entity => ({ trackId: entity.trackId, clipId: entity.id }))
    if (refs.length) {
      const clips = refs.flatMap(ref => cutState.tracks.find(track => track.trackId === ref.trackId)?.clips.filter(clip => clip.clipId === ref.clipId) ?? [])
      if (clips.length) onSoundCandidateEdit(refs[0].trackId, [], Math.min(...clips.map(clip => clip.timelineStartFrame)), Math.max(...clips.map(clip => clip.timelineStartFrame + clip.durationFrames - 1)), selectedCue?.cueId, refs)
      return
    }
    if (!activeTrack) return
    if (selectedCue && (selectedRegionRefs.length > 0 || selectedCandidateRefs.length > 0)) {
      addSelectedSpeechToSelectedCue()
      return
    }
    if (selectedRegions.length === 1) {
      openDialogueRegion(activeTrack, selectedRegions[0].regionId)
      return
    }
    let candidates = selectedCandidates
    if (candidates.length === 0 && audioSelection?.kind === 'range' && audioSelection.trackId === activeTrack.trackId) {
      const usedIds = new Set(activeTrack.speechCandidates.map(item => item.candidateId))
      const candidate: DialogueSpeechCandidate = {
        candidateId: nextUniqueId(`${activeTrack.trackId}-candidate-manual`, usedIds),
        frameStart: audioSelection.frameStart,
        frameEnd: audioSelection.frameEnd,
        status: 'pending',
      }
      updateTrack(activeTrack.trackId, { speechCandidates: [...activeTrack.speechCandidates, candidate] })
      setAudioSelectionState(replaceDialogueAudioSelection([{
        kind: 'candidate',
        trackId: activeTrack.trackId,
        id: candidate.candidateId,
      }]))
      candidates = [candidate]
    }
    if (candidates.length === 0) return
    openCandidateSound(activeTrack.trackId, candidates)
  }

  function addSelectedSpeechToSelectedCue() {
    if (!selectedCue) return
    let nextState = cutState
    const regionRefs = selectedRegionRefs.map(entity => ({ trackId: entity.trackId, regionId: entity.id }))
    const candidateIdsByTrack = new Map<string, string[]>()
    for (const entity of selectedCandidateRefs) {
      candidateIdsByTrack.set(entity.trackId, [...(candidateIdsByTrack.get(entity.trackId) ?? []), entity.id])
    }
    for (const [trackId, candidateIds] of candidateIdsByTrack) {
      const created = createDialogueRegionFromCandidates(nextState, trackId, candidateIds)
      if (!created) continue
      nextState = created.state
      regionRefs.push({ trackId, regionId: created.region.regionId })
    }
    if (regionRefs.length === 0) return
    const bound = applyDialogueSoundBindingCommand(nextState, {
      type: 'add-members',
      cue: selectedCue,
      regionRefs,
      revisionId: activeRevisionId,
      soundCues,
    })
    commitCutState(synchronizeDialogueBindingsFromCues(bound, soundCues, activeRevisionId))
    setAudioSelectionState(replaceDialogueAudioSelection(regionRefs.map(ref => ({
      kind: 'region' as const,
      trackId: ref.trackId,
      id: ref.regionId,
    }))))
    setStatus(`${selectedCue.label || '名称なし'}へ音声区間${regionRefs.length}個を現在位置のまま追加しました。`)
  }

  function openDialogueRegion(track: DialogueAudioTrackState, regionId: string) {
    const region = track.dialogueRegions.find(item => item.regionId === regionId)
    if (!region) return
    const candidates = track.speechCandidates.filter(candidate => region.candidateIds.includes(candidate.candidateId))
    setAudioSelectionState(replaceDialogueAudioSelection([{
      kind: 'region',
      trackId: track.trackId,
      id: regionId,
    }]))
    const binding = bindingForRegion(cutState, { trackId: track.trackId, regionId }, activeRevisionId)
    const cue = binding ? soundCues.find(item => item.cueId === binding.cueId) : undefined
    if (cue) {
      onSoundCueSelect(cue.cueId)
      if (!candidates.length) { onSoundCueEdit(cue.cueId); return }
      onSoundCandidateEdit(
        track.trackId,
        region.candidateIds,
        region.frameStart,
        region.frameEnd,
        cue.cueId,
      )
      return
    }
    if (!candidates.length) {
      const clips = cutState.tracks.flatMap(item => item.clips.filter(clip => region.anchors.some(anchor => anchor.assetId === clip.assetId && anchor.placementId === clip.placementId)).map(clip => ({ trackId: item.trackId, clipId: clip.clipId })))
      if (clips.length) onSoundCandidateEdit(track.trackId, [], region.frameStart, region.frameEnd, undefined, clips)
      return
    }
    openCandidateSoundRange(track.trackId, candidates, region.frameStart, region.frameEnd)
  }

  function openCandidateSound(trackId: string, candidates: DialogueSpeechCandidate[]) {
    const bindings = candidates.map(candidate => bindingForCandidate(cutState, candidate.candidateId, activeRevisionId)).filter(Boolean)
    const linkedCueId = bindings.length === candidates.length && new Set(bindings.map(binding => binding?.cueId)).size === 1 ? bindings[0]?.cueId : undefined
    const cue = linkedCueId ? soundCues.find(item => item.cueId === linkedCueId) : undefined
    if (cue) {
      onSoundCueSelect(cue.cueId)
      onSoundCandidateEdit(
        trackId,
        candidates.map(candidate => candidate.candidateId),
        Math.min(...candidates.map(candidate => candidate.frameStart)),
        Math.max(...candidates.map(candidate => candidate.frameEnd)),
        cue.cueId,
      )
      return
    }
    openCandidateSoundRange(
      trackId,
      candidates,
      Math.min(...candidates.map(candidate => candidate.frameStart)),
      Math.max(...candidates.map(candidate => candidate.frameEnd)),
    )
  }

  function openCandidateSoundRange(
    trackId: string,
    candidates: DialogueSpeechCandidate[],
    frameStart: number,
    rangeFrameEnd: number,
  ) {
    if (rangeFrameEnd > cutFrameEnd) {
      setPendingSoundRequest({
        trackId,
        candidates,
        frameStart,
        frameEnd: rangeFrameEnd,
        requiredCutDuration: rangeFrameEnd - frameOrigin + 1,
        awaitingCutUpdate: false,
      })
      return
    }
    openCandidateSoundWithinCut(trackId, candidates, frameStart, rangeFrameEnd)
  }

  function openCandidateSoundWithinCut(
    trackId: string,
    candidates: DialogueSpeechCandidate[],
    frameStart = Math.min(...candidates.map(candidate => candidate.frameStart)),
    rangeFrameEnd = Math.max(...candidates.map(candidate => candidate.frameEnd)),
  ) {
    onSoundCandidateEdit(
      trackId,
      candidates.map(candidate => candidate.candidateId),
      frameStart,
      rangeFrameEnd,
    )
  }

  function confirmSoundCutExtension() {
    if (!pendingSoundRequest) return
    const request = { ...pendingSoundRequest, awaitingCutUpdate: true }
    setPendingSoundRequest(request)
    if (onCutDurationChange) onCutDurationChange(request.requiredCutDuration)
    else {
      setPendingSoundRequest(null)
      setStatus('タイムシートのカット尺を変更できないため、SOUNDへ反映できませんでした。')
    }
  }

  function beginPlayheadScrub(event: ReactPointerEvent<HTMLElement>) {
    if (recording || event.button !== 0) return
    event.preventDefault()
    if (playing) stopPlayback()
    else stopScrubPlayback()
    const frame = frameForClientX(event.clientX)
    const previousFrame = playheadFrame
    event.currentTarget.setPointerCapture(event.pointerId)
    scrubDragRef.current = { pointerId: event.pointerId, lastFrame: frame }
    focusTimeline()
    setPlayhead(frame)
    void playDialogueScrub(previousFrame, frame)
  }

  function movePlayheadScrub(event: ReactPointerEvent<HTMLElement>) {
    const drag = scrubDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const frame = frameForClientX(event.clientX)
    if (frame === drag.lastFrame) return
    scrubDragRef.current = { ...drag, lastFrame: frame }
    setPlayhead(frame)
    void playDialogueScrub(drag.lastFrame, frame)
  }

  function finishPlayheadScrub(event: ReactPointerEvent<HTMLElement>) {
    const drag = scrubDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    scrubDragRef.current = null
  }

  function handleTimelineKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 || recording) return
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"], [role="alertdialog"], [role="separator"], .actionMenuContent')) return
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (direction && (event.altKey || event.metaKey) && !event.ctrlKey) {
      event.preventDefault()
      event.stopPropagation()
      if (playing) return
      const selected = audioSelectionState.entities.filter(entity => entity.kind === 'clip')
      const clips = cutState.tracks.flatMap(track => track.clips.filter(clip => selected.some(ref => ref.trackId === track.trackId && ref.id === clip.clipId)))
      if (!clips.length) return
      const step = direction * (event.shiftKey ? 5 : 1)
      const delta = Math.max(step, frameOrigin - Math.min(...clips.map(clip => clip.timelineStartFrame)))
      runClipCommand(() => [...new Set(selected.map(ref => ref.trackId))].reduce((state, trackId) => (
        moveDialogueClips(state, trackId, selected.filter(ref => ref.trackId === trackId).map(ref => ref.id), delta, trackId, frameOrigin)
      ), cutState))
      return
    }
    if (event.ctrlKey || event.metaKey) {
      if (event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'k' && !playing) { event.preventDefault(); splitAtPlayhead(event.shiftKey) }
      else if (key === 'c' && audioSelection) {
        event.preventDefault()
        copySelection(false)
      } else if (key === 'x' && audioSelection && !playing) {
        event.preventDefault()
        copySelection(true)
      } else if (key === 'v' && clipboard && !playing) {
        event.preventDefault()
        pasteClipboard(event.shiftKey ? 'insert' : 'overwrite')
      }
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && audioSelection && !playing) {
      if (event.altKey && event.key !== 'Backspace') return
      event.preventDefault()
      event.stopPropagation()
      cancelClipDrag()
      if (event.shiftKey || event.altKey) {
        if (audioSelection.kind === 'clip') rippleDeleteSelectedClips(audioSelection)
        else rippleDelete(audioSelection)
      } else if (audioSelection.kind === 'clip') deleteClipSelection(audioSelection)
      else silenceSelection()
      return
    }
    if (event.altKey) return
    const toolKey = event.key.toLowerCase()
    if (!event.shiftKey && (toolKey === 'v' || toolKey === 'c' || toolKey === 's')) {
      event.preventDefault()
      event.stopPropagation()
      if (toolKey === 's') setSnap(value => !value)
      else setTimelineTool(toolKey === 'v' ? 'select' : 'razor')
      return
    }
    if (event.key === ' ' && !target.closest('button, summary')) {
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) { if (playing) stopPlayback(); else void startPlayback() }
      return
    }
    if (event.key === '=' || event.key === '-' || event.key === '+') {
      event.preventDefault()
      setTimelineZoom(zoomSliderValue + (event.key === '-' ? -5 : 5))
      return
    }
    if (event.key === '\\') {
      event.preventDefault()
      fitTimeline()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setAudioSelectionState(EMPTY_DIALOGUE_AUDIO_SELECTION)
      setContextMenu(null)
      return
    }
    if (!direction && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    event.stopPropagation()
    if (playing) stopPlayback()
    const nextFrame = event.key === 'Home' ? frameOrigin : event.key === 'End' ? frameEnd
      : Math.max(frameOrigin, Math.min(frameEnd, playheadFrame + direction * (event.shiftKey ? 5 : 1)))
    if (nextFrame === playheadFrame) return
    setPlayhead(nextFrame)
    void playDialogueScrub(playheadFrame, nextFrame)
  }

  function focusTimeline() {
    timelineContentRef.current?.focus({ preventScroll: true })
  }

  function setSelectionFromFocus(selection: DialogueAudioSelectionFocus | null) {
    if (!selection) {
      setAudioSelectionState(EMPTY_DIALOGUE_AUDIO_SELECTION)
      return
    }
    if (selection.kind === 'range') {
      setAudioSelectionState(current => ({ entities: current.entities, timeRange: selection }))
      return
    }
    if (selection.kind === 'clip') {
      setAudioSelectionState(replaceDialogueAudioSelection(selection.clipIds.map(id => ({
        kind: 'clip',
        trackId: selection.trackId,
        id,
      }))))
      return
    }
    if (selection.kind === 'candidate') {
      setAudioSelectionState(replaceDialogueAudioSelection(selection.candidateIds.map(id => ({
        kind: 'candidate',
        trackId: selection.trackId,
        id,
      }))))
      return
    }
    setAudioSelectionState(replaceDialogueAudioSelection([{
      kind: 'region',
      trackId: selection.trackId,
      id: selection.regionId,
    }]))
  }

  function clearAudioFocus() {
    setAudioSelectionState(EMPTY_DIALOGUE_AUDIO_SELECTION)
  }

  function beginTimelineGesture(event: ReactPointerEvent<HTMLDivElement>, trackId: string) {
    if (recording || event.button !== 0 || (timelineTool === 'select' && event.target !== event.currentTarget)) return
    if (event.pointerType === 'touch' && timelineTool === 'select') {
      touchTimelineTapRef.current = {
        pointerId: event.pointerId,
        trackId,
        startX: event.clientX,
        startY: event.clientY,
        clientX: event.clientX,
        clientY: event.clientY,
      }
      return
    }
    event.preventDefault()
    if (playing) stopPlayback()
    else stopScrubPlayback()
    const frame = frameForClientX(event.clientX)
    const contentRect = timelineContentRef.current?.getBoundingClientRect()
      ?? event.currentTarget.getBoundingClientRect()
    focusTimeline()
    if (cutState.activeTrackId !== trackId) {
      onCutStateChange({ cutState: { ...cutState, activeTrackId: trackId }, recordHistory: false })
    }
    const gesture: DialogueAudioTimelineGesture = {
      pointerId: event.pointerId,
      trackId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      anchorFrame: frame,
      moved: false,
      additive: event.ctrlKey || event.metaKey || event.shiftKey || (event.pointerType === 'touch' && touchAdditiveSelection),
      tool: timelineTool,
      initialSelection: audioSelectionState,
      contentRect: {
        left: contentRect.left,
        top: contentRect.top,
        width: contentRect.width,
        height: contentRect.height,
      },
    }
    timelineGestureDrag.begin(gesture, event.currentTarget)
  }

  function moveTouchTimelineTap(event: ReactPointerEvent<HTMLDivElement>) {
    const pending = touchTimelineTapRef.current
    if (!pending || pending.pointerId !== event.pointerId) return
    pending.clientX = event.clientX
    pending.clientY = event.clientY
    if (Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) >= 8) {
      touchTimelineTapRef.current = null
    }
  }

  function finishTouchTimelineTap(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    const pending = touchTimelineTapRef.current
    if (!pending || pending.pointerId !== event.pointerId) return
    touchTimelineTapRef.current = null
    if (cancelled) return
    focusTimeline()
    if (cutState.activeTrackId !== pending.trackId) {
      onCutStateChange({ cutState: { ...cutState, activeTrackId: pending.trackId }, recordHistory: false })
    }
    if (!touchAdditiveSelection) clearAudioFocus()
    setPlayhead(frameForClientX(pending.clientX))
  }

  function tracksIntersectingMarquee(startClientY: number, currentClientY: number): string[] {
    const rect = timelineContentRef.current?.getBoundingClientRect()
    if (!rect) return []
    const top = Math.min(startClientY, currentClientY) - rect.top
    const bottom = Math.max(startClientY, currentClientY) - rect.top
    let trackTop = TIME_RULER_HEIGHT + soundBandHeight(soundCues)
    return cutState.tracks.flatMap(track => {
      const trackBottom = trackTop + trackHeight(track.trackId)
      const intersects = top <= trackBottom && bottom >= trackTop
      trackTop = trackBottom
      return intersects ? [track.trackId] : []
    })
  }

  function frameForClientX(clientX: number): number {
    const rect = timelineContentRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return playheadFrame
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.max(frameOrigin, Math.min(frameEnd, Math.round(frameOrigin + ratio * Math.max(0, timelineDurationFrames - 1))))
  }

  function selectCandidate(event: ReactMouseEvent<HTMLButtonElement>, track: DialogueAudioTrackState, candidate: DialogueSpeechCandidate) {
    event.stopPropagation()
    if (timelineTool === 'range') return
    selectSegmentEntity(track, {
      kind: 'candidate',
      id: candidate.candidateId,
    }, event.ctrlKey || event.metaKey || event.shiftKey || touchAdditiveSelection)
  }

  function selectRegion(event: ReactMouseEvent<HTMLButtonElement>, track: DialogueAudioTrackState, region: DialogueRegion) {
    event.stopPropagation()
    if (timelineTool === 'range') return
    selectSegmentEntity(track, {
      kind: 'region',
      id: region.regionId,
    }, event.ctrlKey || event.metaKey || event.shiftKey || touchAdditiveSelection)
  }

  function selectSegmentEntity(
    track: DialogueAudioTrackState,
    entity: { kind: 'candidate' | 'region'; id: string },
    additive: boolean,
  ) {
    if (cutState.activeTrackId !== track.trackId) {
      onCutStateChange({ cutState: { ...cutState, activeTrackId: track.trackId }, recordHistory: false })
    }
    setAudioSelectionState(current => toggleDialogueAudioSelectionEntity(current, {
      kind: entity.kind,
      trackId: track.trackId,
      id: entity.id,
    }, additive))
  }

  function commitSegmentDrag(preview: DialogueAudioCutState, session: DialogueAudioSegmentDragSession) {
    const accepted = commitCutState(preview)
    if (accepted && session.kind === 'candidate') {
      const region = preview.tracks
        .find(track => track.trackId === session.trackId)
        ?.dialogueRegions.find(item => item.candidateIds.includes(session.id))
      if (region) {
        setAudioSelectionState(replaceDialogueAudioSelection([{
          kind: 'region',
          trackId: session.trackId,
          id: region.regionId,
        }]))
      }
    }
    if (accepted) {
      setStatus(`セリフ区間を${session.previewFrameStart}–${session.previewFrameEnd}Fへ変更しました。`)
    }
  }

  function fitTimeline() {
    setViewPreferences(current => ({ ...current, fitTimeline: true }))
  }

  function setTimelineZoom(value: number) {
    if (value <= 0) {
      fitTimeline()
      return
    }
    setViewPreferences(current => ({
      ...current,
      fitTimeline: false,
      pixelsPerFrame: dialogueAudioPixelsPerFrameFromZoomSlider(value, fittedPixelsPerFrame),
    }))
  }

  function resizePanelBy(delta: number) {
    const maximum = Math.max(180, window.innerHeight - 96)
    setViewPreferences(current => ({
      ...current,
      panelHeight: clampDialogueAudioPanelHeight(current.panelHeight + delta, maximum),
    }))
  }

  function handleTimelineWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
    setViewPreferences(current => ({
      ...current,
      fitTimeline: false,
      pixelsPerFrame: clampDialogueAudioPixelsPerFrame(pixelsPerFrame * factor),
    }))
  }

  function trackHeight(trackId: string): number {
    return Math.max(inputModality === 'touch' ? 72 : 52, viewPreferences.trackHeights[trackId] ?? DIALOGUE_AUDIO_TRACK_HEIGHT_PRESETS.small)
  }

  function setTrackHeightPreset(trackId: string, preset: DialogueAudioTrackHeightPreset) {
    setViewPreferences(current => ({
      ...current,
      trackHeights: { ...current.trackHeights, [trackId]: DIALOGUE_AUDIO_TRACK_HEIGHT_PRESETS[preset] },
    }))
  }

  function selectContextTarget(target: DialogueAudioContextTarget) {
    if ('trackId' in target && cutState.activeTrackId !== target.trackId) {
      onCutStateChange({ cutState: { ...cutState, activeTrackId: target.trackId }, recordHistory: false })
    }
    if (target.kind === 'empty') {
      return
    } else if (target.kind === 'range') {
      setSelectionFromFocus(target)
    } else if (target.kind === 'clip') {
      const track = cutState.tracks.find(item => item.trackId === target.trackId)
      setSelectionFromFocus(track ? clipSelectionForIds(track, target.clipIds) : null)
    } else if (target.kind === 'candidate') {
      const selectedKeys = new Set(audioSelectionState.entities
        .filter(entity => entity.kind === 'candidate' && entity.trackId === target.trackId)
        .map(entity => entity.id))
      if (target.candidateIds.length > 0 && target.candidateIds.every(candidateId => selectedKeys.has(candidateId))) return
      const track = cutState.tracks.find(item => item.trackId === target.trackId)
      const candidates = track?.speechCandidates.filter(candidate => target.candidateIds.includes(candidate.candidateId)) ?? []
      if (candidates.length > 0) {
        setSelectionFromFocus(candidateSelection(target.trackId, candidates))
      } else clearAudioFocus()
    } else if (target.kind === 'region') {
      if (dialogueAudioSelectionContains(audioSelectionState, {
        kind: 'region',
        trackId: target.trackId,
        id: target.regionId,
      })) return
      const track = cutState.tracks.find(item => item.trackId === target.trackId)
      const region = track?.dialogueRegions.find(item => item.regionId === target.regionId)
      if (region) {
        setSelectionFromFocus({
          kind: 'region',
          trackId: target.trackId,
          regionId: region.regionId,
          candidateIds: region.candidateIds,
          frameStart: region.frameStart,
          frameEnd: region.frameEnd,
        })
      }
    } else if (target.kind === 'cue') {
      onSoundCueSelect(target.cueId)
    }
  }

  function handleInputPointerDownCapture(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === 'mouse' || event.pointerType === 'pen' || event.pointerType === 'touch') {
      setInputModality(event.pointerType)
      if (event.pointerType !== 'touch') setTouchAdditiveSelection(false)
    }
    onWorkspaceFocus?.()
  }

  function openContextMenu(
    event: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>,
    hitTarget: DialogueAudioContextTarget,
  ) {
    event.preventDefault()
    event.stopPropagation()
    const frame = frameForClientX(event.clientX)
    const target = resolveDialogueAudioContextTarget(hitTarget, audioSelection, frame)
    selectContextTarget(target)
    const rect = event.currentTarget.getBoundingClientRect()
    const anchorX = event.clientX || rect.left
    const anchorY = event.clientY || rect.bottom
    setContextMenu({
      anchorX,
      anchorY,
      x: Math.max(CONTEXT_MENU_EDGE, Math.min(window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_EDGE, anchorX)),
      y: Math.max(CONTEXT_MENU_EDGE, Math.min(window.innerHeight - CONTEXT_MENU_EDGE, anchorY)),
      target,
    })
  }

  function clearTrack(trackId: string) {
    stopPlayback(false)
    const track = cutState.tracks.find(item => item.trackId === trackId)
    if (!track) return
    const withoutRegions = track.dialogueRegions.reduce(
      (state, region) => removeDialogueAudioRegion(state, trackId, region.regionId),
      cutState,
    )
    commitCutState(synchronizeDialogueBindingsFromCues({
      ...withoutRegions,
      tracks: withoutRegions.tracks.map(item => item.trackId === trackId
        ? { ...item, clips: [], speechCandidates: [], dialogueRegions: [] }
        : item),
    }, soundCues, activeRevisionId))
    clearAudioFocus()
    setStatus('トラックの音声と発話区間をクリアしました。')
  }

  function targetRange(target: DialogueAudioContextTarget): (DialogueAudioRange & { trackId: string }) | null {
    if (target.kind === 'range') {
      return { trackId: target.trackId, frameStart: target.frameStart, frameEnd: target.frameEnd }
    }
    if (target.kind === 'region') {
      const track = cutState.tracks.find(item => item.trackId === target.trackId)
      const region = track?.dialogueRegions.find(item => item.regionId === target.regionId)
      return region ? { trackId: target.trackId, frameStart: region.frameStart, frameEnd: region.frameEnd } : null
    }
    return null
  }

  function createSoundForTarget(target: DialogueAudioContextTarget) {
    if (target.kind === 'candidate') {
      const track = cutState.tracks.find(item => item.trackId === target.trackId)
      const candidates = track?.speechCandidates.filter(candidate => target.candidateIds.includes(candidate.candidateId)) ?? []
      if (candidates.length > 0) openCandidateSound(target.trackId, candidates)
      return
    }
    if (target.kind === 'region') {
      const track = cutState.tracks.find(item => item.trackId === target.trackId)
      if (track) openDialogueRegion(track, target.regionId)
      return
    }
    const range = targetRange(target)
    const track = range ? cutState.tracks.find(item => item.trackId === range.trackId) : undefined
    if (!range || !track) return
    const usedIds = new Set(track.speechCandidates.map(item => item.candidateId))
    const candidate: DialogueSpeechCandidate = {
      candidateId: nextUniqueId(`${track.trackId}-candidate-manual`, usedIds),
      frameStart: range.frameStart,
      frameEnd: range.frameEnd,
      status: 'pending',
    }
    updateTrack(track.trackId, { speechCandidates: [...track.speechCandidates, candidate] })
    setAudioSelectionState(replaceDialogueAudioSelection([{
      kind: 'candidate',
      trackId: track.trackId,
      id: candidate.candidateId,
    }]))
    openCandidateSound(track.trackId, [candidate])
  }

  function linkedCueForTarget(target: DialogueAudioContextTarget): TimedRangeCue | undefined {
    if (target.kind === 'cue') return soundCues.find(cue => cue.cueId === target.cueId)
    if (target.kind !== 'region') return undefined
    const binding = bindingForRegion(cutState, { trackId: target.trackId, regionId: target.regionId }, activeRevisionId)
    return binding ? soundCues.find(cue => cue.cueId === binding.cueId) : undefined
  }

  function alignAudioToCue(target: DialogueAudioContextTarget) {
    const cue = linkedCueForTarget(target)
    if (!cue) return
    if (target.kind === 'region') {
      if (runClipCommand(() => moveDialogueRegionAudioToFrame(cutState, target.trackId, target.regionId, cue.frameStart, frameOrigin))) setStatus(`音声区間をSOUNDの${cue.frameStart}Fへ揃えました。`)
      return
    }
    if (target.kind !== 'cue') return
    const binding = bindingForCue(cutState, target.cueId, activeRevisionId)
    const resolution = binding ? resolveDialogueBinding(cutState, binding) : null
    if (!binding || !resolution) return
    const delta = cue.frameStart - resolution.frameStart
    const anchors = binding.members.flatMap(member => {
      const ref = member.regionRef
      const track = cutState.tracks.find(item => item.trackId === ref.trackId)
      const region = track?.dialogueRegions.find(item => item.regionId === ref.regionId)
      return region?.anchors ?? []
    })
    if (runClipCommand(() => moveDialogueAnchors(cutState, anchors, delta, frameOrigin))) setStatus(`リンク音声をSOUNDの${cue.frameStart}Fへ揃えました。`)
  }

  function alignCueToAudio(target: DialogueAudioContextTarget) {
    const cue = linkedCueForTarget(target)
    if (!cue) return
    let resolution = null
    if (target.kind === 'region') {
      const track = cutState.tracks.find(item => item.trackId === target.trackId)
      const region = track?.dialogueRegions.find(item => item.regionId === target.regionId)
      resolution = track && region ? resolveDialogueRegion(track, region) : null
    } else if (target.kind === 'cue') {
      const binding = bindingForCue(cutState, target.cueId, activeRevisionId)
      resolution = binding ? resolveDialogueBinding(cutState, binding) : null
    }
    if (!resolution) return
    if (resolution.frameEnd > cutFrameEnd) {
      setStatus('音声区間がタイムシート尺を越えるため、SOUNDを揃えられません。先にカット尺を変更してください。')
      return
    }
    onSoundCueTransform(
      cue.cueId,
      { laneId: cue.laneId, frameStart: resolution.frameStart, frameEnd: resolution.frameEnd },
      'resize-cue',
    )
    setStatus('SOUND区間をリンク音声へ揃えました。')
  }

  function executeContextCommand(command: DialogueAudioContextCommand) {
    const target = contextMenu?.target
    if (!target) return
    setContextMenu(null)
    const range = targetRange(target)
    if (command === 'redetect-track' && target.kind === 'track') void redetectTrack(target.trackId)
    else if (command === 'clear-track' && target.kind === 'track') clearTrack(target.trackId)
    else if (command === 'import-here' && target.kind === 'empty') requestAudioImport(target.trackId, playheadFrame)
    else if (command === 'paste-overwrite' && target.kind === 'empty') pasteClipboardAt(target.trackId, playheadFrame, 'overwrite')
    else if (command === 'paste-insert' && target.kind === 'empty') pasteClipboardAt(target.trackId, playheadFrame, 'insert')
    else if (command === 'paste-overwrite' && range) pasteClipboardAt(range.trackId, range.frameStart, 'overwrite')
    else if (command === 'paste-insert' && range) pasteClipboardAt(range.trackId, range.frameStart, 'insert')
    else if (command === 'insert-silence') {
      const trackId = 'trackId' in target ? target.trackId : cutState.activeTrackId
      const frame = range?.frameStart ?? playheadFrame
      insertSilenceAt(trackId, frame)
    } else if (command === 'add-to-selected-sound') addSelectedSpeechToSelectedCue()
    else if (command === 'assign-sound') createSoundForTarget(target)
    else if (command === 'copy' && target.kind === 'clip') copyClipSelection(target, false)
    else if (command === 'cut' && target.kind === 'clip') copyClipSelection(target, true)
    else if (command === 'copy' && range) copyRange(range, false)
    else if (command === 'cut' && range) copyRange(range, true)
    else if (command === 'silence' && range) silenceRange(range)
    else if (command === 'ripple-delete' && target.kind === 'clip') rippleDeleteSelectedClips(target)
    else if (command === 'ripple-delete' && range) rippleDelete(range)
    else if (command === 'delete-clips' && target.kind === 'clip') deleteClipSelection(target)
    else if (command === 'redetect-clips' && target.kind === 'clip') void redetectTrack(target.trackId, undefined, target.clipIds)
    else if ((command === 'ignore-candidate' || command === 'restore-candidate') && target.kind === 'candidate') {
      const track = cutState.tracks.find(item => item.trackId === target.trackId)
      if (!track) return
      const nextTrack = target.candidateIds.reduce((current, candidateId) => (
        command === 'ignore-candidate'
          ? bindingForCandidate(cutState, candidateId, activeRevisionId) ? current : ignoreDialogueSpeechCandidate(current, candidateId)
          : restoreDialogueSpeechCandidate(current, candidateId)
      ), track)
      updateTrack(target.trackId, nextTrack)
      setStatus(command === 'ignore-candidate' ? 'セリフ区間を無視しました。' : 'セリフ区間を検出対象へ戻しました。')
    } else if (command === 'edit-sound') {
      if (target.kind === 'cue') onSoundCueEdit(target.cueId)
      else if (target.kind === 'region') createSoundForTarget(target)
    } else if (command === 'select-sheet-cue') {
      const cue = linkedCueForTarget(target)
      if (cue) onSoundCueSelect(cue.cueId)
    } else if (command === 'align-audio-to-cue') alignAudioToCue(target)
    else if (command === 'align-cue-to-audio') alignCueToAudio(target)
    else if (command === 'unlink-sound') {
      const unlinked = target.kind === 'region'
        ? unlinkDialogueAudioRegion(cutState, { trackId: target.trackId, regionId: target.regionId }, activeRevisionId)
        : target.kind === 'cue'
          ? unlinkDialogueAudioCue(cutState, target.cueId, activeRevisionId)
          : cutState
      commitCutState(synchronizeDialogueBindingsFromCues(unlinked, soundCues, activeRevisionId))
      setStatus('SOUNDとのリンクを解除しました。音声とラベルは保持しています。')
    } else if (command === 'remove-region' && target.kind === 'region') {
      const removed = removeDialogueAudioRegion(cutState, target.trackId, target.regionId)
      commitCutState(synchronizeDialogueBindingsFromCues(removed, soundCues, activeRevisionId))
      clearAudioFocus()
      setStatus('セリフ区間の割付を解除しました。音声と検出区間は保持しています。')
    }
  }

  const contextCommands = contextMenu
    ? dialogueAudioContextCommands(contextMenu.target, {
        hasClipboard: Boolean(clipboard),
        busy: recording || playing || vadEngine.status === 'loading',
        targetHasAudio: 'trackId' in contextMenu.target
          ? Boolean(cutState.tracks.find(track => track.trackId === contextMenu.target.trackId)?.clips.length)
          : false,
        canAddToSelectedSound: Boolean(selectedCue)
          && (contextMenu.target.kind === 'candidate' || contextMenu.target.kind === 'region'),
      })
    : []
  const trackRows = cutState.tracks.map(track => `${trackHeight(track.trackId)}px`).join(' ')
  const headerRows = `${TIME_RULER_HEIGHT}px ${soundBandHeight(soundCues)}px ${trackRows}`
  const contentHeight = TIME_RULER_HEIGHT + soundBandHeight(soundCues) + cutState.tracks.reduce((sum, track) => sum + trackHeight(track.trackId), 0)
  const audioEndsAtCut = audioContentDurationFrames === cutDurationFrames
  const touchContextTarget = dialogueAudioContextTargetForSelection(audioSelection, cutState, activeRevisionId)

  if (collapsed) {
    return (
      <section
        className="dialogueAudioTimeline isCollapsed"
        aria-label="セリフ音声タイムライン"
        data-input-modality={inputModality}
        onPointerDownCapture={handleInputPointerDownCapture}
      >
        <button type="button" className="dialogueAudioCollapse" onClick={() => setCollapsed(false)} aria-expanded="false">音声タイムラインを開く</button>
        <span>{formatFrame(playheadFrame, frameOrigin, fps)}</span>
        <button type="button" onClick={() => void startPlayback(frameOrigin)}>カット頭から再生</button>
      </section>
    )
  }

  return (
    <section
      className="dialogueAudioTimeline"
      aria-label="セリフ音声タイムライン"
      style={{ height: viewPreferences.panelHeight }}
      data-frame-origin={frameOrigin}
      data-cut-duration-frames={cutDurationFrames}
      data-timeline-duration-frames={timelineDurationFrames}
      data-audio-content-end-frame={audioContentFrameEnd ?? ''}
      data-vad-engine={vadEngine.status}
      data-active-track-id={cutState.activeTrackId}
      data-input-modality={inputModality}
      data-workspace-keyboard-scope="audio"
      onPointerDownCapture={handleInputPointerDownCapture}
      onFocusCapture={() => onWorkspaceFocus?.()}
      onKeyDown={handleTimelineKeyDown}
    >
      <TooltipTarget label="上下にドラッグして音声パネルの高さを変更。↑/↓キーでも調整">
        {tooltipProps => <div
        {...tooltipProps}
        className="dialogueAudioPanelResizeHandle"
        role="separator"
        aria-label="音声タイムラインの高さを変更"
        aria-orientation="horizontal"
        aria-valuemin={180}
        aria-valuemax={720}
        aria-valuenow={viewPreferences.panelHeight}
        tabIndex={0}
        onPointerDown={event => {
          tooltipProps.onPointerDown()
          if (event.button !== 0) return
          event.preventDefault()
          setPanelResize({ startY: event.clientY, startHeight: viewPreferences.panelHeight })
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            resizePanelBy(24)
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            resizePanelBy(-24)
          } else if (event.key === 'Home') {
            event.preventDefault()
            setViewPreferences(current => ({ ...current, panelHeight: clampDialogueAudioPanelHeight(180) }))
          } else if (event.key === 'End') {
            event.preventDefault()
            resizePanelBy(720)
          }
        }}
      />}
      </TooltipTarget>
      <div className="dialogueAudioToolbar">
        <div className="dialogueAudioToolbarMain">
          <Tooltip label="音声タイムラインを折りたたむ">
            <button type="button" className="dialogueAudioCollapse" onClick={() => setCollapsed(true)} aria-expanded="true" disabled={recording}>▾ 音声</button>
          </Tooltip>
          <TooltipTarget label="再生ヘッドの位置。←/→で1F、Shift+←/→で5F移動。Homeで先頭、Endで末尾">
            {tooltipProps => <span {...tooltipProps} className="dialogueAudioTime">{formatFrame(playheadFrame, frameOrigin, fps)}</span>}
          </TooltipTarget>
          <span className="dialogueAudioToolGroup" aria-label="タイムラインツール">
            <Tooltip label="選択ツール（V）。クリックで選択、Shift+クリックで追加選択。ドラッグで移動、両端でトリム、空白からドラッグで矩形選択">
              <button
                type="button"
                className={`dialogueAudioIconButton ${timelineTool === 'select' ? 'isActiveTool' : ''}`}
                aria-label="選択ツール"
                aria-pressed={timelineTool === 'select'}
                aria-keyshortcuts="V"
                onClick={() => { setTimelineTool('select'); focusTimeline() }}
              ><SelectionToolIcon /></button>
            </Tooltip>
            <Tooltip label="レーザーツール（C）。クリック位置で分割。Shift+クリックでロックされていない全トラックを分割">
              <button type="button" className={`dialogueAudioIconButton ${timelineTool === 'razor' ? 'isActiveTool' : ''}`} aria-label="レーザーツール（C）" aria-keyshortcuts="C" aria-pressed={timelineTool === 'razor'} onClick={() => { setTimelineTool('razor'); focusTimeline() }}><DialogueAudioIcon name="razor" /></button>
            </Tooltip>
            <Tooltip label="ドラッグして音声の一部分を選択">
              <button
                type="button"
                className={`dialogueAudioIconButton dialogueAudioRangeTool ${timelineTool === 'range' ? 'isActiveTool' : ''}`}
                aria-label="範囲選択"
                aria-pressed={timelineTool === 'range'}
                onClick={() => { setTimelineTool('range'); focusTimeline() }}
              ><RangeToolIcon /><span>範囲選択</span></button>
            </Tooltip>
          </span>
          <DialogueAudioTouchControls
            visible={inputModality === 'touch'}
            additiveSelection={touchAdditiveSelection}
            contextMenuAvailable={Boolean(touchContextTarget)}
            onToggleAdditiveSelection={() => setTouchAdditiveSelection(current => !current)}
            onOpenContextMenu={event => touchContextTarget && openContextMenu(event, touchContextTarget)}
          />
          <span className="dialogueAudioToolGroup" aria-label="再生と録音">
            <Tooltip label="カット頭から再生">
              <button type="button" className="dialogueAudioIconButton" aria-label="⏮ カット頭から" onClick={() => { setPlayhead(frameOrigin); void startPlayback(frameOrigin); focusTimeline() }} disabled={recording}><DialogueAudioIcon name="start" /></button>
            </Tooltip>
            <Tooltip label={playing ? '一時停止（Space）' : '再生（Space）。末尾では頭から再開'}>
              <button type="button" className="dialogueAudioIconButton" aria-label={playing ? '⏸ 一時停止' : '▶ 再生ヘッドから'} aria-keyshortcuts="Space" onClick={() => { if (playing) stopPlayback(); else void startPlayback(); focusTimeline() }} disabled={recording}><DialogueAudioIcon name={playing ? 'pause' : 'play'} /></button>
            </Tooltip>
            <Tooltip label={recording ? '録音を終了して音声クリップを追加' : '選択中のトラックへ再生ヘッド位置からマイク録音'}>
              <button type="button" className={`dialogueAudioIconButton ${recording ? 'isRecording' : ''}`} aria-label={recording ? '■ 録音終了' : '● 録音'} onClick={() => void toggleRecording()} disabled={!recording && (vadEngine.status === 'loading' || activeTrack?.locked)}><DialogueAudioIcon name={recording ? 'stop' : 'record'} /></button>
            </Tooltip>
            <Tooltip label="音声ファイルを再生ヘッドへ読み込む">
              <button
                type="button"
                className="dialogueAudioIconButton"
                aria-label="音声ファイルを読み込む"
                onClick={() => activeTrack && requestAudioImport(activeTrack.trackId, playheadFrame)}
                disabled={recording || playing || vadEngine.status === 'loading' || !activeTrack || activeTrack.locked}
              ><AudioImportIcon /></button>
            </Tooltip>
          </span>
          <span className="dialogueAudioToolGroup" aria-label="音声編集">
            <Tooltip label="編集点を追加（Ctrl+K / Mac: ⌘K）。選択クリップ、未選択時は対象トラックを再生ヘッドで分割。Shift併用で全トラック">
              <button type="button" className="dialogueAudioIconButton" onClick={() => { splitAtPlayhead(); focusTimeline() }} disabled={recording || playing} aria-label="再生ヘッドで分割（Ctrl+K）" aria-keyshortcuts="Control+K Meta+K"><DialogueAudioIcon name="split" /></button>
            </Tooltip>
            <Tooltip label={`スナップ（S）：${snap ? 'オン' : 'オフ'}。移動・トリム時にクリップの端や再生ヘッドへ吸着`}>
              <button type="button" className={`dialogueAudioIconButton ${snap ? 'isActiveTool' : ''}`} aria-label="スナップ" aria-keyshortcuts="S" aria-pressed={snap} onClick={() => { setSnap(value => !value); focusTimeline() }}><DialogueAudioIcon name="snap" /></button>
            </Tooltip>
            <Tooltip label="音声トラックを追加して録音・読込先にする">
              <button type="button" disabled={recording || playing} onClick={() => runClipCommand(() => addDialogueAudioTrack(cutState))}>＋トラック</button>
            </Tooltip>
            <Tooltip label="元に戻す（Ctrl+Z / Mac: ⌘Z）">
              <button type="button" className="dialogueAudioIconButton" onClick={onUndo} disabled={recording || playing || !canUndo} aria-label="元に戻す"><DialogueAudioIcon name="undo" /></button>
            </Tooltip>
            <Tooltip label="やり直す（Ctrl+Shift+Z / Mac: ⌘Shift+Z）">
              <button type="button" className="dialogueAudioIconButton" onClick={onRedo} disabled={recording || playing || !canRedo} aria-label="やり直す"><DialogueAudioIcon name="redo" /></button>
            </Tooltip>
            <Tooltip label="再生ヘッドに1Fの無音を挿入。対象トラックの後続音声を1F後ろへ送る">
              <button type="button" className="dialogueAudioIconButton" onClick={() => insertSilence(1)} disabled={recording || playing || !activeTrack?.clips.length} aria-label="+1F">+F</button>
            </Tooltip>
            <Tooltip label="再生ヘッドの1Fをリップル削除。対象トラックの後続音声を1F前へ詰める">
              <button type="button" className="dialogueAudioIconButton" onClick={() => rippleDelete()} disabled={recording || playing || !activeTrack?.clips.length} aria-label="−1F">−F</button>
            </Tooltip>
          </span>
          <input ref={fileInputRef} type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm" hidden onChange={event => void importAudio(event)} />
          <Tooltip label="選択した音声をSOUNDの収録区間へ割り付ける。前後の余白はプロパティで調整">
          <button
            type="button"
            className="dialogueAudioReflectButton"
            onClick={createSoundFromSelection}
            disabled={selectedCandidateRefs.length === 0 && selectedRegionRefs.length === 0 && !audioSelectionState.entities.some(entity => entity.kind === 'clip') && !audioSelectionState.timeRange}
          >{selectedCue && (selectedCandidateRefs.length > 0 || selectedRegionRefs.length > 0)
            ? `選択中のSOUNDへ追加`
            : (selectedCandidate && bindingForCandidate(cutState, selectedCandidate.candidateId, activeRevisionId))
            || (selectedRegions.length === 1 && bindingForRegion(cutState, {
              trackId: activeTrack?.trackId ?? '',
              regionId: selectedRegions[0].regionId,
            }, activeRevisionId))
            ? '音響指示を編集'
            : 'SOUNDへ割付…'}</button>
          </Tooltip>
          {selectedFrameRange && <span className="dialogueAudioSelectionSummary">{dialogueAudioSelectionSummary(audioSelectionState, selectedFrameRange)}</span>}
          <span className="dialogueAudioToolbarSpacer" />
          <TooltipTarget label={vadEngine.error ?? ''} disabled={!vadEngine.error}>
            {tooltipProps => <span className={`dialogueVadEngine is-${vadEngine.status}`} role="status" {...tooltipProps}>{vadEngineLabel(vadEngine.status)}</span>}
          </TooltipTarget>
          <span className="dialogueAudioZoomTools" aria-label="タイムライン表示倍率">
            <TooltipTarget label="タイムラインを拡大・縮小（= / −）。Ctrl+ホイールでも調整">
              {tooltipProps => <input
              {...tooltipProps}
              type="range"
              min="0"
              max="100"
              step="1"
              value={zoomSliderValue}
              onChange={event => setTimelineZoom(Number(event.currentTarget.value))}
              aria-label="音声タイムラインのズーム"
              aria-valuetext={viewPreferences.fitTimeline ? '全体表示' : '拡大表示'}
            />}
            </TooltipTarget>
            <Tooltip label="タイムラインの編集範囲全体を表示（\）">
              <button type="button" className={`dialogueAudioFitButton ${viewPreferences.fitTimeline ? 'isOn' : ''}`} onClick={fitTimeline} aria-label="音声タイムライン全体を表示">全体</button>
            </Tooltip>
          </span>
          <ActionMenu
            className="dialogueAudioSettingsMenu"
            label={<DialogueAudioIcon name="settings" />}
            ariaLabel="音声タイムライン設定"
            tooltipLabel="音声タイムライン設定"
          >
            <div className="dialogueAudioMenuLabel">VAD検出設定</div>
            <TooltipTarget label="音声から検出した発話候補とSOUNDに割り付けた区間の表示を切り替え">
              {tooltipProps => <label {...tooltipProps}><input type="checkbox" checked={showCandidates} onChange={event => setShowCandidates(event.target.checked)} />発話候補・区間を表示</label>}
            </TooltipTarget>
            <TooltipTarget label="録音環境に合わせて発話検出の基準を設定">
            {tooltipProps => <label {...tooltipProps}>録音VAD環境<select value={cutState.detectionPreset} disabled={vadEngine.status === 'loading'} onChange={event => onCutStateChange({
              cutState: { ...cutState, detectionPreset: event.target.value as DialogueAudioCutState['detectionPreset'] },
              recordHistory: false,
            })}>
              <option value="quiet">静か</option><option value="normal">通常</option><option value="noisy">騒がしい</option>
            </select></label>}
            </TooltipTarget>
            <TooltipTarget label="発話として検出する感度。上げると小さな声も検出しやすくなります">
            {tooltipProps => <label {...tooltipProps}>検出感度<input type="range" min="0" max="1" step="0.01" value={cutState.detectionSensitivity} disabled={vadEngine.status === 'loading'} onChange={event => onCutStateChange({
              cutState: { ...cutState, detectionSensitivity: Number(event.target.value) },
              recordHistory: false,
            })} /></label>}
            </TooltipTarget>
            <TooltipTarget label="短い間を一続きの発話として扱う度合い。上げると候補が細かく分かれにくくなります">
            {tooltipProps => <label {...tooltipProps}>途切れにくさ<input type="range" min="0" max="1" step="0.01" value={cutState.detectionStability} disabled={vadEngine.status === 'loading'} onChange={event => onCutStateChange({
              cutState: { ...cutState, detectionStability: Number(event.target.value) },
              recordHistory: false,
            })} /></label>}
            </TooltipTarget>
          </ActionMenu>
        </div>
        <DialogueAudioInspector state={cutState} selection={audioSelectionState} cues={soundCues} selectedCue={selectedCue ?? undefined} revision={activeRevisionId}
          frameOrigin={frameOrigin} disabled={playing || recording} onCommand={runClipCommand} onTransform={onSoundCueTransform} />
      </div>
      {status && <div className="dialogueAudioNotice" role="status">{status}</div>}
      {clipDragDisplay && <div className={`dialogueAudioNotice ${clipDragDisplay.error ? 'isInvalid' : ''}`} role="status">{clipDragDisplay.error || `${clipDragDisplay.drag.edge ? 'トリム' : '移動'} ${clipDragDisplay.drag.delta > 0 ? '+' : ''}${clipDragDisplay.drag.delta}F · Escで取消`}</div>}

      <div className="dialogueAudioBody">
        <aside
          ref={timelineHeaderRef}
          className="dialogueAudioTrackHeaders"
          style={{ gridTemplateRows: headerRows }}
        >
          <div className="dialogueAudioRulerHeader" aria-hidden="true" />
          <div className="dialogueAudioSoundHeader">SOUND <small>収録区間</small></div>
          {cutState.tracks.map((track, trackIndex) => (
            <div
              key={track.trackId}
              className={`dialogueAudioTrackHeader ${track.trackId === cutState.activeTrackId ? 'isActive' : ''}`}
              data-track-id={track.trackId}
              style={{ height: trackHeight(track.trackId) }}
              onContextMenu={event => {
                openContextMenu(event, { kind: 'track', trackId: track.trackId })
              }}
            >
              <TooltipTarget label={`A${trackIndex + 1}：録音・音声読込・貼り付け先のトラック${track.trackId === cutState.activeTrackId ? '（選択中）' : ''}`}>
                {tooltipProps => <button
                  type="button"
                  className={`dialogueAudioTrackTarget ${track.trackId === cutState.activeTrackId ? 'isActive' : ''}`}
                  onClick={() => onCutStateChange({
                    cutState: { ...cutState, activeTrackId: track.trackId },
                    recordHistory: false,
                  })}
                  disabled={recording}
                  aria-label={`音声トラック${trackIndex + 1}を録音対象にする`}
                  aria-pressed={track.trackId === cutState.activeTrackId}
                  {...tooltipProps}
                >
                  <span className="dialogueAudioTrackColorBar" style={{ background: track.color }} />
                  <span>A{trackIndex + 1}</span>
                </button>}
              </TooltipTarget>
              <TooltipTarget label={track.muted ? 'ミュートを解除。このトラックの音声を再生' : 'ミュート。このトラックの音声を消音'}>
                {tooltipProps => <button
                  type="button"
                  className={`dialogueAudioTrackMute ${track.muted ? 'isMuted' : ''}`}
                  onClick={() => updateTrack(track.trackId, { muted: !track.muted })}
                  aria-label={track.muted ? `音声トラック${trackIndex + 1}のミュートを解除` : `音声トラック${trackIndex + 1}をミュート`}
                  aria-pressed={track.muted}
                  {...tooltipProps}
                >M</button>}
              </TooltipTarget>
              <DialogueAudioTrackControls track={track} index={trackIndex} count={cutState.tracks.length} disabled={recording || playing}
                onUpdate={updates => updateTrack(track.trackId, updates)} onReorder={index => runClipCommand(() => reorderDialogueAudioTrack(cutState, track.trackId, index))}
                onRemove={() => runClipCommand(() => removeDialogueAudioTrack(cutState, track.trackId))} />
              <TooltipTarget label="上下にドラッグして音声トラックの高さを変更">
                {tooltipProps => <span
                {...tooltipProps}
                className="dialogueAudioTrackResizeHandle"
                role="separator"
                aria-label={`音声トラック${trackIndex + 1}の高さを変更`}
                aria-orientation="horizontal"
                onPointerDown={event => {
                  tooltipProps.onPointerDown()
                  if (event.button !== 0) return
                  event.preventDefault()
                  setTrackResize({ trackId: track.trackId, startY: event.clientY, startHeight: trackHeight(track.trackId) })
                }}
              />}
              </TooltipTarget>
            </div>
          ))}
        </aside>

        <div
          ref={timelineScrollerRef}
          className="dialogueAudioScroller"
          onScroll={event => {
            if (timelineHeaderRef.current) timelineHeaderRef.current.scrollTop = event.currentTarget.scrollTop
          }}
          onWheel={handleTimelineWheel}
        >
          <div
            ref={timelineContentRef}
            className="dialogueAudioContent"
            style={{ width: timelineWidth, height: contentHeight, '--audio-frame-width': `${timelineWidth / timelineDurationFrames}px` } as CSSProperties}
            role="group"
            aria-label="音声トラック編集領域"
            tabIndex={0}
            onContextMenu={event => event.preventDefault()}
          >
            <TimeRuler
              durationFrames={timelineDurationFrames}
              fps={fps}
              pixelsPerFrame={pixelsPerFrame}
              onPointerDown={beginPlayheadScrub}
              onPointerMove={movePlayheadScrub}
              onPointerUp={finishPlayheadScrub}
              onPointerCancel={finishPlayheadScrub}
            />
            <DialogueAudioSoundBand cues={soundCues.map(cue => ({ ...cue, ...clipDragDisplay?.cueUpdates.find(update => update.cueId === cue.cueId) }))}
              selected={selectedSoundCueId} frameOrigin={frameOrigin} durationFrames={timelineDurationFrames} cutEnd={cutFrameEnd} pixelsPerFrame={pixelsPerFrame}
              disabled={recording || playing} onSelect={onSoundCueSelect} onEdit={onSoundCueEdit} onTransform={onSoundCueTransform} />
            <TimelineBoundaryMarker
              kind={audioEndsAtCut ? 'combined' : 'cut'}
              positionPercent={cutDurationFrames / timelineDurationFrames * 100}
              label={audioEndsAtCut
                ? `タイムシート終端・最終音声位置 ${formatFrame(cutFrameEnd, frameOrigin, fps)}`
                : `タイムシート終端 ${formatFrame(cutFrameEnd, frameOrigin, fps)}`}
            />
            {audioContentFrameEnd !== null && !audioEndsAtCut && <TimelineBoundaryMarker
              kind="audio"
              positionPercent={audioContentDurationFrames / timelineDurationFrames * 100}
              label={`最終音声位置 ${formatFrame(audioContentFrameEnd, frameOrigin, fps)}`}
            />}
            {displayCutState.tracks.map(track => {
              const regionCandidateIds = new Set(track.dialogueRegions.flatMap(region => region.candidateIds))
              return <div
                key={track.trackId}
                className={`dialogueAudioTrack ${track.trackId === cutState.activeTrackId ? 'isActive' : ''}`}
                data-track-id={track.trackId}
                style={{ height: trackHeight(track.trackId) }}
                onContextMenu={event => {
                  openContextMenu(event, { kind: 'empty', trackId: track.trackId })
                }}
              >
                <div
                  className="dialogueAudioWaveformLane"
                  onPointerDown={event => beginTimelineGesture(event, track.trackId)}
                  onPointerMove={moveTouchTimelineTap}
                  onPointerUp={event => finishTouchTimelineTap(event)}
                  onPointerCancel={event => finishTouchTimelineTap(event, true)}
                >
                  {track.clips.length === 0 && <span className="dialogueAudioEmpty">録音または音声読込</span>}
                  {clipDragDisplay?.drag.trackId === track.trackId && cutState.tracks.find(item => item.trackId === track.trackId)?.clips.filter(clip => clipDragDisplay.drag.clipIds.includes(clip.clipId)).map(clip => <span key={`origin-${clip.clipId}`} className="dialogueAudioClipGhost" style={rangeStyle(clip.timelineStartFrame, clip.timelineStartFrame + clip.durationFrames - 1, frameOrigin, timelineDurationFrames)} />)}
                  {clipDragDisplay?.error && clipDragDisplay.drag.destination === track.trackId && <span className="dialogueAudioClipGhost isInvalid" style={rangeStyle(clipDragDisplay.drag.clip.timelineStartFrame + clipDragDisplay.drag.delta, clipDragDisplay.drag.clip.timelineStartFrame + clipDragDisplay.drag.delta + clipDragDisplay.drag.clip.durationFrames - 1, frameOrigin, timelineDurationFrames)} />}
                  {track.clips.map(sourceClip => {
                    const asset = cutState.assets.find(item => item.assetId === sourceClip.assetId)
                    return asset ? <DialogueAudioClipSurface key={sourceClip.clipId} clip={sourceClip} asset={asset} trackId={track.trackId} color={track.color}
                      tool={timelineTool} locked={Boolean(track.locked)}
                      frameOrigin={frameOrigin} durationFrames={timelineDurationFrames} lane={dialogueAudioClipHandleLane(track.clips, sourceClip.clipId)}
                      selected={dialogueAudioSelectionContains(audioSelectionState, { kind: 'clip', trackId: track.trackId, id: sourceClip.clipId })}
                      onPointerDown={event => {
                        if (event.button !== 0 || recording || playing) return
                        focusTimeline()
                        if (timelineTool === 'razor') {
                          event.stopPropagation(); event.preventDefault()
                          const bounds = event.currentTarget.getBoundingClientRect()
                          const frame = sourceClip.timelineStartFrame + Math.round((event.clientX - bounds.left) / pixelsPerFrame)
                          const ids = event.shiftKey ? cutState.tracks.filter(item => !item.locked).flatMap(item => item.clips.map(clip => clip.clipId)) : [sourceClip.clipId]
                          runClipCommand(() => splitDialogueAudioClips(cutState, ids, frame))
                        } else if (timelineTool === 'select') beginClipDrag(event, track.trackId, sourceClip)
                      }}
                      onContextMenu={event => openContextMenu(event, { kind: 'clip', trackId: track.trackId, clipIds: [sourceClip.clipId], frameStart: sourceClip.timelineStartFrame, frameEnd: sourceClip.timelineStartFrame + sourceClip.durationFrames - 1 })} /> : null
                  })}
                  {showCandidates && track.speechCandidates.filter(candidate => !regionCandidateIds.has(candidate.candidateId)).map(candidate => {
                    const presentation = candidatePresentation(candidate, displayCutState, activeRevisionId)
                    const candidateSelected = dialogueAudioSelectionContains(audioSelectionState, {
                      kind: 'candidate',
                      trackId: track.trackId,
                      id: candidate.candidateId,
                    })
                    const trackSelectedCandidateIds = selectedCandidateRefs
                      .filter(entity => entity.trackId === track.trackId)
                      .map(entity => entity.id)
                    const openCandidates = candidateSelected
                      ? track.speechCandidates.filter(item => trackSelectedCandidateIds.includes(item.candidateId))
                      : [candidate]
                    return <DialogueSpeechSegmentButton
                      key={candidate.candidateId}
                      tooltip={presentation.title}
                      className={`dialogueSpeechSegment is-candidate is-${presentation.state} ${candidateSelected ? 'isSelected' : ''}`}
                      style={candidateHitStyle(candidate.frameStart, candidate.frameEnd, frameOrigin, timelineDurationFrames, timelineWidth)}
                      label={presentation.label}
                      ariaLabel={`セリフ区間候補 ${candidate.frameStart}–${candidate.frameEnd}F${presentation.label ? ` ${presentation.label}` : ''}`}
                      segmentKind="candidate"
                      trackId={track.trackId}
                      segmentId={candidate.candidateId}
                      frameStart={candidate.frameStart}
                      frameEnd={candidate.frameEnd}
                      suppressClick={suppressSegmentClick}
                      onPointerDown={event => beginSegmentDrag(event, track, {
                        kind: 'candidate',
                        id: candidate.candidateId,
                        frameStart: candidate.frameStart,
                        frameEnd: candidate.frameEnd,
                      })}
                      onSelect={event => selectCandidate(event, track, candidate)}
                      onOpen={() => {
                        if (timelineTool !== 'range') openCandidateSound(track.trackId, openCandidates)
                      }}
                      onContextMenu={event => openContextMenu(event, {
                          kind: 'candidate',
                          trackId: track.trackId,
                          candidateIds: openCandidates.map(item => item.candidateId),
                          ignored: openCandidates.every(item => item.status === 'ignored'),
                        })}
                    />
                  })}
                  {showCandidates && track.dialogueRegions.map(region => {
                    const binding = bindingForRegion(displayCutState, { trackId: track.trackId, regionId: region.regionId }, activeRevisionId)
                    const cue = binding ? soundCues.find(item => item.cueId === binding.cueId) : undefined
                    const label = cue?.label ?? ''
                    const regionSelected = dialogueAudioSelectionContains(audioSelectionState, {
                      kind: 'region',
                      trackId: track.trackId,
                      id: region.regionId,
                    })
                    const presentationState = binding?.status ?? (region.status === 'ready' ? 'unassigned' : region.status)
                    const tooltipLabel = binding
                      ? `割付済み：${label || '名称なし'} ${region.frameStart}–${region.frameEnd}F`
                      : `未割付のセリフ区間 ${region.frameStart}–${region.frameEnd}F`
                    return <DialogueSpeechSegmentButton
                      key={region.regionId}
                      tooltip={tooltipLabel}
                      className={`dialogueSpeechSegment is-region is-${presentationState} ${linkedHighlightRegionKeys.has(`${track.trackId}:${region.regionId}`) ? 'isLinkedHighlight' : ''} ${regionSelected ? 'isSelected' : ''}`}
                      style={candidateHitStyle(region.frameStart, region.frameEnd, frameOrigin, timelineDurationFrames, timelineWidth)}
                      label={label}
                      ariaLabel={`セリフ区間 ${region.frameStart}–${region.frameEnd}F ${binding ? `${label || '名称なし'}へ割付済み` : '未割付'}`}
                      segmentKind="region"
                      trackId={track.trackId}
                      segmentId={region.regionId}
                      frameStart={region.frameStart}
                      frameEnd={region.frameEnd}
                      linked={Boolean(binding)}
                      regionId={region.regionId}
                      suppressClick={suppressSegmentClick}
                      onPointerDown={event => beginSegmentDrag(event, track, {
                        kind: 'region',
                        id: region.regionId,
                        frameStart: region.frameStart,
                        frameEnd: region.frameEnd,
                      })}
                      onSelect={event => selectRegion(event, track, region)}
                      onOpen={() => {
                        if (timelineTool !== 'range') openDialogueRegion(track, region.regionId)
                      }}
                      onContextMenu={event => openContextMenu(event, {
                          kind: 'region',
                          trackId: track.trackId,
                          regionId: region.regionId,
                          linked: Boolean(binding),
                        })}
                    />
                  })}
                  {audioSelectionState.timeRange?.trackId === track.trackId && <span className="dialogueAudioSelection" style={rangeStyle(
                    audioSelectionState.timeRange.frameStart,
                    audioSelectionState.timeRange.frameEnd,
                    frameOrigin,
                    timelineDurationFrames,
                  )} />}
                </div>
              </div>
            })}
            {marqueeStyle && <span className="dialogueAudioMarquee" style={marqueeStyle} />}
            <span
              className="dialogueAudioPlayhead"
              style={{
                left: `${(playheadFrame - frameOrigin) / timelineDurationFrames * 100}%`,
                pointerEvents: 'none',
              }}
              role="slider"
              aria-label="音声再生ヘッド"
              aria-valuemin={frameOrigin}
              aria-valuemax={frameEnd}
              aria-valuenow={playheadFrame}
              aria-valuetext={formatFrame(playheadFrame, frameOrigin, fps)}
              tabIndex={0}
            />
          </div>
        </div>
      </div>

      {contextMenu && createPortal(<div
        ref={contextMenuRef}
        className="dialogueAudioContextMenu"
        role="menu"
        aria-label={contextMenuAriaLabel(contextMenu.target)}
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onPointerDown={event => event.stopPropagation()}
        onContextMenu={event => event.preventDefault()}
      >
        <div className="dialogueAudioMenuLabel">{contextMenuTitle(contextMenu.target)}</div>
        {contextCommands.map(command => {
          if (command === 'track-vad-mode' && contextTrack) {
            return <label key={command}>録音後の処理<select value={contextTrack.vadMode} disabled={recording || vadEngine.status === 'loading'} onChange={event => updateTrack(contextTrack.trackId, { vadMode: event.target.value as DialogueAudioTrackState['vadMode'] })}>
              <option value="off">検出しない</option>
              <option value="candidates">発話区間を検出</option>
              <option value="auto-region">セリフ区間を自動作成</option>
            </select></label>
          }
          if (command === 'track-height' && contextTrack) {
            return <div key={command}>
              <div className="dialogueAudioMenuLabel">トラック高</div>
              <div className="dialogueAudioHeightPresets">
                {(['small', 'medium', 'large'] as const).map((preset, index) => <button
                  type="button"
                  key={preset}
                  onClick={() => setTrackHeightPreset(contextTrack.trackId, preset)}
                  aria-label={`トラック高 ${['小', '中', '大'][index]}`}
                >{['小', '中', '大'][index]}</button>)}
              </div>
            </div>
          }
          if (command === 'insert-silence') {
            return <div key={command} className="dialogueAudioInsertSilenceCommand">
              <label className="dialogueAudioMenuNumber">挿入量 <input className="dialogueAudioFrameCount" type="number" min="1" max={timelineDurationFrames} value={silenceFrameCount} onChange={event => setSilenceFrameCount(Math.max(1, Math.round(Number(event.target.value) || 1)))} />F</label>
              <button type="button" role="menuitem" onClick={() => executeContextCommand(command)}>無音を挿入</button>
            </div>
          }
          return <button
            type="button"
            role="menuitem"
            key={command}
            className={command === 'clear-track' || command === 'remove-region' || command === 'ripple-delete' || command === 'delete-clips' ? 'isDanger' : undefined}
            onClick={() => executeContextCommand(command)}
          >{contextCommandLabel(command)}</button>
        })}
      </div>, document.body)}

      {pendingSoundRequest && !pendingSoundRequest.awaitingCutUpdate && <div className="dialogueAudioPromptBackdrop">
        <div className="dialogueAudioPrompt" role="alertdialog" aria-modal="true" aria-labelledby="dialogue-audio-extend-title">
          <h3 id="dialogue-audio-extend-title">音響指示がカット尺を越えます</h3>
          <p>セリフ区間は{pendingSoundRequest.requiredCutDuration}Fまであります。音声タイムラインの尺は変えず、タイムシートのカット尺だけを明示的に延長して割り付けますか？</p>
          <div>
            <button type="button" onClick={() => setPendingSoundRequest(null)}>キャンセル</button>
            <button type="button" className="dialogueAudioReflectButton" onClick={confirmSoundCutExtension}>カット尺を延長して割り付け</button>
          </div>
        </div>
      </div>}
    </section>
  )
}
