import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
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
  moveDialogueAudioClips,
  moveDialogueRegionAudioToFrame,
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
  assignmentForRegion,
  assignmentForCandidate,
  assignmentForCue,
  createDialogueAudioClipDragPreview,
  removeDialogueAudioRegion,
  resolveDialogueAssignment,
  resolveDialogueRegion,
  synchronizeDialogueAssignmentsAfterAudioEdit,
  synchronizeDialogueAssignmentsFromCues,
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
  SpeakerIcon,
  stopDialogueAudioSources as stopSources,
  timelineMarqueeStyle,
  type DialogueAudioTimelineGesture,
  type DialogueAudioTimelineTool,
} from './dialogueAudioTimelinePresentation'
import { ActionMenu } from './AppControls'
import { DialogueAudioWaveform } from './DialogueAudioWaveform'
import { Tooltip, TooltipTarget } from './Tooltip'
import {
  useDialogueAudioSegmentDrag,
  type DialogueAudioSegmentDragSession,
} from './useDialogueAudioSegmentDrag'

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
  } = props
  const cutDurationFrames = Math.max(1, props.cutDurationFrames ?? props.durationFrames ?? 144)
  const [collapsed, setCollapsed] = useState(true)
  const [playheadFrame, setPlayheadFrame] = useState(frameOrigin)
  const [viewPreferences, setViewPreferences] = useState(loadDialogueAudioViewPreferences)
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(720)
  const [playing, setPlaying] = useState(false)
  const [recording, setRecording] = useState(false)
  const [audioSelectionState, setAudioSelectionState] = useState<DialogueAudioSelectionState>(EMPTY_DIALOGUE_AUDIO_SELECTION)
  const [timelineTool, setTimelineTool] = useState<DialogueAudioTimelineTool>('select')
  const [timelineGesture, setTimelineGesture] = useState<DialogueAudioTimelineGesture | null>(null)
  const [silenceFrameCount, setSilenceFrameCount] = useState(1)
  const [clipboard, setClipboard] = useState<DialogueAudioClipboard | null>(null)
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
  const [clipDrag, setClipDrag] = useState<{
    trackId: string
    clipIds: string[]
    clientX: number
    minimumOriginFrame: number
    deltaFrames: number
    pixelsPerFrame: number
  } | null>(null)
  const timelineScrollerRef = useRef<HTMLDivElement | null>(null)
  const clipDragDisplay = useMemo(
    () => clipDrag && clipDrag.deltaFrames !== 0
      ? createDialogueAudioClipDragPreview(
          cutState,
          soundCues,
          activeRevisionId,
          clipDrag.trackId,
          clipDrag.clipIds,
          clipDrag.deltaFrames,
        )
      : null,
    [activeRevisionId, clipDrag, cutState, soundCues],
  )
  const {
    begin: beginSegmentDrag,
    preview: segmentDragDisplay,
    suppressClick: suppressSegmentClick,
  } = useDialogueAudioSegmentDrag({
    cutState,
    frameOrigin,
    getPixelsPerFrame: () => pixelsPerFrame,
    getFrameEnd: () => frameEnd,
    disabled: recording || playing || timelineTool === 'range',
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
  const [status, setStatus] = useState('')
  const cutStateRef = useRef(cutState)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourcesRef = useRef<AudioBufferSourceNode[]>([])
  const playbackRequestRef = useRef(0)
  const scrubSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const scrubRequestRef = useRef(0)
  const scrubDragRef = useRef<{ pointerId: number; lastFrame: number } | null>(null)
  const timelineGestureRef = useRef<DialogueAudioTimelineGesture | null>(null)
  const animationRef = useRef<number | null>(null)
  const playSessionRef = useRef<{ contextStart: number; frameStart: number; frameEnd: number } | null>(null)
  const recorderRef = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startFrame: number; trackId: string } | null>(null)
  const decodedRef = useRef(new Map<string, { dataUrl: string; audio: PcmAudio }>())
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
  const selectedCueAssignment = selectedCue ? assignmentForCue(cutState, selectedCue.cueId, activeRevisionId) : undefined
  const linkedHighlightRegionKeys = useMemo(
    () => new Set(selectedCueAssignment?.regionRefs.map(reference => `${reference.trackId}:${reference.regionId}`) ?? []),
    [selectedCueAssignment],
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
  }, [cutState])

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

  const setPlayhead = useCallback((frame: number) => {
    const liveFrameEnd = frameOrigin + Math.max(cutDurationFrames, cutStateRef.current.timelineDurationFrames) - 1
    const next = Math.max(frameOrigin, Math.min(liveFrameEnd, Math.round(frame)))
    setPlayheadFrame(next)
    onPlayheadChange(next)
  }, [cutDurationFrames, frameOrigin, onPlayheadChange])

  const consumedSoundCueNavigationRequestRef = useRef(0)
  useEffect(() => {
    if (!soundCueNavigationRequest || soundCueNavigationRequest.requestId === consumedSoundCueNavigationRequestRef.current) return
    const cue = soundCues.find(item => item.cueId === soundCueNavigationRequest.cueId)
    if (!cue || !assignmentForCue(cutState, cue.cueId, activeRevisionId)) return
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

  useEffect(() => () => {
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
    const cached = decodedRef.current.get(asset.assetId)
    if (cached?.dataUrl === asset.audioDataUrl) return cached.audio
    const audio = await decodeAudioDataUrl(asset.audioDataUrl, context)
    decodedRef.current.set(asset.assetId, { dataUrl: asset.audioDataUrl, audio })
    return audio
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
      if (track.trackId === omitTrackId || track.muted) continue
      for (const clip of track.clips) {
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
        source.buffer = audioBufferFromPcm(context, request.audio)
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
    if (direction === 0) return
    const state = cutStateRef.current
    const audibleTracks = state.tracks.filter(track => !track.muted)
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
      return asset && intersectionEnd >= intersectionStart
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
    if (!activeTrack) return
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
  ): Promise<DialogueSileroAnalysis | undefined> {
    const current = cutStateRef.current
    const track = current.tracks.find(item => item.trackId === trackId)
    if (!track) return
    const duration = durationFramesForAudio(audio, fps)
    const usedAssetIds = new Set(current.assets.map(asset => asset.assetId))
    const usedClipIds = new Set(current.tracks.flatMap(item => item.clips.map(clip => clip.clipId)))
    const assetId = nextUniqueId('dialogue-asset', usedAssetIds)
    const clipId = nextUniqueId(`${trackId}-clip`, usedClipIds)
    const audioDataUrl = await blobToDataUrl(pcmToWavBlob(audio))
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
      const analysis = await addAudioAssetClip(audio, target.frame, target.trackId, file.name)
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

  function commitCutState(nextInput: DialogueAudioCutState, recordHistory = true): boolean {
    const synchronized = synchronizeDialogueAssignmentsAfterAudioEdit(
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
    if (!source) return
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
    if (cut) silenceRange(range)
    setStatus(`${range.frameStart}–${range.frameEnd}Fを${cut ? '切り取り' : 'コピー'}しました。`)
  }

  function copyClipSelection(selection: Extract<DialogueAudioSelectionFocus, { kind: 'clip' }>, cut: boolean) {
    const track = cutState.tracks.find(item => item.trackId === selection.trackId)
    if (!track) return
    const copied = copyDialogueAudioClips(track, selection.clipIds)
    if (!copied) return
    setClipboard(copied)
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
    applyTrackEditTo(
      trackId,
      track => pasteDialogueAudioClipboard(track, clipboard, frame, mode),
      `${frame}Fへ${mode === 'insert' ? '挿入' : '上書き'}貼り付けしました。`,
    )
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
    if (!activeTrack) return
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

  function openDialogueRegion(track: DialogueAudioTrackState, regionId: string) {
    const region = track.dialogueRegions.find(item => item.regionId === regionId)
    if (!region) return
    const candidates = track.speechCandidates.filter(candidate => region.candidateIds.includes(candidate.candidateId))
    setAudioSelectionState(replaceDialogueAudioSelection([{
      kind: 'region',
      trackId: track.trackId,
      id: regionId,
    }]))
    if (candidates.length === 0) return
    const assignment = assignmentForRegion(cutState, { trackId: track.trackId, regionId }, activeRevisionId)
    const cue = assignment ? soundCues.find(item => item.cueId === assignment.cueId) : undefined
    if (cue) {
      onSoundCueSelect(cue.cueId)
      onSoundCandidateEdit(
        track.trackId,
        region.candidateIds,
        region.frameStart,
        region.frameEnd,
        cue.cueId,
      )
      return
    }
    openCandidateSoundRange(track.trackId, candidates, region.frameStart, region.frameEnd)
  }

  function openCandidateSound(trackId: string, candidates: DialogueSpeechCandidate[]) {
    const assignments = candidates.map(candidate => assignmentForCandidate(cutState, candidate.candidateId, activeRevisionId)).filter(Boolean)
    const linkedCueId = assignments.length === candidates.length && new Set(assignments.map(assignment => assignment?.cueId)).size === 1 ? assignments[0]?.cueId : undefined
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
    if (event.target !== event.currentTarget || recording) return
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase()
      if (key === 'c' && audioSelection) {
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
    const toolKey = event.key.toLowerCase()
    if (toolKey === 'v' || toolKey === 'r') {
      event.preventDefault()
      setTimelineTool(toolKey === 'v' ? 'select' : 'range')
      setStatus(toolKey === 'v' ? '選択ツール' : '時間範囲選択ツール')
      return
    }
    if (event.key === 'Delete' && audioSelection && !playing) {
      event.preventDefault()
      if (audioSelection.kind === 'clip') deleteClipSelection(audioSelection)
      else if (event.shiftKey) rippleDelete(audioSelection)
      else silenceSelection()
      return
    }
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (direction === 0) return
    event.preventDefault()
    if (playing) stopPlayback()
    if (audioSelection?.kind === 'clip') {
      const track = cutState.tracks.find(item => item.trackId === audioSelection.trackId)
      const earliest = track
        ? Math.min(...track.clips.filter(clip => audioSelection.clipIds.includes(clip.clipId)).map(clip => clip.timelineStartFrame))
        : frameOrigin
      const delta = direction < 0 ? Math.max(direction, frameOrigin - earliest) : direction
      if (track && delta !== 0) {
        const nextTrack = moveDialogueAudioClips(track, audioSelection.clipIds, delta)
        commitCutState({ ...cutState, tracks: cutState.tracks.map(item => item.trackId === track.trackId ? nextTrack : item) })
        setStatus(`${audioSelection.clipIds.length}個の音声クリップを${direction < 0 ? '左' : '右'}へ1F移動しました。`)
      }
      return
    }
    const nextFrame = Math.max(frameOrigin, Math.min(frameEnd, playheadFrame + direction))
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
    event.preventDefault()
    if (playing) stopPlayback()
    else stopScrubPlayback()
    const frame = frameForClientX(event.clientX)
    const contentRect = timelineContentRef.current?.getBoundingClientRect()
      ?? event.currentTarget.getBoundingClientRect()
    event.currentTarget.setPointerCapture(event.pointerId)
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
      additive: event.ctrlKey || event.metaKey || event.shiftKey,
      tool: timelineTool,
      initialSelection: audioSelectionState,
      contentRect: {
        left: contentRect.left,
        top: contentRect.top,
        width: contentRect.width,
        height: contentRect.height,
      },
    }
    timelineGestureRef.current = gesture
    setTimelineGesture(gesture)
  }

  function moveTimelineGesture(event: ReactPointerEvent<HTMLDivElement>) {
    const current = timelineGestureRef.current
    if (!current || current.pointerId !== event.pointerId) return
    const moved = current.moved || Math.hypot(
      event.clientX - current.startClientX,
      event.clientY - current.startClientY,
    ) >= TIMELINE_DRAG_THRESHOLD
    const next = {
      ...current,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      moved,
    }
    timelineGestureRef.current = next
    setTimelineGesture(next)
    if (!moved) return
    const frame = frameForClientX(event.clientX)
    const range = normalizeDialogueAudioRange(current.anchorFrame, frame)
    if (current.tool === 'range') {
      setAudioSelectionState({
        entities: current.initialSelection.entities,
        timeRange: { trackId: current.trackId, ...range },
      })
      return
    }
    const trackIds = tracksIntersectingMarquee(current.startClientY, event.clientY)
    const hits = collectDialogueAudioMarqueeEntities(cutState, trackIds, range)
    setAudioSelectionState(applyDialogueAudioMarqueeSelection(
      current.initialSelection,
      hits,
      current.additive,
    ))
  }

  function finishTimelineGesture(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    const current = timelineGestureRef.current
    if (!current || current.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (cancelled) {
      setAudioSelectionState(current.initialSelection)
    } else if (!current.moved) {
      if (current.tool === 'range') {
        setAudioSelectionState({ entities: current.initialSelection.entities, timeRange: null })
      } else if (!current.additive) {
        clearAudioFocus()
      }
      setPlayhead(frameForClientX(event.clientX))
    }
    timelineGestureRef.current = null
    setTimelineGesture(null)
  }

  function tracksIntersectingMarquee(startClientY: number, currentClientY: number): string[] {
    const rect = timelineContentRef.current?.getBoundingClientRect()
    if (!rect) return []
    const top = Math.min(startClientY, currentClientY) - rect.top
    const bottom = Math.max(startClientY, currentClientY) - rect.top
    let trackTop = TIME_RULER_HEIGHT
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
    }, event.ctrlKey || event.metaKey || event.shiftKey)
  }

  function selectRegion(event: ReactMouseEvent<HTMLButtonElement>, track: DialogueAudioTrackState, region: DialogueRegion) {
    event.stopPropagation()
    if (timelineTool === 'range') return
    selectSegmentEntity(track, {
      kind: 'region',
      id: region.regionId,
    }, event.ctrlKey || event.metaKey || event.shiftKey)
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

  function beginClipDrag(event: ReactPointerEvent<HTMLButtonElement>, trackId: string, clip: DialogueAudioClip) {
    if (recording || playing || event.button !== 0) return
    event.stopPropagation()
    const track = cutState.tracks.find(item => item.trackId === trackId)
    if (!track) return
    const currentIds = audioSelectionState.entities
      .filter(entity => entity.kind === 'clip' && entity.trackId === trackId)
      .map(entity => entity.id)
    const additive = event.ctrlKey || event.metaKey || event.shiftKey
    const clipIds = additive
      ? currentIds.includes(clip.clipId)
        ? currentIds.filter(clipId => clipId !== clip.clipId)
        : [...currentIds, clip.clipId]
      : currentIds.includes(clip.clipId)
        ? currentIds
        : [clip.clipId]
    const selection = clipSelectionForIds(track, clipIds)
    setSelectionFromFocus(selection)
    if (!selection || !selection.clipIds.includes(clip.clipId)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const selectedClips = track.clips.filter(item => selection.clipIds.includes(item.clipId))
    setClipDrag({
      trackId,
      clipIds: selection.clipIds,
      clientX: event.clientX,
      minimumOriginFrame: Math.min(...selectedClips.map(item => item.timelineStartFrame)),
      deltaFrames: 0,
      pixelsPerFrame,
    })
    if (viewPreferences.fitTimeline) {
      setViewPreferences(current => ({ ...current, fitTimeline: false, pixelsPerFrame }))
    }
    if (cutState.activeTrackId !== trackId) {
      onCutStateChange({ cutState: { ...cutState, activeTrackId: trackId }, recordHistory: false })
    }
  }

  function moveClipDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!clipDrag) return
    const requestedDelta = Math.round((event.clientX - clipDrag.clientX) / clipDrag.pixelsPerFrame)
    const deltaFrames = Math.max(frameOrigin - clipDrag.minimumOriginFrame, requestedDelta)
    if (deltaFrames !== clipDrag.deltaFrames) {
      setClipDrag({ ...clipDrag, deltaFrames })
    }

    const scroller = timelineScrollerRef.current
    if (!scroller) return
    const rect = scroller.getBoundingClientRect()
    if (event.clientX > rect.right - 32) scroller.scrollLeft += Math.max(12, clipDrag.pixelsPerFrame * 2)
    else if (event.clientX < rect.left + 32) scroller.scrollLeft = Math.max(0, scroller.scrollLeft - Math.max(12, clipDrag.pixelsPerFrame * 2))
  }

  function finishClipDrag(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) {
    if (!clipDrag) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!cancelled && clipDrag.deltaFrames !== 0) {
      const track = cutState.tracks.find(item => item.trackId === clipDrag.trackId)
      if (track) {
        const nextTrack = moveDialogueAudioClips(track, clipDrag.clipIds, clipDrag.deltaFrames)
        if (commitCutState({ ...cutState, tracks: cutState.tracks.map(item => item.trackId === track.trackId ? nextTrack : item) })) {
          setStatus(`${clipDrag.clipIds.length}個の音声クリップを${Math.abs(clipDrag.deltaFrames)}F${clipDrag.deltaFrames < 0 ? '左' : '右'}へ移動し、リンクSOUNDを追従しました。`)
        }
      }
    }
    setClipDrag(null)
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
    return viewPreferences.trackHeights[trackId] ?? DIALOGUE_AUDIO_TRACK_HEIGHT_PRESETS.small
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
      const track = cutState.tracks.find(item => item.trackId === target.trackId)
      const candidates = track?.speechCandidates.filter(candidate => target.candidateIds.includes(candidate.candidateId)) ?? []
      if (candidates.length > 0) {
        setSelectionFromFocus(candidateSelection(target.trackId, candidates))
      } else clearAudioFocus()
    } else if (target.kind === 'region') {
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
    commitCutState(synchronizeDialogueAssignmentsFromCues({
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
    const assignment = assignmentForRegion(cutState, { trackId: target.trackId, regionId: target.regionId }, activeRevisionId)
    return assignment ? soundCues.find(cue => cue.cueId === assignment.cueId) : undefined
  }

  function alignAudioToCue(target: DialogueAudioContextTarget) {
    const cue = linkedCueForTarget(target)
    if (!cue) return
    if (target.kind === 'region') {
      const next = moveDialogueRegionAudioToFrame(cutState, target.trackId, target.regionId, cue.frameStart)
      commitCutState(next)
      setStatus(`音声区間をSOUNDの${cue.frameStart}Fへ揃えました。`)
      return
    }
    if (target.kind !== 'cue') return
    const assignment = assignmentForCue(cutState, target.cueId, activeRevisionId)
    const resolution = assignment ? resolveDialogueAssignment(cutState, assignment) : null
    if (!assignment || !resolution) return
    const delta = cue.frameStart - resolution.frameStart
    const next = assignment.regionRefs.reduce((state, ref) => {
      const track = state.tracks.find(item => item.trackId === ref.trackId)
      const region = track?.dialogueRegions.find(item => item.regionId === ref.regionId)
      return region ? moveDialogueRegionAudioToFrame(state, ref.trackId, ref.regionId, region.frameStart + delta) : state
    }, cutState)
    commitCutState(next)
    setStatus(`リンク音声をSOUNDの${cue.frameStart}Fへ揃えました。`)
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
      const assignment = assignmentForCue(cutState, target.cueId, activeRevisionId)
      resolution = assignment ? resolveDialogueAssignment(cutState, assignment) : null
    }
    if (!resolution) return
    if (resolution.frameEnd > cutFrameEnd) {
      setStatus('音声区間がタイムシート尺を越えるため、SOUNDを揃えられません。先にカット尺を変更してください。')
      return
    }
    onSoundCueTransform(cue.cueId, { laneId: cue.laneId, frameStart: resolution.frameStart, frameEnd: resolution.frameEnd })
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
    } else if (command === 'assign-sound') createSoundForTarget(target)
    else if (command === 'copy' && target.kind === 'clip') copyClipSelection(target, false)
    else if (command === 'cut' && target.kind === 'clip') copyClipSelection(target, true)
    else if (command === 'copy' && range) copyRange(range, false)
    else if (command === 'cut' && range) copyRange(range, true)
    else if (command === 'silence' && range) silenceRange(range)
    else if (command === 'ripple-delete' && range) rippleDelete(range)
    else if (command === 'delete-clips' && target.kind === 'clip') deleteClipSelection(target)
    else if (command === 'redetect-clips' && target.kind === 'clip') void redetectTrack(target.trackId, undefined, target.clipIds)
    else if ((command === 'ignore-candidate' || command === 'restore-candidate') && target.kind === 'candidate') {
      const track = cutState.tracks.find(item => item.trackId === target.trackId)
      if (!track) return
      const nextTrack = target.candidateIds.reduce((current, candidateId) => (
        command === 'ignore-candidate'
          ? assignmentForCandidate(cutState, candidateId, activeRevisionId) ? current : ignoreDialogueSpeechCandidate(current, candidateId)
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
      commitCutState(synchronizeDialogueAssignmentsFromCues(unlinked, soundCues, activeRevisionId))
      setStatus('SOUNDとのリンクを解除しました。音声とラベルは保持しています。')
    } else if (command === 'remove-region' && target.kind === 'region') {
      const removed = removeDialogueAudioRegion(cutState, target.trackId, target.regionId)
      commitCutState(synchronizeDialogueAssignmentsFromCues(removed, soundCues, activeRevisionId))
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
      })
    : []
  const trackRows = cutState.tracks.map(track => `${trackHeight(track.trackId)}px`).join(' ')
  const headerRows = `${TIME_RULER_HEIGHT}px ${trackRows}`
  const contentHeight = TIME_RULER_HEIGHT + cutState.tracks.reduce((sum, track) => sum + trackHeight(track.trackId), 0)
  const audioEndsAtCut = audioContentDurationFrames === cutDurationFrames

  if (collapsed) {
    return (
      <section className="dialogueAudioTimeline isCollapsed" aria-label="セリフ音声タイムライン">
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
    >
      <div
        className="dialogueAudioPanelResizeHandle"
        role="separator"
        aria-label="音声タイムラインの高さを変更"
        aria-orientation="horizontal"
        aria-valuemin={180}
        aria-valuemax={720}
        aria-valuenow={viewPreferences.panelHeight}
        tabIndex={0}
        onPointerDown={event => {
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
      />
      <div className="dialogueAudioToolbar">
        <div className="dialogueAudioToolbarMain">
          <button type="button" className="dialogueAudioCollapse" onClick={() => setCollapsed(true)} aria-expanded="true" disabled={recording}>▾ 音声</button>
          <span className="dialogueAudioTime">{formatFrame(playheadFrame, frameOrigin, fps)}</span>
          <span className="dialogueAudioToolGroup" aria-label="タイムラインツール">
            <Tooltip label="選択ツール（V）。クリックで項目選択、空白からドラッグで矩形選択">
              <button
                type="button"
                className={`dialogueAudioIconButton ${timelineTool === 'select' ? 'isActiveTool' : ''}`}
                aria-label="選択ツール"
                aria-pressed={timelineTool === 'select'}
                onClick={() => setTimelineTool('select')}
              ><SelectionToolIcon /></button>
            </Tooltip>
            <Tooltip label="時間範囲選択ツール（R）。ドラッグした場合だけ範囲を作成">
              <button
                type="button"
                className={`dialogueAudioIconButton ${timelineTool === 'range' ? 'isActiveTool' : ''}`}
                aria-label="時間範囲選択ツール"
                aria-pressed={timelineTool === 'range'}
                onClick={() => setTimelineTool('range')}
              ><RangeToolIcon /></button>
            </Tooltip>
          </span>
          <span className="dialogueAudioToolGroup" aria-label="再生と録音">
            <Tooltip label="カット頭から再生">
              <button type="button" className="dialogueAudioIconButton" aria-label="⏮ カット頭から" onClick={() => { setPlayhead(frameOrigin); void startPlayback(frameOrigin) }} disabled={recording}>⏮</button>
            </Tooltip>
            <Tooltip label={playing ? '一時停止' : '再生。末尾では頭から再開'}>
              <button type="button" className="dialogueAudioIconButton" aria-label={playing ? '⏸ 一時停止' : '▶ 再生ヘッドから'} onClick={() => playing ? stopPlayback() : void startPlayback()} disabled={recording}>{playing ? '⏸' : '▶'}</button>
            </Tooltip>
            <Tooltip label={recording ? '録音終了' : '録音'}>
              <button type="button" className={`dialogueAudioIconButton ${recording ? 'isRecording' : ''}`} aria-label={recording ? '■ 録音終了' : '● 録音'} onClick={() => void toggleRecording()} disabled={!recording && vadEngine.status === 'loading'}>{recording ? '■' : '●'}</button>
            </Tooltip>
            <Tooltip label="音声ファイルを再生ヘッドへ読み込む">
              <button
                type="button"
                className="dialogueAudioIconButton"
                aria-label="音声ファイルを読み込む"
                onClick={() => activeTrack && requestAudioImport(activeTrack.trackId, playheadFrame)}
                disabled={recording || playing || vadEngine.status === 'loading' || !activeTrack}
              ><AudioImportIcon /></button>
            </Tooltip>
          </span>
          <span className="dialogueAudioToolGroup" aria-label="音声編集">
            <Tooltip label="元に戻す">
              <button type="button" className="dialogueAudioIconButton" onClick={onUndo} disabled={recording || playing || !canUndo} aria-label="元に戻す">↶</button>
            </Tooltip>
            <Tooltip label="やり直す">
              <button type="button" className="dialogueAudioIconButton" onClick={onRedo} disabled={recording || playing || !canRedo} aria-label="やり直す">↷</button>
            </Tooltip>
            <Tooltip label="1フレーム挿入">
              <button type="button" className="dialogueAudioIconButton" onClick={() => insertSilence(1)} disabled={recording || playing || !activeTrack?.clips.length} aria-label="+1F">+F</button>
            </Tooltip>
            <Tooltip label="1フレームをリップル削除">
              <button type="button" className="dialogueAudioIconButton" onClick={() => rippleDelete()} disabled={recording || playing || !activeTrack?.clips.length} aria-label="−1F">−F</button>
            </Tooltip>
          </span>
          <input ref={fileInputRef} type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm" hidden onChange={event => void importAudio(event)} />
          <button
            type="button"
            className="dialogueAudioReflectButton"
            onClick={createSoundFromSelection}
            disabled={selectedCandidates.length === 0 && selectedRegions.length !== 1 && !audioSelectionState.timeRange}
          >{(selectedCandidate && assignmentForCandidate(cutState, selectedCandidate.candidateId, activeRevisionId))
            || (selectedRegions.length === 1 && assignmentForRegion(cutState, {
              trackId: activeTrack?.trackId ?? '',
              regionId: selectedRegions[0].regionId,
            }, activeRevisionId))
            ? '音響指示を編集'
            : '音響指示へ割付…'}</button>
          {selectedFrameRange && <span className="dialogueAudioSelectionSummary">{dialogueAudioSelectionSummary(audioSelectionState, selectedFrameRange)}</span>}
          <span className="dialogueAudioToolbarSpacer" />
          <TooltipTarget label={vadEngine.error ?? ''} disabled={!vadEngine.error}>
            {tooltipProps => <span className={`dialogueVadEngine is-${vadEngine.status}`} role="status" {...tooltipProps}>{vadEngineLabel(vadEngine.status)}</span>}
          </TooltipTarget>
          <span className="dialogueAudioZoomTools" aria-label="タイムライン表示倍率">
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={zoomSliderValue}
              onChange={event => setTimelineZoom(Number(event.currentTarget.value))}
              aria-label="音声タイムラインのズーム"
              aria-valuetext={viewPreferences.fitTimeline ? '全体表示' : '拡大表示'}
            />
            <Tooltip label="タイムラインの編集範囲全体を表示">
              <button type="button" className={`dialogueAudioFitButton ${viewPreferences.fitTimeline ? 'isOn' : ''}`} onClick={fitTimeline} aria-label="音声タイムライン全体を表示">全体</button>
            </Tooltip>
          </span>
          <ActionMenu
            className="dialogueAudioSettingsMenu"
            label={<span aria-hidden="true">⚙</span>}
            ariaLabel="音声タイムライン設定"
            tooltipLabel="音声タイムライン設定"
          >
            <div className="dialogueAudioMenuLabel">VAD検出設定</div>
            <label>録音VAD環境<select value={cutState.detectionPreset} disabled={vadEngine.status === 'loading'} onChange={event => onCutStateChange({
              cutState: { ...cutState, detectionPreset: event.target.value as DialogueAudioCutState['detectionPreset'] },
              recordHistory: false,
            })}>
              <option value="quiet">静か</option><option value="normal">通常</option><option value="noisy">騒がしい</option>
            </select></label>
            <label>検出感度<input type="range" min="0" max="1" step="0.01" value={cutState.detectionSensitivity} disabled={vadEngine.status === 'loading'} onChange={event => onCutStateChange({
              cutState: { ...cutState, detectionSensitivity: Number(event.target.value) },
              recordHistory: false,
            })} /></label>
            <label>途切れにくさ<input type="range" min="0" max="1" step="0.01" value={cutState.detectionStability} disabled={vadEngine.status === 'loading'} onChange={event => onCutStateChange({
              cutState: { ...cutState, detectionStability: Number(event.target.value) },
              recordHistory: false,
            })} /></label>
          </ActionMenu>
        </div>
      </div>
      {status && <div className="dialogueAudioNotice" role="status">{status}</div>}

      <div className="dialogueAudioBody">
        <aside
          ref={timelineHeaderRef}
          className="dialogueAudioTrackHeaders"
          style={{ gridTemplateRows: headerRows }}
        >
          <div className="dialogueAudioRulerHeader" aria-hidden="true" />
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
              <TooltipTarget label={track.trackId === cutState.activeTrackId ? '録音先' : 'このトラックを録音先にする'}>
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
                </button>}
              </TooltipTarget>
              <TooltipTarget label={track.muted ? 'ミュートを解除' : 'このトラックをミュート'}>
                {tooltipProps => <button
                  type="button"
                  className={`dialogueAudioTrackMute ${track.muted ? 'isMuted' : ''}`}
                  onClick={() => updateTrack(track.trackId, { muted: !track.muted })}
                  aria-label={track.muted ? `音声トラック${trackIndex + 1}のミュートを解除` : `音声トラック${trackIndex + 1}をミュート`}
                  aria-pressed={track.muted}
                  {...tooltipProps}
                ><SpeakerIcon muted={track.muted} /></button>}
              </TooltipTarget>
              <span
                className="dialogueAudioTrackResizeHandle"
                role="separator"
                aria-label={`音声トラック${trackIndex + 1}の高さを変更`}
                aria-orientation="horizontal"
                onPointerDown={event => {
                  event.preventDefault()
                  setTrackResize({ trackId: track.trackId, startY: event.clientY, startHeight: trackHeight(track.trackId) })
                }}
              />
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
            onKeyDown={handleTimelineKeyDown}
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
                  onPointerMove={moveTimelineGesture}
                  onPointerUp={event => finishTimelineGesture(event)}
                  onPointerCancel={event => finishTimelineGesture(event, true)}
                >
                  {track.clips.length === 0 && <span className="dialogueAudioEmpty">録音または音声読込</span>}
                  {track.clips.map(sourceClip => {
                    const asset = cutState.assets.find(item => item.assetId === sourceClip.assetId)
                    return asset ? <span key={sourceClip.clipId} className="dialogueAudioClip">
                      <DialogueAudioWaveform asset={asset} clip={sourceClip} color={track.color} frameOrigin={frameOrigin} durationFrames={timelineDurationFrames} />
                      <TooltipTarget label="クリックで選択 / Ctrlクリックで複数選択 / ドラッグで移動">
                        {tooltipProps => <button
                          type="button"
                          className={`dialogueAudioClipHandle ${dialogueAudioSelectionContains(audioSelectionState, {
                            kind: 'clip',
                            trackId: track.trackId,
                            id: sourceClip.clipId,
                          }) ? 'isSelected' : ''}`}
                          data-track-id={track.trackId}
                          data-clip-id={sourceClip.clipId}
                          data-source-name={asset.sourceName ?? ''}
                          data-frame-start={sourceClip.timelineStartFrame}
                          data-frame-end={sourceClip.timelineStartFrame + sourceClip.durationFrames - 1}
                          style={{
                            ...rangeStyle(sourceClip.timelineStartFrame, sourceClip.timelineStartFrame + sourceClip.durationFrames - 1, frameOrigin, timelineDurationFrames),
                            top: 1 + dialogueAudioClipHandleLane(track.clips, sourceClip.clipId) * 13,
                          }}
                          {...tooltipProps}
                          onPointerDown={event => {
                            tooltipProps.onPointerDown()
                            if (timelineTool !== 'range') beginClipDrag(event, track.trackId, sourceClip)
                          }}
                          onPointerMove={moveClipDrag}
                          onPointerUp={event => finishClipDrag(event)}
                          onPointerCancel={event => finishClipDrag(event, true)}
                          onContextMenu={event => openContextMenu(event, {
                            kind: 'clip',
                            trackId: track.trackId,
                            clipIds: [sourceClip.clipId],
                            frameStart: sourceClip.timelineStartFrame,
                            frameEnd: sourceClip.timelineStartFrame + sourceClip.durationFrames - 1,
                          })}
                          aria-label={`音声クリップ ${asset.sourceName ?? sourceClip.clipId}`}
                        >⋮⋮</button>}
                      </TooltipTarget>
                    </span> : null
                  })}
                  {track.speechCandidates.filter(candidate => !regionCandidateIds.has(candidate.candidateId)).map(candidate => {
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
                  {track.dialogueRegions.map(region => {
                    const assignment = assignmentForRegion(displayCutState, { trackId: track.trackId, regionId: region.regionId }, activeRevisionId)
                    const cue = assignment ? soundCues.find(item => item.cueId === assignment.cueId) : undefined
                    const label = cue?.label ?? ''
                    const regionSelected = dialogueAudioSelectionContains(audioSelectionState, {
                      kind: 'region',
                      trackId: track.trackId,
                      id: region.regionId,
                    })
                    const presentationState = assignment?.status ?? (region.status === 'ready' ? 'unassigned' : region.status)
                    const tooltipLabel = assignment
                      ? `割付済み：${label || '名称なし'} ${region.frameStart}–${region.frameEnd}F`
                      : `未割付のセリフ区間 ${region.frameStart}–${region.frameEnd}F`
                    return <DialogueSpeechSegmentButton
                      key={region.regionId}
                      tooltip={tooltipLabel}
                      className={`dialogueSpeechSegment is-region is-${presentationState} ${linkedHighlightRegionKeys.has(`${track.trackId}:${region.regionId}`) ? 'isLinkedHighlight' : ''} ${regionSelected ? 'isSelected' : ''}`}
                      style={candidateHitStyle(region.frameStart, region.frameEnd, frameOrigin, timelineDurationFrames, timelineWidth)}
                      label={label}
                      ariaLabel={`セリフ区間 ${region.frameStart}–${region.frameEnd}F ${assignment ? `${label || '名称なし'}へ割付済み` : '未割付'}`}
                      segmentKind="region"
                      trackId={track.trackId}
                      segmentId={region.regionId}
                      frameStart={region.frameStart}
                      frameEnd={region.frameEnd}
                      linked={Boolean(assignment)}
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
                          linked: Boolean(assignment),
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
              onKeyDown={handleTimelineKeyDown}
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
