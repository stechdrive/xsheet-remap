import {
  useCallback,
  useEffect,
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
  nextUniqueId,
  normalizeDialogueAudioRange,
  pasteDialogueAudioClipboard,
  reconcileDialogueSpeechCandidates,
  replaceDialogueAudioRangeWithClip,
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
  synchronizeDialogueAssignmentsAfterAudioEdit,
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
const CONTEXT_MENU_MAX_HEIGHT = 520

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
  const [audioSelection, setAudioSelection] = useState<(DialogueAudioRange & { trackId: string }) | null>(null)
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([])
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const [selectionDrag, setSelectionDrag] = useState<{ trackId: string; anchorFrame: number } | null>(null)
  const [silenceFrameCount, setSilenceFrameCount] = useState(1)
  const [clipboard, setClipboard] = useState<DialogueAudioClipboard | null>(null)
  const [vadEngine, setVadEngine] = useState<{ status: DialogueVadEngineStatus; error?: string }>({ status: 'idle' })
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; trackId?: string } | null>(null)
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
    ? cutState.tracks.find(track => track.trackId === (contextMenu.trackId ?? cutState.activeTrackId)) ?? activeTrack
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
    if (!file || !activeTrack) return
    try {
      const audio = await decodeAudioBlob(file, audioContext())
      const analysis = await addAudioAssetClip(audio, playheadFrame, activeTrack.trackId, file.name)
      setStatus(`${file.name}を${playheadFrame}Fへ読み込みました。${vadResultSuffix(analysis)}`)
    } catch (error) {
      setStatus(`音声を読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`)
    }
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

  function applyTrackEdit(edit: (track: DialogueAudioTrackState) => DialogueAudioTrackState, message: string) {
    if (!activeTrack) return
    const nextTrack = edit(activeTrack)
    commitCutState({ ...cutState, tracks: cutState.tracks.map(track => track.trackId === activeTrack.trackId ? nextTrack : track) })
    setStatus(message)
  }

  function insertSilence(frameCount = silenceFrameCount) {
    applyTrackEdit(
      track => insertDialogueAudioSilence(track, audioSelection?.frameStart ?? playheadFrame, frameCount),
      `${audioSelection?.frameStart ?? playheadFrame}Fへ無音${frameCount}フレームを挿入しました。`,
    )
  }

  function rippleDelete(range = audioSelection ?? { frameStart: playheadFrame, frameEnd: playheadFrame, trackId: activeTrack?.trackId ?? '' }) {
    if (!activeTrack || range.trackId !== activeTrack.trackId) return
    applyTrackEdit(
      track => rippleDeleteDialogueAudioRange(track, range),
      `${range.frameStart}–${range.frameEnd}Fを削除し、後続音声とリンクSOUNDを詰めました。`,
    )
    setAudioSelection(null)
  }

  function silenceSelection() {
    if (!audioSelection || !activeTrack || audioSelection.trackId !== activeTrack.trackId) return
    applyTrackEdit(track => silenceDialogueAudioRange(track, audioSelection), `${audioSelection.frameStart}–${audioSelection.frameEnd}Fを無音化しました。リンク済みSOUNDは確認待ちとして残します。`)
  }

  function copySelection(cut: boolean) {
    if (!audioSelection || !activeTrack || audioSelection.trackId !== activeTrack.trackId) return
    setClipboard(copyDialogueAudioRange(activeTrack, audioSelection))
    if (cut) silenceSelection()
    setStatus(`${audioSelection.frameStart}–${audioSelection.frameEnd}Fを${cut ? '切り取り' : 'コピー'}しました。`)
  }

  function pasteClipboard(mode: 'overwrite' | 'insert') {
    if (!clipboard || !activeTrack) return
    applyTrackEdit(
      track => pasteDialogueAudioClipboard(track, clipboard, playheadFrame, mode),
      `${playheadFrame}Fへ${mode === 'insert' ? '挿入' : '上書き'}貼り付けしました。`,
    )
  }

  async function redetectActiveTrack() {
    if (!activeTrack?.clips.length) return
    try {
      setVadEngine({ status: 'loading' })
      const assetById = new Map(cutState.assets.map(asset => [asset.assetId, asset]))
      const ranges: DialogueSpeechRange[] = []
      let lastAnalysis: DialogueSileroAnalysis | undefined
      for (const clip of activeTrack.clips) {
        const asset = assetById.get(clip.assetId)
        if (!asset) continue
        const audio = await decodedAsset(asset, audioContext())
        const sourceStart = Math.round(clip.sourceOffsetFrames * audio.sampleRate / fps)
        const sourceEnd = Math.min(audio.samples.length, Math.round((clip.sourceOffsetFrames + clip.durationFrames) * audio.sampleRate / fps))
        const analysis = await analyzeSpeech(
          { samples: audio.samples.slice(sourceStart, sourceEnd), sampleRate: audio.sampleRate },
          clip.timelineStartFrame,
          cutState,
        )
        lastAnalysis = analysis
        ranges.push(...analysis.speechRanges)
      }
      const candidates = reconcileDialogueSpeechCandidates(activeTrack.speechCandidates, mergeRanges(ranges), activeTrack.trackId)
      updateTrack(activeTrack.trackId, { speechCandidates: candidates })
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

  function ignoreSelectedCandidate() {
    if (!activeTrack || selectedCandidates.length === 0) return
    const nextTrack = selectedCandidates.reduce((track, candidate) => (
      assignmentForCandidate(cutState, candidate.candidateId, activeRevisionId) ? track : ignoreDialogueSpeechCandidate(track, candidate.candidateId)
    ), activeTrack)
    updateTrack(activeTrack.trackId, nextTrack)
    setStatus('未リンクのVAD候補を無視にしました。再検出しても保持します。')
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
    setAudioSelection({ trackId: track.trackId, frameStart: region.frameStart, frameEnd: region.frameEnd })
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
    setAudioSelection({ trackId, frameStart: frame, frameEnd: frame })
    setSelectedCandidateIds([])
    setPlayhead(frame)
  }

  function moveRangeSelection(event: ReactPointerEvent<HTMLDivElement>) {
    if (!selectionDrag) return
    const frame = frameForClientX(event.clientX)
    setAudioSelection({ trackId: selectionDrag.trackId, ...normalizeDialogueAudioRange(selectionDrag.anchorFrame, frame) })
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

  function selectCandidate(event: ReactPointerEvent<HTMLButtonElement>, track: DialogueAudioTrackState, candidate: DialogueSpeechCandidate) {
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
    setAudioSelection(selected.length > 0 ? {
      trackId: track.trackId,
      frameStart: Math.min(...selected.map(item => item.frameStart)),
      frameEnd: Math.max(...selected.map(item => item.frameEnd)),
    } : null)
    setPlayhead(candidate.frameStart)
  }

  function beginCueDrag(event: ReactPointerEvent<HTMLButtonElement>, cue: TimedRangeCue) {
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

  function renderCueButton(sourceCue: TimedRangeCue) {
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

  function openToolsMenu(event: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>, trackId?: string) {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const anchorX = event.clientX || rect.left
    const anchorY = event.clientY || rect.bottom
    const menuHeight = Math.min(CONTEXT_MENU_MAX_HEIGHT, Math.max(1, window.innerHeight - CONTEXT_MENU_EDGE * 2))
    const spaceBelow = window.innerHeight - anchorY - CONTEXT_MENU_EDGE
    setContextMenu({
      x: Math.max(CONTEXT_MENU_EDGE, Math.min(window.innerWidth - CONTEXT_MENU_WIDTH, anchorX)),
      y: spaceBelow >= menuHeight
        ? Math.max(CONTEXT_MENU_EDGE, anchorY)
        : Math.max(CONTEXT_MENU_EDGE, anchorY - menuHeight),
      trackId,
    })
  }

  function clearActiveTrack() {
    stopPlayback(false)
    if (!activeTrack) return
    commitCutState({
      ...cutState,
      tracks: cutState.tracks.map(track => track.trackId === activeTrack.trackId ? { ...track, clips: [], speechCandidates: [] } : track),
    })
  }

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
          <Tooltip label="編集ツールとVAD設定">
            <button type="button" className="dialogueAudioIconButton" onClick={openToolsMenu} aria-label="音声タイムラインのツール">⋯</button>
          </Tooltip>
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
                if (track.trackId !== cutState.activeTrackId) {
                  onCutStateChange({ cutState: { ...cutState, activeTrackId: track.trackId }, recordHistory: false })
                }
                openToolsMenu(event, track.trackId)
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
            onContextMenu={event => openToolsMenu(event)}
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
                  if (track.trackId !== cutState.activeTrackId) {
                    onCutStateChange({ cutState: { ...cutState, activeTrackId: track.trackId }, recordHistory: false })
                  }
                  openToolsMenu(event, track.trackId)
                }}
              >
                <div className="dialogueAudioTrackCueLayer">
                  {soundCues.filter(cue => assignmentForCue(cutState, cue.cueId, activeRevisionId)?.regionRefs.some(ref => ref.trackId === track.trackId)).map(cue => renderCueButton(cue))}
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
                        onPointerDown={event => {
                          tooltipProps.onPointerDown()
                          selectCandidate(event, track, candidate)
                        }}
                        onDoubleClick={event => { event.stopPropagation(); openCandidateSound(track.trackId, openCandidates) }}
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
                          setAudioSelection({ trackId: track.trackId, frameStart: region.frameStart, frameEnd: region.frameEnd })
                        }}
                        onDoubleClick={event => {
                          event.stopPropagation()
                          openDialogueRegion(track, region.regionId)
                        }}
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
              style={{ left: `${(playheadFrame - frameOrigin) / timelineDurationFrames * 100}%` }}
              role="slider"
              aria-label="音声再生ヘッド"
              aria-valuemin={frameOrigin}
              aria-valuemax={frameEnd}
              aria-valuenow={playheadFrame}
              aria-valuetext={formatFrame(playheadFrame, frameOrigin, fps)}
              tabIndex={0}
              onKeyDown={handleTimelineKeyDown}
              onPointerDown={beginPlayheadScrub}
              onPointerMove={movePlayheadScrub}
              onPointerUp={finishPlayheadScrub}
              onPointerCancel={finishPlayheadScrub}
            />
          </div>
        </div>
      </div>

      {contextMenu && createPortal(<div
        className="dialogueAudioContextMenu"
        role="menu"
        aria-label="音声タイムラインの操作"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onPointerDown={event => event.stopPropagation()}
        onContextMenu={event => event.preventDefault()}
      >
        {contextTrack && <>
          <label>録音後の処理<select value={contextTrack.vadMode} disabled={recording || vadEngine.status === 'loading'} onChange={event => updateTrack(contextTrack.trackId, { vadMode: event.target.value as DialogueAudioTrackState['vadMode'] })}>
            <option value="off">検出しない</option>
            <option value="candidates">発話区間を検出</option>
            <option value="auto-region">セリフ区間を自動作成</option>
          </select></label>
          <button type="button" role="menuitem" onClick={() => updateTrack(contextTrack.trackId, { muted: !contextTrack.muted })}>{contextTrack.muted ? 'ミュートを解除' : 'このトラックをミュート'}</button>
          <div className="dialogueAudioMenuSeparator" />
        </>}
        <button type="button" role="menuitem" onClick={() => { setContextMenu(null); fileInputRef.current?.click() }} disabled={recording || playing || vadEngine.status === 'loading'}>音声を再生ヘッドへ読み込む</button>
        <button type="button" role="menuitem" onClick={() => { setContextMenu(null); createSoundFromSelection() }} disabled={selectedCandidates.length === 0 && !audioSelection}>音響指示へ割り付け…</button>
        <div className="dialogueAudioMenuSeparator" />
        <button type="button" role="menuitem" onClick={() => { setContextMenu(null); copySelection(false) }} disabled={!audioSelection}>コピー</button>
        <button type="button" role="menuitem" onClick={() => { setContextMenu(null); copySelection(true) }} disabled={!audioSelection}>切り取り</button>
        <button type="button" role="menuitem" onClick={() => { setContextMenu(null); pasteClipboard('overwrite') }} disabled={!clipboard}>上書き貼り付け</button>
        <button type="button" role="menuitem" onClick={() => { setContextMenu(null); pasteClipboard('insert') }} disabled={!clipboard}>挿入貼り付け</button>
        <button type="button" role="menuitem" onClick={() => { setContextMenu(null); silenceSelection() }} disabled={recording || playing || !audioSelection}>選択範囲を無音化</button>
        <button type="button" role="menuitem" onClick={() => { setContextMenu(null); rippleDelete() }} disabled={recording || playing || !audioSelection}>選択範囲をリップル削除</button>
        <label className="dialogueAudioMenuNumber">無音挿入 <input className="dialogueAudioFrameCount" type="number" min="1" max={timelineDurationFrames} value={silenceFrameCount} onChange={event => setSilenceFrameCount(Math.max(1, Math.round(Number(event.target.value) || 1)))} />F</label>
        <button type="button" role="menuitem" onClick={() => { setContextMenu(null); insertSilence() }} disabled={recording || playing || !activeTrack?.clips.length}>無音を挿入</button>
        <div className="dialogueAudioMenuSeparator" />
        <div className="dialogueAudioMenuLabel">トラック高</div>
        <div className="dialogueAudioHeightPresets">
          {(['small', 'medium', 'large'] as const).map((preset, index) => <button
            type="button"
            key={preset}
            onClick={() => setTrackHeightPreset(contextMenu.trackId ?? cutState.activeTrackId, preset)}
            aria-label={`トラック高 ${['小', '中', '大'][index]}`}
          >{['小', '中', '大'][index]}</button>)}
        </div>
        <div className="dialogueAudioMenuSeparator" />
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
        <button type="button" role="menuitem" onClick={() => { setContextMenu(null); void redetectActiveTrack() }} disabled={recording || playing || vadEngine.status === 'loading' || !activeTrack?.clips.length}>セリフ区間を再検出</button>
        <button type="button" role="menuitem" onClick={() => { setContextMenu(null); ignoreSelectedCandidate() }} disabled={selectedCandidates.length === 0 || selectedCandidates.every(candidate => Boolean(assignmentForCandidate(cutState, candidate.candidateId, activeRevisionId)))}>候補を無視</button>
        <button type="button" role="menuitem" className="isDanger" onClick={() => { setContextMenu(null); clearActiveTrack() }} disabled={recording || !activeTrack?.clips.length}>トラックをクリア</button>
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
