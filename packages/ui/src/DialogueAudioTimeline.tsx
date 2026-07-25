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
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { formatLogicalSheetFrameTimecode, type TimedRangeCue } from '@xsheet-remap/core'
import {
  copyDialogueAudioRange,
  ignoreDialogueSpeechCandidate,
  insertDialogueAudioSilence,
  moveDialogueAudioClip,
  moveDialogueRegionAudioToFrame,
  nextUniqueId,
  normalizeDialogueAudioRange,
  pasteDialogueAudioClipboard,
  reconcileDialogueSpeechCandidates,
  replaceDialogueAudioRangeWithClip,
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
  type DialogueSpeechCandidate,
  type DialogueSpeechRange,
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
  planDialogueAudioRulerTicks,
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
import { ActionMenu } from './AppControls'
import { Tooltip, TooltipTarget } from './Tooltip'

interface DialogueAudioTimelineProps {
  cutState: DialogueAudioCutState
  fps: number
  frameOrigin: number
  cutDurationFrames?: number
  /** @deprecated Kept for embedders while they migrate to cutDurationFrames. */
  durationFrames?: number
  activeRevisionId: string
  soundCues: TimedRangeCue[]
  selectedSoundCueId: string | null
  onCutStateChange: (change: {
    cutState: DialogueAudioCutState
    cueUpdates?: Array<{ cueId: string; frameStart: number; frameEnd: number }>
    recordHistory?: boolean
  }) => void
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
  onCutDurationChange?: (durationFrames: number) => void
  onPlayheadChange: (frame: number) => void
  onSoundCueSelect: (cueId: string) => void
  onSoundCueEdit: (cueId: string) => void
  onSoundCueTransform: (cueId: string, updates: { laneId: string; frameStart: number; frameEnd: number }) => void
  onSoundCandidateEdit: (trackId: string, candidateIds: string[], frameStart: number, frameEnd: number, cueId?: string) => void
  onAutoCreateDialogueRegions: (state: DialogueAudioCutState, trackId: string, candidateIds: string[]) => DialogueAudioCutState
}

const SCRUB_EDGE_FADE_SECONDS = 0.001
const TIME_RULER_HEIGHT = 40
const CONTEXT_MENU_EDGE = 8
const CONTEXT_MENU_WIDTH = 260

export function DialogueAudioTimeline(props: DialogueAudioTimelineProps) {
  const {
    cutState, fps, frameOrigin, activeRevisionId, soundCues, selectedSoundCueId,
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
  const [audioSelection, setAudioSelection] = useState<DialogueAudioSelectionFocus | null>(null)
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([])
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const [selectionDrag, setSelectionDrag] = useState<{ trackId: string; anchorFrame: number } | null>(null)
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
    requiredCutDuration: number
    awaitingCutUpdate: boolean
  } | null>(null)
  const [panelResize, setPanelResize] = useState<{ startY: number; startHeight: number } | null>(null)
  const [trackResize, setTrackResize] = useState<{ trackId: string; startY: number; startHeight: number } | null>(null)
  const [cueDrag, setCueDrag] = useState<{
    cueId: string
    mode: 'start' | 'body' | 'end'
    clientX: number
    origin: TimedRangeCue
    preview: TimedRangeCue
  } | null>(null)
  const [clipDrag, setClipDrag] = useState<{
    trackId: string
    clipId: string
    clientX: number
    originFrame: number
    previewFrame: number
    durationFrames: number
    pixelsPerFrame: number
  } | null>(null)
  const audioContentFrameEnd = clipDrag
    ? cutState.tracks.reduce<number | null>((latest, track) => track.clips.reduce<number | null>((trackLatest, clip) => {
        const clipFrameEnd = clip.clipId === clipDrag.clipId
          ? clipDrag.previewFrame + clipDrag.durationFrames - 1
          : clip.timelineStartFrame + clip.durationFrames - 1
        return trackLatest === null ? clipFrameEnd : Math.max(trackLatest, clipFrameEnd)
      }, latest), null)
    : dialogueAudioContentEndFrame(cutState)
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
  const animationRef = useRef<number | null>(null)
  const playSessionRef = useRef<{ contextStart: number; frameStart: number; frameEnd: number } | null>(null)
  const recorderRef = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startFrame: number; trackId: string } | null>(null)
  const decodedRef = useRef(new Map<string, { dataUrl: string; audio: PcmAudio }>())
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const pendingImportRef = useRef<{ trackId: string; frame: number } | null>(null)
  const timelineContentRef = useRef<HTMLDivElement | null>(null)
  const timelineScrollerRef = useRef<HTMLDivElement | null>(null)
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
  const selectedCueFrameStart = selectedCue?.frameStart
  const selectedCueAssignmentId = selectedCueAssignment?.assignmentId
  const selectedCandidates = activeTrack?.speechCandidates.filter(candidate => selectedCandidateIds.includes(candidate.candidateId)) ?? []
  const selectedCandidate = selectedCandidates[0] ?? null

  useEffect(() => {
    cutStateRef.current = cutState
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
        Math.min(...request.candidates.map(candidate => candidate.frameStart)),
        Math.max(...request.candidates.map(candidate => candidate.frameEnd)),
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

  useEffect(() => {
    if (selectedCueFrameStart === undefined || !selectedCueAssignmentId) return
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
      setPlayhead(selectedCueFrameStart)
      const firstRef = selectedCueAssignment?.regionRefs[0]
      const regionTrack = firstRef ? cutState.tracks.find(track => track.trackId === firstRef.trackId) : undefined
      const region = regionTrack?.dialogueRegions.find(item => item.regionId === firstRef?.regionId)
      if (firstRef && region) {
        setSelectedRegionId(region.regionId)
        setSelectedCandidateIds(region.candidateIds)
        setAudioSelection({ kind: 'region', trackId: firstRef.trackId, frameStart: region.frameStart, frameEnd: region.frameEnd })
        if (cutState.activeTrackId !== firstRef.trackId) {
          onCutStateChange({ cutState: { ...cutState, activeTrackId: firstRef.trackId }, recordHistory: false })
        }
      }
    })
    return () => { cancelled = true }
  }, [cutState, onCutStateChange, selectedCueAssignment, selectedCueAssignmentId, selectedCueFrameStart, setPlayhead])

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
    const range = { frameStart: timelineStartFrame, frameEnd: timelineStartFrame + Math.max(1, duration) - 1 }
    const nextTrack = replaceDialogueAudioRangeWithClip(track, range, clip, [])
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
    const affectedCandidates = latestTrack.speechCandidates.filter(candidate => rangesOverlap(candidate, currentClipRange))
    const unaffectedCandidates = latestTrack.speechCandidates.filter(candidate => !rangesOverlap(candidate, currentClipRange))
    const analyzedCandidates = reconcileDialogueSpeechCandidates(affectedCandidates, detectedRanges, trackId)
    const analyzedTrack = {
      ...latestTrack,
      speechCandidates: [...unaffectedCandidates, ...analyzedCandidates].sort((left, right) => left.frameStart - right.frameStart || left.candidateId.localeCompare(right.candidateId)),
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

  function commitCutState(nextInput: DialogueAudioCutState, recordHistory = true) {
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
    cutStateRef.current = next
    onCutStateChange({
      cutState: next,
      cueUpdates: synchronized.cueUpdates,
      recordHistory,
    })
  }

  function applyTrackEditTo(trackId: string, edit: (track: DialogueAudioTrackState) => DialogueAudioTrackState, message: string) {
    const source = cutState.tracks.find(track => track.trackId === trackId)
    if (!source) return
    const nextTrack = edit(source)
    commitCutState({ ...cutState, tracks: cutState.tracks.map(track => track.trackId === trackId ? nextTrack : track) })
    setStatus(message)
  }

  function insertSilence(frameCount = silenceFrameCount) {
    if (!activeTrack) return
    insertSilenceAt(activeTrack.trackId, audioSelection?.frameStart ?? playheadFrame, frameCount)
  }

  function insertSilenceAt(trackId: string, frame: number, frameCount = silenceFrameCount) {
    applyTrackEditTo(
      trackId,
      track => insertDialogueAudioSilence(track, frame, frameCount),
      `${frame}Fへ無音${frameCount}フレームを挿入しました。`,
    )
  }

  function rippleDelete(range = audioSelection ?? { frameStart: playheadFrame, frameEnd: playheadFrame, trackId: activeTrack?.trackId ?? '' }) {
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
    if (audioSelection) copyRange(audioSelection, cut)
  }

  function copyRange(range: DialogueAudioRange & { trackId: string }, cut: boolean) {
    const track = cutState.tracks.find(item => item.trackId === range.trackId)
    if (!track) return
    setClipboard(copyDialogueAudioRange(track, range))
    if (cut) silenceRange(range)
    setStatus(`${range.frameStart}–${range.frameEnd}Fを${cut ? '切り取り' : 'コピー'}しました。`)
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

  async function redetectTrack(trackId: string, range?: DialogueAudioRange) {
    const sourceTrack = cutState.tracks.find(track => track.trackId === trackId)
    if (!sourceTrack?.clips.length) return
    try {
      setVadEngine({ status: 'loading' })
      const assetById = new Map(cutState.assets.map(asset => [asset.assetId, asset]))
      const ranges: DialogueSpeechRange[] = []
      let lastAnalysis: DialogueSileroAnalysis | undefined
      for (const clip of sourceTrack.clips) {
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
        ranges.push(...analysis.speechRanges)
      }
      const candidates = range
        ? [
            ...sourceTrack.speechCandidates.filter(candidate => candidate.frameEnd < range.frameStart || candidate.frameStart > range.frameEnd),
            ...reconcileDialogueSpeechCandidates(
              sourceTrack.speechCandidates.filter(candidate => candidate.frameStart <= range.frameEnd && candidate.frameEnd >= range.frameStart),
              mergeRanges(ranges),
              sourceTrack.trackId,
            ),
          ].sort((left, right) => left.frameStart - right.frameStart || left.candidateId.localeCompare(right.candidateId))
        : reconcileDialogueSpeechCandidates(sourceTrack.speechCandidates, mergeRanges(ranges), sourceTrack.trackId)
      updateTrack(sourceTrack.trackId, { speechCandidates: candidates })
      setStatus(`${ranges.length}区間を再検出しました。処理済みラベルは保持しています。${vadResultSuffix(lastAnalysis)}`)
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
    let candidates = selectedCandidates
    if (candidates.length === 0 && audioSelection?.trackId === activeTrack.trackId) {
      const usedIds = new Set(activeTrack.speechCandidates.map(item => item.candidateId))
      const candidate: DialogueSpeechCandidate = {
        candidateId: nextUniqueId(`${activeTrack.trackId}-candidate-manual`, usedIds),
        frameStart: audioSelection.frameStart,
        frameEnd: audioSelection.frameEnd,
        status: 'pending',
      }
      updateTrack(activeTrack.trackId, { speechCandidates: [...activeTrack.speechCandidates, candidate] })
      setSelectedCandidateIds([candidate.candidateId])
      candidates = [candidate]
    }
    if (candidates.length === 0) return
    openCandidateSound(activeTrack.trackId, candidates)
  }

  function openDialogueRegion(track: DialogueAudioTrackState, regionId: string) {
    const region = track.dialogueRegions.find(item => item.regionId === regionId)
    if (!region) return
    const candidates = track.speechCandidates.filter(candidate => region.candidateIds.includes(candidate.candidateId))
    setSelectedRegionId(regionId)
    setSelectedCandidateIds(region.candidateIds)
    setAudioFocus('region', { trackId: track.trackId, frameStart: region.frameStart, frameEnd: region.frameEnd })
    if (candidates.length > 0) openCandidateSound(track.trackId, candidates)
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
    const frameEnd = Math.max(...candidates.map(candidate => candidate.frameEnd))
    if (frameEnd > cutFrameEnd) {
      setPendingSoundRequest({
        trackId,
        candidates,
        requiredCutDuration: frameEnd - frameOrigin + 1,
        awaitingCutUpdate: false,
      })
      return
    }
    openCandidateSoundWithinCut(trackId, candidates)
  }

  function openCandidateSoundWithinCut(trackId: string, candidates: DialogueSpeechCandidate[]) {
    onSoundCandidateEdit(
      trackId,
      candidates.map(candidate => candidate.candidateId),
      Math.min(...candidates.map(candidate => candidate.frameStart)),
      Math.max(...candidates.map(candidate => candidate.frameEnd)),
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
    if (event.key === 'Delete' && audioSelection && !playing) {
      event.preventDefault()
      if (event.shiftKey) rippleDelete(audioSelection)
      else silenceSelection()
      return
    }
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (direction === 0) return
    event.preventDefault()
    if (playing) stopPlayback()
    const nextFrame = Math.max(frameOrigin, Math.min(frameEnd, playheadFrame + direction))
    if (nextFrame === playheadFrame) return
    setPlayhead(nextFrame)
    void playDialogueScrub(playheadFrame, nextFrame)
  }

  function focusTimeline() {
    timelineContentRef.current?.focus({ preventScroll: true })
  }

  function setAudioFocus(
    kind: DialogueAudioSelectionFocus['kind'],
    selection: DialogueAudioRange & { trackId: string },
  ) {
    setAudioSelection({ kind, ...selection })
  }

  function clearAudioFocus() {
    setAudioSelection(null)
  }

  function beginRangeSelection(event: ReactPointerEvent<HTMLDivElement>, trackId: string) {
    if (recording || event.button !== 0) return
    if (playing) stopPlayback()
    else stopScrubPlayback()
    const frame = frameForClientX(event.clientX)
    event.currentTarget.setPointerCapture(event.pointerId)
    focusTimeline()
    if (cutState.activeTrackId !== trackId) {
      onCutStateChange({ cutState: { ...cutState, activeTrackId: trackId }, recordHistory: false })
    }
    setSelectionDrag({ trackId, anchorFrame: frame })
    setAudioFocus('range', { trackId, frameStart: frame, frameEnd: frame })
    setSelectedCandidateIds([])
    setSelectedRegionId(null)
    setPlayhead(frame)
  }

  function moveRangeSelection(event: ReactPointerEvent<HTMLDivElement>) {
    if (!selectionDrag) return
    const frame = frameForClientX(event.clientX)
    setAudioFocus('range', { trackId: selectionDrag.trackId, ...normalizeDialogueAudioRange(selectionDrag.anchorFrame, frame) })
  }

  function finishRangeSelection(event: ReactPointerEvent<HTMLDivElement>) {
    if (!selectionDrag) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setSelectionDrag(null)
  }

  function frameForClientX(clientX: number): number {
    const rect = timelineContentRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return playheadFrame
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.max(frameOrigin, Math.min(frameEnd, Math.round(frameOrigin + ratio * Math.max(0, timelineDurationFrames - 1))))
  }

  function selectCandidate(event: ReactMouseEvent<HTMLButtonElement>, track: DialogueAudioTrackState, candidate: DialogueSpeechCandidate) {
    event.stopPropagation()
    if (cutState.activeTrackId !== track.trackId) {
      onCutStateChange({ cutState: { ...cutState, activeTrackId: track.trackId }, recordHistory: false })
    }
    const selectedIds = (event.ctrlKey || event.metaKey || event.shiftKey)
      ? selectedCandidateIds.includes(candidate.candidateId)
        ? selectedCandidateIds.filter(id => id !== candidate.candidateId)
        : [...selectedCandidateIds, candidate.candidateId]
      : [candidate.candidateId]
    const selected = track.speechCandidates.filter(item => selectedIds.includes(item.candidateId))
    setSelectedCandidateIds(selectedIds)
    setSelectedRegionId(null)
    if (selected.length > 0) {
      setAudioFocus('candidate', {
        trackId: track.trackId,
        frameStart: Math.min(...selected.map(item => item.frameStart)),
        frameEnd: Math.max(...selected.map(item => item.frameEnd)),
      })
    } else clearAudioFocus()
    setPlayhead(candidate.frameStart)
  }

  function beginCueDrag(event: ReactPointerEvent<HTMLButtonElement>, cue: TimedRangeCue) {
    if (recording || playing || event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = event.currentTarget.getBoundingClientRect()
    const edge = event.clientX - rect.left
    const mode = edge <= 7 ? 'start' : rect.right - event.clientX <= 7 ? 'end' : 'body'
    onSoundCueSelect(cue.cueId)
    setCueDrag({ cueId: cue.cueId, mode, clientX: event.clientX, origin: cue, preview: cue })
  }

  function moveCueDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!cueDrag) return
    const delta = Math.round((event.clientX - cueDrag.clientX) / (timelineWidth / timelineDurationFrames))
    let frameStart = cueDrag.origin.frameStart
    let cueFrameEnd = cueDrag.origin.frameEnd
    if (cueDrag.mode === 'start') frameStart = Math.max(frameOrigin, Math.min(cueFrameEnd, frameStart + delta))
    if (cueDrag.mode === 'end') cueFrameEnd = Math.min(frameEnd, Math.max(frameStart, cueFrameEnd + delta))
    if (cueDrag.mode === 'body') {
      const duration = cueFrameEnd - frameStart
      frameStart = Math.max(frameOrigin, Math.min(frameEnd - duration, frameStart + delta))
      cueFrameEnd = frameStart + duration
    }
    setCueDrag({ ...cueDrag, preview: { ...cueDrag.origin, frameStart, frameEnd: cueFrameEnd } })
  }

  function finishCueDrag(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) {
    if (!cueDrag) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!cancelled && (cueDrag.preview.frameStart !== cueDrag.origin.frameStart || cueDrag.preview.frameEnd !== cueDrag.origin.frameEnd)) {
      onSoundCueTransform(cueDrag.cueId, {
        laneId: cueDrag.origin.laneId,
        frameStart: cueDrag.preview.frameStart,
        frameEnd: cueDrag.preview.frameEnd,
      })
      setStatus(`SOUND区間を${cueDrag.preview.frameStart}–${cueDrag.preview.frameEnd}Fへ変更しました。`)
    }
    setCueDrag(null)
  }

  function beginClipDrag(event: ReactPointerEvent<HTMLButtonElement>, trackId: string, clip: DialogueAudioClip) {
    if (recording || playing || event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setClipDrag({
      trackId,
      clipId: clip.clipId,
      clientX: event.clientX,
      originFrame: clip.timelineStartFrame,
      previewFrame: clip.timelineStartFrame,
      durationFrames: clip.durationFrames,
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
    const delta = Math.round((event.clientX - clipDrag.clientX) / clipDrag.pixelsPerFrame)
    const previewFrame = Math.max(frameOrigin, clipDrag.originFrame + delta)
    setClipDrag({ ...clipDrag, previewFrame })

    const scroller = timelineScrollerRef.current
    if (!scroller) return
    const rect = scroller.getBoundingClientRect()
    if (event.clientX > rect.right - 32) scroller.scrollLeft += Math.max(12, clipDrag.pixelsPerFrame * 2)
    else if (event.clientX < rect.left + 32) scroller.scrollLeft = Math.max(0, scroller.scrollLeft - Math.max(12, clipDrag.pixelsPerFrame * 2))
  }

  function finishClipDrag(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) {
    if (!clipDrag) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!cancelled && clipDrag.previewFrame !== clipDrag.originFrame) {
      const track = cutState.tracks.find(item => item.trackId === clipDrag.trackId)
      if (track) {
        const nextTrack = moveDialogueAudioClip(track, clipDrag.clipId, clipDrag.previewFrame)
        commitCutState({ ...cutState, tracks: cutState.tracks.map(item => item.trackId === track.trackId ? nextTrack : item) })
        setStatus(`音声クリップを${formatFrame(clipDrag.previewFrame, frameOrigin, fps)}へ移動し、リンクSOUNDを追従しました。`)
      }
    }
    setClipDrag(null)
  }

  function renderCueButton(sourceCue: TimedRangeCue, trackId: string) {
    const cue = cueDrag?.cueId === sourceCue.cueId ? cueDrag.preview : sourceCue
    const assignment = assignmentForCue(cutState, cue.cueId, activeRevisionId)
    const tooltipLabel = `音響指示「${cue.label}」 ${formatFrame(cue.frameStart, frameOrigin, fps)}–${formatFrame(cue.frameEnd, frameOrigin, fps)}${assignment?.reviewReason ? ` / ${assignment.reviewReason}` : ''}`
    return <TooltipTarget key={cue.cueId} label={tooltipLabel}>
      {tooltipProps => <button
        type="button"
        className={`dialogueAudioCue isTrackLayer is-${assignment?.status ?? 'unlinked'} ${cue.cueId === selectedSoundCueId ? 'isSelected' : ''}`}
        style={rangeStyle(cue.frameStart, cue.frameEnd, frameOrigin, timelineDurationFrames)}
        {...tooltipProps}
        onPointerDown={event => {
          tooltipProps.onPointerDown()
          beginCueDrag(event, cue)
        }}
        onPointerMove={moveCueDrag}
        onPointerUp={event => finishCueDrag(event)}
        onPointerCancel={event => finishCueDrag(event, true)}
        onClick={() => onSoundCueSelect(cue.cueId)}
        onDoubleClick={event => { event.stopPropagation(); onSoundCueEdit(cue.cueId) }}
        onContextMenu={event => openContextMenu(event, {
          kind: 'cue',
          cueId: cue.cueId,
          trackId,
          linked: Boolean(assignment),
        })}
      ><span className="dialogueAudioCueHandle isStart" />{cue.label || cue.text || 'SOUND'}<span className="dialogueAudioCueHandle isEnd" /></button>}
    </TooltipTarget>
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
    return viewPreferences.trackHeights[trackId] ?? DIALOGUE_AUDIO_TRACK_HEIGHT_PRESETS.medium
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
      clearAudioFocus()
      setSelectedCandidateIds([])
      setSelectedRegionId(null)
      setPlayhead(target.frame)
    } else if (target.kind === 'range' || target.kind === 'clip') {
      setAudioFocus(target.kind, { trackId: target.trackId, frameStart: target.frameStart, frameEnd: target.frameEnd })
      setSelectedCandidateIds([])
      setSelectedRegionId(null)
    } else if (target.kind === 'candidate') {
      const track = cutState.tracks.find(item => item.trackId === target.trackId)
      const candidates = track?.speechCandidates.filter(candidate => target.candidateIds.includes(candidate.candidateId)) ?? []
      setSelectedCandidateIds(target.candidateIds)
      setSelectedRegionId(null)
      if (candidates.length > 0) {
        setAudioFocus('candidate', {
          trackId: target.trackId,
          frameStart: Math.min(...candidates.map(candidate => candidate.frameStart)),
          frameEnd: Math.max(...candidates.map(candidate => candidate.frameEnd)),
        })
      } else clearAudioFocus()
    } else if (target.kind === 'region') {
      const track = cutState.tracks.find(item => item.trackId === target.trackId)
      const region = track?.dialogueRegions.find(item => item.regionId === target.regionId)
      if (region) {
        setSelectedRegionId(region.regionId)
        setSelectedCandidateIds(region.candidateIds)
        setAudioFocus('region', { trackId: target.trackId, frameStart: region.frameStart, frameEnd: region.frameEnd })
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
    setSelectedCandidateIds([])
    setSelectedRegionId(null)
    setStatus('トラックの音声と発話区間をクリアしました。')
  }

  function targetRange(target: DialogueAudioContextTarget): (DialogueAudioRange & { trackId: string }) | null {
    if (target.kind === 'range' || target.kind === 'clip') {
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
    setSelectedCandidateIds([candidate.candidateId])
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
    else if (command === 'import-here' && target.kind === 'empty') requestAudioImport(target.trackId, target.frame)
    else if (command === 'paste-overwrite' && target.kind === 'empty') pasteClipboardAt(target.trackId, target.frame, 'overwrite')
    else if (command === 'paste-insert' && target.kind === 'empty') pasteClipboardAt(target.trackId, target.frame, 'insert')
    else if (command === 'paste-overwrite' && range) pasteClipboardAt(range.trackId, range.frameStart, 'overwrite')
    else if (command === 'paste-insert' && range) pasteClipboardAt(range.trackId, range.frameStart, 'insert')
    else if (command === 'insert-silence') {
      const trackId = 'trackId' in target ? target.trackId : cutState.activeTrackId
      const frame = target.kind === 'empty' ? target.frame : range?.frameStart ?? playheadFrame
      insertSilenceAt(trackId, frame)
    } else if (command === 'assign-sound') createSoundForTarget(target)
    else if (command === 'copy' && range) copyRange(range, false)
    else if (command === 'cut' && range) copyRange(range, true)
    else if (command === 'silence' && range) silenceRange(range)
    else if (command === 'ripple-delete' && range) rippleDelete(range)
    else if (command === 'redetect-clip' && range) void redetectTrack(range.trackId, range)
    else if ((command === 'ignore-candidate' || command === 'restore-candidate') && target.kind === 'candidate') {
      const track = cutState.tracks.find(item => item.trackId === target.trackId)
      if (!track) return
      const nextTrack = target.candidateIds.reduce((current, candidateId) => (
        command === 'ignore-candidate'
          ? assignmentForCandidate(cutState, candidateId, activeRevisionId) ? current : ignoreDialogueSpeechCandidate(current, candidateId)
          : restoreDialogueSpeechCandidate(current, candidateId)
      ), track)
      updateTrack(target.trackId, nextTrack)
      setStatus(command === 'ignore-candidate' ? 'VAD候補を無視しました。' : 'VAD候補を検出対象へ戻しました。')
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
      setSelectedRegionId(null)
      setStatus('セリフ区間を解除しました。音声とVAD候補は保持しています。')
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
    <section className="dialogueAudioTimeline" aria-label="セリフ音声タイムライン" style={{ height: viewPreferences.panelHeight }}>
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
            disabled={selectedCandidates.length === 0 && !audioSelection}
          >{selectedCandidate && assignmentForCandidate(cutState, selectedCandidate.candidateId, activeRevisionId) ? '音響指示を編集' : '音響指示へ割付…'}</button>
          {audioSelection && <span className="dialogueAudioSelectionSummary">{audioSelection.frameStart}–{audioSelection.frameEnd}F ({audioSelection.frameEnd - audioSelection.frameStart + 1}F)</span>}
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
            {cutState.tracks.map(track => (
              <div
                key={track.trackId}
                className={`dialogueAudioTrack ${track.trackId === cutState.activeTrackId ? 'isActive' : ''}`}
                style={{ height: trackHeight(track.trackId) }}
                onContextMenu={event => {
                  const frame = frameForClientX(event.clientX)
                  openContextMenu(event, { kind: 'empty', trackId: track.trackId, frame })
                }}
              >
                <div className="dialogueAudioTrackCueLayer">
                  {soundCues.filter(cue => assignmentForCue(cutState, cue.cueId, activeRevisionId)?.regionRefs.some(ref => ref.trackId === track.trackId)).map(cue => renderCueButton(cue, track.trackId))}
                </div>
                <div
                  className="dialogueAudioWaveformLane"
                  onPointerDown={event => beginRangeSelection(event, track.trackId)}
                  onPointerMove={moveRangeSelection}
                  onPointerUp={finishRangeSelection}
                  onPointerCancel={finishRangeSelection}
                >
                  {track.clips.length === 0 && <span className="dialogueAudioEmpty">録音または音声読込</span>}
                  {track.clips.map(sourceClip => {
                    const clip = clipDrag?.clipId === sourceClip.clipId ? { ...sourceClip, timelineStartFrame: clipDrag.previewFrame } : sourceClip
                    const asset = cutState.assets.find(item => item.assetId === clip.assetId)
                    return asset ? <span key={clip.clipId} className="dialogueAudioClip">
                      <Waveform asset={asset} clip={clip} color={track.color} frameOrigin={frameOrigin} durationFrames={timelineDurationFrames} />
                      <TooltipTarget label="ドラッグで音声クリップを移動">
                        {tooltipProps => <button
                          type="button"
                          className="dialogueAudioClipHandle"
                          style={rangeStyle(clip.timelineStartFrame, clip.timelineStartFrame + clip.durationFrames - 1, frameOrigin, timelineDurationFrames)}
                          {...tooltipProps}
                          onPointerDown={event => {
                            tooltipProps.onPointerDown()
                            beginClipDrag(event, track.trackId, sourceClip)
                          }}
                          onPointerMove={moveClipDrag}
                          onPointerUp={event => finishClipDrag(event)}
                          onPointerCancel={event => finishClipDrag(event, true)}
                          onContextMenu={event => openContextMenu(event, {
                            kind: 'clip',
                            trackId: track.trackId,
                            clipId: sourceClip.clipId,
                            frameStart: sourceClip.timelineStartFrame,
                            frameEnd: sourceClip.timelineStartFrame + sourceClip.durationFrames - 1,
                          })}
                          aria-label={`音声クリップ ${asset.sourceName ?? clip.clipId}`}
                        >⋮⋮</button>}
                      </TooltipTarget>
                    </span> : null
                  })}
                  {track.speechCandidates.map(candidate => {
                    const presentation = candidatePresentation(candidate, cutState, activeRevisionId)
                    const openCandidates = selectedCandidateIds.includes(candidate.candidateId) ? track.speechCandidates.filter(item => selectedCandidateIds.includes(item.candidateId)) : [candidate]
                    return <TooltipTarget key={candidate.candidateId} label={presentation.title}>
                      {tooltipProps => <button
                        type="button"
                        className={`dialogueSpeechCandidate is-${presentation.state} ${selectedCandidateIds.includes(candidate.candidateId) ? 'isSelected' : ''}`}
                        style={candidateHitStyle(candidate.frameStart, candidate.frameEnd, frameOrigin, timelineDurationFrames, timelineWidth)}
                        {...tooltipProps}
                        onPointerDown={() => {
                          tooltipProps.onPointerDown()
                        }}
                        onClick={event => selectCandidate(event, track, candidate)}
                        onDoubleClick={event => { event.stopPropagation(); openCandidateSound(track.trackId, openCandidates) }}
                        onContextMenu={event => openContextMenu(event, {
                          kind: 'candidate',
                          trackId: track.trackId,
                          candidateIds: openCandidates.map(item => item.candidateId),
                          ignored: openCandidates.every(item => item.status === 'ignored'),
                        })}
                        aria-label={`発話候補 ${candidate.frameStart}–${candidate.frameEnd}F ${presentation.label}`}
                      ><span className="dialogueSpeechCandidateVisual">{presentation.label}</span></button>}
                    </TooltipTarget>
                  })}
                  {track.dialogueRegions.map(region => {
                    const assignment = assignmentForRegion(cutState, { trackId: track.trackId, regionId: region.regionId }, activeRevisionId)
                    const cue = assignment ? soundCues.find(item => item.cueId === assignment.cueId) : undefined
                    const label = cue?.label || cue?.text || 'セリフ区間'
                    return <TooltipTarget key={region.regionId} label={`${assignment ? '割付済み' : '未割付'}：${label} ${region.frameStart}–${region.frameEnd}F`}>
                      {tooltipProps => <button
                        type="button"
                        className={`dialogueAudioRegion ${assignment ? `is-${assignment.status}` : 'is-unassigned'} ${selectedRegionId === region.regionId ? 'isSelected' : ''}`}
                        style={rangeStyle(region.frameStart, region.frameEnd, frameOrigin, timelineDurationFrames)}
                        {...tooltipProps}
                        onClick={event => {
                          event.stopPropagation()
                          if (track.trackId !== cutState.activeTrackId) {
                            onCutStateChange({ cutState: { ...cutState, activeTrackId: track.trackId }, recordHistory: false })
                          }
                          setSelectedRegionId(region.regionId)
                          setSelectedCandidateIds(region.candidateIds)
                          setAudioFocus('region', { trackId: track.trackId, frameStart: region.frameStart, frameEnd: region.frameEnd })
                        }}
                        onDoubleClick={event => {
                          event.stopPropagation()
                          openDialogueRegion(track, region.regionId)
                        }}
                        onContextMenu={event => openContextMenu(event, {
                          kind: 'region',
                          trackId: track.trackId,
                          regionId: region.regionId,
                          linked: Boolean(assignment),
                        })}
                        aria-label={`セリフ区間 ${region.frameStart}–${region.frameEnd}F ${assignment ? `${label}へ割付済み` : '未割付'}`}
                      >{label}</button>}
                    </TooltipTarget>
                  })}
                  {audioSelection?.trackId === track.trackId && <span className="dialogueAudioSelection" style={rangeStyle(audioSelection.frameStart, audioSelection.frameEnd, frameOrigin, timelineDurationFrames)} />}
                </div>
              </div>
            ))}
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
            className={command === 'clear-track' || command === 'remove-region' || command === 'ripple-delete' ? 'isDanger' : undefined}
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

function contextMenuTitle(target: DialogueAudioContextTarget): string {
  switch (target.kind) {
    case 'track': return 'トラック'
    case 'empty': return `${target.frame}F`
    case 'range': return `選択範囲 ${target.frameStart}–${target.frameEnd}F`
    case 'clip': return `音声クリップ ${target.frameStart}–${target.frameEnd}F`
    case 'candidate': return `VAD候補 ${target.candidateIds.length}区間`
    case 'region': return 'セリフ区間'
    case 'cue': return 'リンクSOUND'
  }
}

function contextMenuAriaLabel(target: DialogueAudioContextTarget): string {
  return `${contextMenuTitle(target)}の操作`
}

function contextCommandLabel(command: DialogueAudioContextCommand): string {
  switch (command) {
    case 'redetect-track': return 'トラック全体をVAD再検出'
    case 'clear-track': return 'トラックをクリア'
    case 'import-here': return 'ここへ音声ファイルを読み込む'
    case 'paste-overwrite': return 'ここへ上書き貼り付け　Ctrl+V'
    case 'paste-insert': return 'ここへ挿入貼り付け　Ctrl+Shift+V'
    case 'assign-sound': return 'SOUNDへ割り付け…'
    case 'copy': return 'コピー　Ctrl+C'
    case 'cut': return '切り取り　Ctrl+X'
    case 'silence': return '無音化（リフト）　Delete'
    case 'ripple-delete': return 'リップル削除　Shift+Delete'
    case 'select-clip': return 'クリップ全体を選択'
    case 'redetect-clip': return 'このクリップをVAD再検出'
    case 'ignore-candidate': return 'VAD候補を無視'
    case 'restore-candidate': return 'VAD候補を検出対象へ戻す'
    case 'edit-sound': return 'リンクSOUNDを編集…'
    case 'select-sheet-cue': return 'タイムシート側のSOUNDを選択'
    case 'align-audio-to-cue': return '音声をSOUND位置へ揃える'
    case 'align-cue-to-audio': return 'SOUNDを音声位置へ揃える'
    case 'unlink-sound': return 'SOUNDとのリンクを解除'
    case 'remove-region': return 'セリフ区間を解除'
    case 'track-vad-mode':
    case 'track-height':
    case 'insert-silence':
      return ''
  }
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
    {muted
      ? <path d="m16 9 5 6m0-6-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      : <>
          <path d="M16 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>}
  </svg>
}

function AudioImportIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3.5 6.5h6l2 2h9v10h-17Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    <path d="M10 16v-4.5l5-1v4.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="8.8" cy="16.2" r="1.6" fill="currentColor" />
    <circle cx="13.8" cy="14.8" r="1.6" fill="currentColor" />
  </svg>
}

function TimeRuler(props: {
  durationFrames: number
  fps: number
  pixelsPerFrame: number
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void
}) {
  const plan = planDialogueAudioRulerTicks(props.durationFrames, props.fps, props.pixelsPerFrame)
  return <div
    className="dialogueAudioRuler"
    onPointerDown={props.onPointerDown}
    onPointerMove={props.onPointerMove}
    onPointerUp={props.onPointerUp}
    onPointerCancel={props.onPointerCancel}
  >
    <div className="dialogueAudioRulerSeconds" aria-hidden="true">
      {plan.secondTicks.map(tick => <span
        key={tick.offsetFrames}
        className="dialogueAudioSecondTick"
        style={{ left: tick.offsetFrames * props.pixelsPerFrame }}
      ><span>{tick.second}秒</span></span>)}
    </div>
    <div className="dialogueAudioRulerFrames" aria-label="秒内フレーム目盛り">
      {plan.frameTicks.map(tick => <span
        key={tick.offsetFrames}
        className="dialogueAudioFrameTick"
        style={{ left: tick.offsetFrames * props.pixelsPerFrame }}
      ><span>{tick.frameInSecond}</span></span>)}
    </div>
  </div>
}

function Waveform(props: { asset: DialogueAudioAsset; clip: DialogueAudioClip; color: string; frameOrigin: number; durationFrames: number }) {
  const points = props.asset.waveform
  if (points.length === 0) return null
  const path = points.map((value, index) => {
    const x = index / Math.max(1, points.length - 1) * 1000
    const y = 24 - value * 21
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
  const lowerPath = [...points].reverse().map((value, reverseIndex) => {
    const index = points.length - reverseIndex - 1
    const x = index / Math.max(1, points.length - 1) * 1000
    const y = 24 + value * 21
    return `L${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
  const assetFrames = Math.max(1, props.asset.durationFrames)
  const viewX = props.clip.sourceOffsetFrames / assetFrames * 1000
  const viewWidth = Math.max(1, props.clip.durationFrames / assetFrames * 1000)
  return <svg
    className="dialogueWaveform"
    viewBox={`${viewX} 0 ${viewWidth} 48`}
    preserveAspectRatio="none"
    style={rangeStyle(props.clip.timelineStartFrame, props.clip.timelineStartFrame + props.clip.durationFrames - 1, props.frameOrigin, props.durationFrames)}
    aria-hidden="true"
  ><path d={`${path} ${lowerPath} Z`} fill={props.color} /></svg>
}

function TimelineBoundaryMarker(props: {
  kind: 'cut' | 'audio' | 'combined'
  positionPercent: number
  label: string
}) {
  return (
    <span
      className={`dialogueAudioBoundary dialogueAudioBoundary-${props.kind}`}
      style={{ left: `${props.positionPercent}%` }}
    >
      <TooltipTarget label={props.label}>
        {tooltipProps => <span
          className="dialogueAudioBoundaryHandle"
          role="img"
          aria-label={props.label}
          {...tooltipProps}
        />}
      </TooltipTarget>
    </span>
  )
}

function candidatePresentation(candidate: DialogueSpeechCandidate, state: DialogueAudioCutState, activeRevisionId: string) {
  if (candidate.status === 'ignored') return { state: 'ignored', label: '無視', title: `無視した発話候補 ${candidate.frameStart}–${candidate.frameEnd}F` }
  const assignment = assignmentForCandidate(state, candidate.candidateId, activeRevisionId)
  if (assignment?.status === 'linked') return { state: 'linked', label: 'VAD', title: `音響指示へ割付済みのVAD ${candidate.frameStart}–${candidate.frameEnd}F` }
  if (assignment || candidate.status === 'review') return { state: 'review', label: '要確認', title: assignment?.reviewReason ?? candidate.reviewReason ?? 'リンク状態を確認してください。' }
  return { state: 'pending', label: 'VAD', title: `ダブルクリックでセリフ区間を作成して音響指示へ割り付け ${candidate.frameStart}–${candidate.frameEnd}F` }
}

function mergeRanges(ranges: DialogueAudioRange[]): DialogueAudioRange[] {
  return ranges.sort((left, right) => left.frameStart - right.frameStart).reduce<DialogueAudioRange[]>((result, range) => {
    const previous = result.at(-1)
    if (previous && range.frameStart <= previous.frameEnd + 1) previous.frameEnd = Math.max(previous.frameEnd, range.frameEnd)
    else result.push({ ...range })
    return result
  }, [])
}

function vadEngineLabel(status: DialogueVadEngineStatus): string {
  if (status === 'loading') return 'Silero解析中…'
  if (status === 'silero') return 'Silero VAD'
  if (status === 'fallback') return '簡易検出'
  return 'Silero待機'
}

function vadResultSuffix(analysis: DialogueSileroAnalysis | undefined): string {
  if (!analysis) return ''
  return analysis.engine === 'silero'
    ? ' Silero VADで検出しました。'
    : ` 簡易検出へ切り替えました${analysis.error ? `（${analysis.error}）` : '。'}`
}

function rangeStyle(frameStart: number, rangeFrameEnd: number, frameOrigin: number, durationFrames: number) {
  return {
    left: `${(frameStart - frameOrigin) / Math.max(1, durationFrames) * 100}%`,
    width: `${Math.max(1, rangeFrameEnd - frameStart + 1) / Math.max(1, durationFrames) * 100}%`,
  }
}

function candidateHitStyle(
  frameStart: number,
  rangeFrameEnd: number,
  frameOrigin: number,
  durationFrames: number,
  timelineWidth: number,
): CSSProperties {
  const safeDuration = Math.max(1, durationFrames)
  const safeWidth = Math.max(1, timelineWidth)
  const visualLeft = (frameStart - frameOrigin) / safeDuration * safeWidth
  const visualWidth = Math.max(1, (rangeFrameEnd - frameStart + 1) / safeDuration * safeWidth)
  const hitWidth = Math.min(safeWidth, Math.max(16, visualWidth))
  const hitLeft = Math.max(0, Math.min(safeWidth - hitWidth, visualLeft - (hitWidth - visualWidth) / 2))
  return {
    left: `${hitLeft}px`,
    width: `${hitWidth}px`,
    '--candidate-visual-left': `${visualLeft - hitLeft}px`,
    '--candidate-visual-width': `${visualWidth}px`,
  } as CSSProperties
}

function rangesOverlap(
  left: { frameStart: number; frameEnd: number },
  right: { frameStart: number; frameEnd: number },
): boolean {
  return left.frameStart <= right.frameEnd && right.frameStart <= left.frameEnd
}

function formatFrame(frame: number, frameOrigin: number, fps: number): string {
  const logicalFrame = Math.round(frame) - Math.round(frameOrigin) + 1
  return `${formatLogicalSheetFrameTimecode(frame, frameOrigin, fps)} / ${logicalFrame}F`
}

function stopSources(sources: AudioBufferSourceNode[]) {
  sources.forEach(source => {
    try { source.stop() } catch { /* already stopped */ }
    source.disconnect()
  })
}
