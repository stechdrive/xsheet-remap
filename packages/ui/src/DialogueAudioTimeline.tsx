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
  bindingForCandidate,
  bindingForCue,
  migrateLegacyDialogueBindings,
  synchronizeDialogueBindingsAfterAudioEdit,
  synchronizeDialogueBindingsFromCues,
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
  DIALOGUE_AUDIO_MAX_PIXELS_PER_FRAME,
  DIALOGUE_AUDIO_MIN_PIXELS_PER_FRAME,
  DIALOGUE_AUDIO_TRACK_HEIGHT_PRESETS,
  clampDialogueAudioPixelsPerFrame,
  clampDialogueAudioTrackHeight,
  effectiveDialogueAudioPixelsPerFrame,
  ensureDialogueAudioTimelineDuration,
  loadDialogueAudioViewPreferences,
  saveDialogueAudioViewPreferences,
  type DialogueAudioTrackHeightPreset,
} from './dialogueAudioTimelineModel'

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
  onCutStateChange: (state: DialogueAudioCutState) => void
  onCutDurationChange?: (durationFrames: number) => void
  onPlayheadChange: (frame: number) => void
  onSoundCueSelect: (cueId: string) => void
  onSoundCueEdit: (cueId: string) => void
  onSoundCueTransform: (cueId: string, updates: { laneId: string; frameStart: number; frameEnd: number }) => void
  onSoundCuesTransform: (updates: Array<{ cueId: string; frameStart: number; frameEnd: number }>) => void
  onSoundCandidateEdit: (trackId: string, candidateIds: string[], frameStart: number, frameEnd: number) => void
  onAutoCreateSoundCues: (state: DialogueAudioCutState, trackId: string, candidateIds: string[]) => DialogueAudioCutState
}

interface AudioHistory {
  past: DialogueAudioCutState[]
  future: DialogueAudioCutState[]
}

const SCRUB_WINDOW_SECONDS = 0.12

export function DialogueAudioTimeline(props: DialogueAudioTimelineProps) {
  const {
    cutState, fps, frameOrigin, activeRevisionId, soundCues, selectedSoundCueId,
    onCutStateChange, onPlayheadChange, onSoundCueSelect, onSoundCueEdit, onSoundCueTransform, onSoundCuesTransform,
    onSoundCandidateEdit, onAutoCreateSoundCues, onCutDurationChange,
  } = props
  const cutDurationFrames = Math.max(1, props.cutDurationFrames ?? props.durationFrames ?? 144)
  const timelineDurationFrames = Math.max(cutDurationFrames, cutState.timelineDurationFrames)
  const [collapsed, setCollapsed] = useState(true)
  const [playheadFrame, setPlayheadFrame] = useState(frameOrigin)
  const [viewPreferences, setViewPreferences] = useState(loadDialogueAudioViewPreferences)
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(720)
  const [playing, setPlaying] = useState(false)
  const [recording, setRecording] = useState(false)
  const [loopSelectedCue, setLoopSelectedCue] = useState(false)
  const [audioSelection, setAudioSelection] = useState<(DialogueAudioRange & { trackId: string }) | null>(null)
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([])
  const [selectionDrag, setSelectionDrag] = useState<{ trackId: string; anchorFrame: number } | null>(null)
  const [silenceFrameCount, setSilenceFrameCount] = useState(1)
  const [clipboard, setClipboard] = useState<DialogueAudioClipboard | null>(null)
  const [audioHistory, setAudioHistory] = useState<AudioHistory>({ past: [], future: [] })
  const [vadEngine, setVadEngine] = useState<{ status: DialogueVadEngineStatus; error?: string }>({ status: 'idle' })
  const [vadPrerollDebugRanges, setVadPrerollDebugRanges] = useState<Record<string, DialogueSpeechRange[]>>({})
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; trackId?: string } | null>(null)
  const [pendingSoundRequest, setPendingSoundRequest] = useState<{
    trackId: string
    candidates: DialogueSpeechCandidate[]
    requiredCutDuration: number
    awaitingCutUpdate: boolean
  } | null>(null)
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
  } | null>(null)
  const [status, setStatus] = useState('カット頭または再生ヘッドから、3トラックを通して確認できます。')
  const cutStateRef = useRef(cutState)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourcesRef = useRef<AudioBufferSourceNode[]>([])
  const scrubSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const scrubRequestRef = useRef(0)
  const scrubDragRef = useRef<{ pointerId: number; lastFrame: number } | null>(null)
  const animationRef = useRef<number | null>(null)
  const playSessionRef = useRef<{ contextStart: number; frameStart: number; frameEnd: number; loop: boolean } | null>(null)
  const recorderRef = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startFrame: number; trackId: string } | null>(null)
  const decodedRef = useRef(new Map<string, { dataUrl: string; audio: PcmAudio }>())
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const timelineContentRef = useRef<HTMLDivElement | null>(null)
  const timelineScrollerRef = useRef<HTMLDivElement | null>(null)
  const timelineHeaderRef = useRef<HTMLElement | null>(null)
  const pixelsPerFrame = effectiveDialogueAudioPixelsPerFrame(viewPreferences, timelineViewportWidth, timelineDurationFrames)
  const timelineWidth = Math.max(timelineViewportWidth, timelineDurationFrames * pixelsPerFrame)
  const frameEnd = frameOrigin + timelineDurationFrames - 1
  const cutFrameEnd = frameOrigin + cutDurationFrames - 1
  const activeTrack = cutState.tracks.find(track => track.trackId === cutState.activeTrackId) ?? cutState.tracks[0]
  const selectedCue = soundCues.find(cue => cue.cueId === selectedSoundCueId) ?? null
  const selectedCandidates = activeTrack?.speechCandidates.filter(candidate => selectedCandidateIds.includes(candidate.candidateId)) ?? []
  const selectedCandidate = selectedCandidates[0] ?? null

  useEffect(() => {
    cutStateRef.current = cutState
  }, [cutState])

  useEffect(() => {
    saveDialogueAudioViewPreferences(viewPreferences)
  }, [viewPreferences])

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
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
    }
  }, [contextMenu])

  useEffect(() => {
    const migrated = migrateLegacyDialogueBindings(cutState, soundCues, activeRevisionId)
    const synchronized = synchronizeDialogueBindingsFromCues(migrated, soundCues, activeRevisionId)
    if (synchronized !== cutState) onCutStateChange(synchronized)
  }, [activeRevisionId, cutState, onCutStateChange, soundCues])

  const setPlayhead = useCallback((frame: number) => {
    const liveFrameEnd = frameOrigin + Math.max(cutDurationFrames, cutStateRef.current.timelineDurationFrames) - 1
    const next = Math.max(frameOrigin, Math.min(liveFrameEnd, Math.round(frame)))
    setPlayheadFrame(next)
    onPlayheadChange(next)
  }, [cutDurationFrames, frameOrigin, onPlayheadChange])

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
    const context = audioContext()
    await context.resume()
    const loopRange = loopSelectedCue && selectedCue
      ? { start: selectedCue.frameStart, end: selectedCue.frameEnd }
      : null
    const requestedStart = loopRange?.start ?? fromFrame
    const restartAtOrigin = !loopRange && !recorderRef.current && requestedStart >= frameEnd
    const playbackStart = Math.max(frameOrigin, Math.min(frameEnd, restartAtOrigin ? frameOrigin : requestedStart))
    const playbackEnd = Math.max(playbackStart, Math.min(frameEnd, loopRange?.end ?? frameEnd))
    const soloed = cutState.tracks.some(track => track.solo)
    const assetById = new Map(cutState.assets.map(asset => [asset.assetId, asset]))
    const sources: AudioBufferSourceNode[] = []
    const scheduled: Array<{ source: AudioBufferSourceNode; audibleStart: number; clip: DialogueAudioClip; audio: PcmAudio }> = []
    for (const track of cutState.tracks) {
      if (track.trackId === omitTrackId || track.muted || (soloed && !track.solo)) continue
      for (const clip of track.clips) {
        const clipEnd = clip.timelineStartFrame + clip.durationFrames - 1
        if (clipEnd < playbackStart || clip.timelineStartFrame > playbackEnd) continue
        const asset = assetById.get(clip.assetId)
        if (!asset) continue
        const audio = await decodedAsset(asset, context)
        const audibleStart = Math.max(playbackStart, clip.timelineStartFrame)
        const source = context.createBufferSource()
        source.buffer = audioBufferFromPcm(context, audio)
        source.connect(context.destination)
        sources.push(source)
        scheduled.push({ source, audibleStart, clip, audio })
      }
    }
    const startAt = context.currentTime + 0.05
    scheduled.forEach(({ source, audibleStart, clip, audio }) => {
      const offsetSeconds = (clip.sourceOffsetFrames + audibleStart - clip.timelineStartFrame) / fps
      const requestedDuration = (Math.min(playbackEnd, clip.timelineStartFrame + clip.durationFrames - 1) - audibleStart + 1) / fps
      const availableDuration = Math.max(0, audio.samples.length / audio.sampleRate - offsetSeconds)
      source.start(
        startAt + (audibleStart - playbackStart) / fps,
        Math.max(0, offsetSeconds),
        Math.max(0.001, Math.min(requestedDuration, availableDuration)),
      )
    })
    sourcesRef.current = sources
    playSessionRef.current = { contextStart: startAt, frameStart: playbackStart, frameEnd: playbackEnd, loop: Boolean(loopRange) }
    setPlayhead(playbackStart)
    setPlaying(true)
    setStatus(sources.length > 0 ? '全トラックをミックス再生中' : '音声はありません。再生ヘッドだけを進めています。')
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
          onCutStateChange(extended)
        }
        setPlayhead(next)
        animationRef.current = requestAnimationFrame(tickPlayback)
      } else if (session.loop) void startPlayback(session.frameStart)
      else {
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
    const soloed = state.tracks.some(track => track.solo)
    const audibleTracks = state.tracks.filter(track => !track.muted && (!soloed || track.solo))
    if (!audibleTracks.some(track => track.clips.length > 0)) {
      stopScrubPlayback()
      setStatus(direction < 0 ? '逆スクラブ（音声なし）' : 'スクラブ（音声なし）')
      return
    }

    const scrubFrameCount = Math.max(2, Math.ceil(Math.max(1, fps) * SCRUB_WINDOW_SECONDS))
    const windowStart = direction > 0
      ? nextFrame
      : Math.max(frameOrigin, nextFrame - scrubFrameCount + 1)
    const windowEnd = direction > 0
      ? Math.min(frameEnd, nextFrame + scrubFrameCount - 1)
      : nextFrame
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
      setStatus(direction < 0 ? '逆スクラブ（この位置は無音）' : 'スクラブ（この位置は無音）')
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
      const fadeSeconds = Math.min(0.008, durationSeconds / 3)
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
    setStatus(direction < 0 ? '全トラックを逆スクラブ中' : '全トラックをスクラブ中')
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
      setStatus(`${activeTrack.name}へパンチイン録音中。ほかのトラックは再生されます。`)
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
    setVadPrerollDebugRanges(current => ({ ...current, [trackId]: analysis.prerollRanges }))
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
      onCutStateChange(latest)
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
    if (track.vadMode === 'auto-sound') {
      const previousIds = new Set(latestTrack.speechCandidates.map(candidate => candidate.candidateId))
      const candidateIds = analyzedTrack.speechCandidates.filter(candidate => candidate.status === 'pending' && !previousIds.has(candidate.candidateId)).map(candidate => candidate.candidateId)
      analyzedState = onAutoCreateSoundCues(analyzedState, trackId, candidateIds)
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
      onCutStateChange(next)
    }
  }

  function commitCutState(nextInput: DialogueAudioCutState, recordHistory = true) {
    const next = ensureDialogueAudioTimelineDuration(
      synchronizeAudioBindings(pruneUnusedDialogueAudioAssets(nextInput)),
      frameOrigin,
      cutDurationFrames,
    )
    if (recordHistory) setAudioHistory(current => ({ past: [...current.past.slice(-49), cutState], future: [] }))
    cutStateRef.current = next
    onCutStateChange(next)
  }

  function undoAudioEdit() {
    const previous = audioHistory.past.at(-1)
    if (!previous) return
    setAudioHistory(current => ({ past: current.past.slice(0, -1), future: [cutState, ...current.future.slice(0, 49)] }))
    onCutStateChange(synchronizeAudioBindings(previous))
    setStatus('音声編集を元に戻しました。')
  }

  function redoAudioEdit() {
    const next = audioHistory.future[0]
    if (!next) return
    setAudioHistory(current => ({ past: [...current.past.slice(-49), cutState], future: current.future.slice(1) }))
    onCutStateChange(synchronizeAudioBindings(next))
    setStatus('音声編集をやり直しました。')
  }

  function synchronizeAudioBindings(stateInput: DialogueAudioCutState): DialogueAudioCutState {
    const migrated = migrateLegacyDialogueBindings(stateInput, soundCues, activeRevisionId)
    const synchronized = synchronizeDialogueBindingsAfterAudioEdit(migrated, soundCues, activeRevisionId)
    if (synchronized.cueUpdates.length > 0) onSoundCuesTransform(synchronized.cueUpdates)
    return synchronized.state
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
      const prerollRanges: DialogueSpeechRange[] = []
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
        prerollRanges.push(...analysis.prerollRanges)
      }
      const candidates = reconcileDialogueSpeechCandidates(activeTrack.speechCandidates, mergeRanges(ranges), activeTrack.trackId)
      updateTrack(activeTrack.trackId, { speechCandidates: candidates })
      setVadPrerollDebugRanges(current => ({ ...current, [activeTrack.trackId]: mergeRanges(prerollRanges) }))
      setStatus(`${activeTrack.name}から${ranges.length}区間を再検出しました。処理済みラベルは保持しています。${vadResultSuffix(lastAnalysis)}`)
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
      bindingForCandidate(cutState, candidate.candidateId, activeRevisionId) ? track : ignoreDialogueSpeechCandidate(track, candidate.candidateId)
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

  function openCandidateSound(trackId: string, candidates: DialogueSpeechCandidate[]) {
    const bindings = candidates.map(candidate => bindingForCandidate(cutState, candidate.candidateId, activeRevisionId)).filter(Boolean)
    const linkedCueId = bindings.length === candidates.length && new Set(bindings.map(binding => binding?.cueId)).size === 1 ? bindings[0]?.cueId : undefined
    const cue = linkedCueId ? soundCues.find(item => item.cueId === linkedCueId) : undefined
    if (cue) {
      onSoundCueSelect(cue.cueId)
      onSoundCueEdit(cue.cueId)
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
      setStatus('紙シートのカット尺を変更できないため、SOUNDへ反映できませんでした。')
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
    if (cutState.activeTrackId !== trackId) onCutStateChange({ ...cutState, activeTrackId: trackId })
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
    if (cutState.activeTrackId !== track.trackId) onCutStateChange({ ...cutState, activeTrackId: track.trackId })
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
    setClipDrag({ trackId, clipId: clip.clipId, clientX: event.clientX, originFrame: clip.timelineStartFrame, previewFrame: clip.timelineStartFrame, durationFrames: clip.durationFrames })
    if (cutState.activeTrackId !== trackId) onCutStateChange({ ...cutState, activeTrackId: trackId })
  }

  function moveClipDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!clipDrag) return
    const delta = Math.round((event.clientX - clipDrag.clientX) / (timelineWidth / timelineDurationFrames))
    const maxStart = Math.max(frameOrigin, frameEnd - clipDrag.durationFrames + 1)
    setClipDrag({ ...clipDrag, previewFrame: Math.max(frameOrigin, Math.min(maxStart, clipDrag.originFrame + delta)) })
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

  function renderCueButton(sourceCue: TimedRangeCue, trackLayer = false) {
    const cue = cueDrag?.cueId === sourceCue.cueId ? cueDrag.preview : sourceCue
    const binding = bindingForCue(cutState, cue.cueId, activeRevisionId)
    return <button
      type="button"
      key={cue.cueId}
      className={`dialogueAudioCue ${trackLayer ? 'isTrackLayer' : 'isUnlinked'} is-${binding?.status ?? 'unlinked'} ${binding?.provisional ? 'isProvisional' : ''} ${cue.cueId === selectedSoundCueId ? 'isSelected' : ''}`}
      style={rangeStyle(cue.frameStart, cue.frameEnd, frameOrigin, timelineDurationFrames)}
      onPointerDown={event => beginCueDrag(event, cue)}
      onPointerMove={moveCueDrag}
      onPointerUp={event => finishCueDrag(event)}
      onPointerCancel={event => finishCueDrag(event, true)}
      onClick={() => onSoundCueSelect(cue.cueId)}
      onDoubleClick={event => { event.stopPropagation(); onSoundCueEdit(cue.cueId) }}
      title={`${binding?.provisional ? '仮SOUND' : 'SOUND'}「${cue.label}」 ${formatFrame(cue.frameStart, frameOrigin, fps)}–${formatFrame(cue.frameEnd, frameOrigin, fps)}${binding?.reviewReason ? ` / ${binding.reviewReason}` : ''}`}
    ><span className="dialogueAudioCueHandle isStart" />{cue.label || cue.text || 'SOUND'}<span className="dialogueAudioCueHandle isEnd" /></button>
  }

  function zoomTimeline(direction: -1 | 1) {
    setViewPreferences(current => ({
      ...current,
      fitTimeline: false,
      pixelsPerFrame: clampDialogueAudioPixelsPerFrame(pixelsPerFrame * (direction < 0 ? 0.8 : 1.25)),
    }))
  }

  function fitTimeline() {
    setViewPreferences(current => ({ ...current, fitTimeline: true }))
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
    setContextMenu({
      x: Math.max(8, Math.min(window.innerWidth - 260, event.clientX || rect.left)),
      y: Math.max(8, Math.min(window.innerHeight - 420, event.clientY || rect.bottom)),
      trackId,
    })
  }

  function clearActiveTrack() {
    stopPlayback(false)
    if (!activeTrack) return
    setVadPrerollDebugRanges(current => ({ ...current, [activeTrack.trackId]: [] }))
    commitCutState({
      ...cutState,
      tracks: cutState.tracks.map(track => track.trackId === activeTrack.trackId ? { ...track, clips: [], speechCandidates: [] } : track),
    })
  }

  const trackRows = cutState.tracks.map(track => `${trackHeight(track.trackId)}px`).join(' ')
  const contentHeight = 57 + cutState.tracks.reduce((sum, track) => sum + trackHeight(track.trackId), 0)

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
    <section className="dialogueAudioTimeline" aria-label="セリフ音声タイムライン">
      <div className="dialogueAudioToolbar">
        <div className="dialogueAudioToolbarMain">
          <button type="button" className="dialogueAudioCollapse" onClick={() => setCollapsed(true)} aria-expanded="true" disabled={recording}>▾ 音声</button>
          <span className="dialogueAudioToolGroup" aria-label="再生と録音">
            <button type="button" className="dialogueAudioIconButton" aria-label="⏮ カット頭から" title="カット頭から再生" onClick={() => { setPlayhead(frameOrigin); void startPlayback(frameOrigin) }} disabled={recording}>⏮</button>
            <button type="button" className="dialogueAudioIconButton" aria-label={playing ? '⏸ 一時停止' : '▶ 再生ヘッドから'} title={playing ? '一時停止' : '再生。末尾では頭から再開'} onClick={() => playing ? stopPlayback() : void startPlayback()} disabled={recording}>{playing ? '⏸' : '▶'}</button>
            <button type="button" className={`dialogueAudioIconButton ${recording ? 'isRecording' : ''}`} aria-label={recording ? '■ 録音終了' : '● 録音'} title={recording ? '録音終了' : '録音'} onClick={() => void toggleRecording()} disabled={!recording && vadEngine.status === 'loading'}>{recording ? '■' : '●'}</button>
          </span>
          <span className="dialogueAudioToolGroup" aria-label="音声編集">
            <button type="button" className="dialogueAudioIconButton" onClick={undoAudioEdit} disabled={recording || playing || audioHistory.past.length === 0} aria-label="音声編集を元に戻す" title="元に戻す">↶</button>
            <button type="button" className="dialogueAudioIconButton" onClick={redoAudioEdit} disabled={recording || playing || audioHistory.future.length === 0} aria-label="音声編集をやり直す" title="やり直す">↷</button>
            <button type="button" className="dialogueAudioIconButton" onClick={() => insertSilence(1)} disabled={recording || playing || !activeTrack?.clips.length} aria-label="+1F" title="1フレーム挿入">+F</button>
            <button type="button" className="dialogueAudioIconButton" onClick={() => rippleDelete()} disabled={recording || playing || !activeTrack?.clips.length} aria-label="−1F" title="1フレームをリップル削除">−F</button>
          </span>
          <input ref={fileInputRef} type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm" hidden onChange={event => void importAudio(event)} />
          <button
            type="button"
            className="dialogueAudioReflectButton"
            onClick={createSoundFromSelection}
            disabled={selectedCandidates.length === 0 && !audioSelection}
          >{selectedCandidates.length > 1 ? '選択区間を紙シートへSOUND反映' : selectedCandidate && bindingForCandidate(cutState, selectedCandidate.candidateId, activeRevisionId) ? '紙シートのSOUNDを編集' : '紙シートへSOUND反映'}</button>
          <span className="dialogueAudioTime">{formatFrame(playheadFrame, frameOrigin, fps)}</span>
          <span className="dialogueAudioZoomTools" aria-label="タイムライン表示倍率">
            <button type="button" className="dialogueAudioIconButton" onClick={() => zoomTimeline(-1)} disabled={viewPreferences.fitTimeline || pixelsPerFrame <= DIALOGUE_AUDIO_MIN_PIXELS_PER_FRAME} aria-label="タイムラインを縮小" title="縮小">−</button>
            <button type="button" className={viewPreferences.fitTimeline ? 'isOn' : ''} onClick={fitTimeline} aria-label="音声タイムライン全体を表示" title="音声尺全体を表示">全体</button>
            <output aria-label="タイムライン表示倍率">{pixelsPerFrame.toFixed(1)} px/F</output>
            <button type="button" className="dialogueAudioIconButton" onClick={() => zoomTimeline(1)} disabled={pixelsPerFrame >= DIALOGUE_AUDIO_MAX_PIXELS_PER_FRAME} aria-label="タイムラインを拡大" title="拡大">＋</button>
          </span>
          <button type="button" className="dialogueAudioIconButton" onClick={openToolsMenu} aria-label="音声タイムラインのツール" title="編集ツールとVAD設定">⋯</button>
        </div>
        <div className="dialogueAudioToolbarStatus">
          <label className="dialogueAudioToggle"><input type="checkbox" checked={loopSelectedCue} disabled={recording} onChange={event => setLoopSelectedCue(event.target.checked)} />選択SOUNDをループ</label>
          <span className="dialogueAudioSelectionSummary">{audioSelection ? `${audioSelection.frameStart}–${audioSelection.frameEnd}F (${audioSelection.frameEnd - audioSelection.frameStart + 1}F)` : '範囲未選択'}</span>
          <span className={`dialogueVadEngine is-${vadEngine.status}`} role="status" title={vadEngine.error}>{vadEngineLabel(vadEngine.status)}</span>
          <span className="dialogueVadPrerollLegend">紫＝VAD前倒し（テスト）</span>
          <span className="dialogueAudioDurationSummary">紙 {cutDurationFrames}F / 音声 {timelineDurationFrames}F</span>
          <span className="dialogueAudioStatus" role="status">{status}</span>
        </div>
      </div>

      <div className="dialogueAudioBody">
        <aside
          ref={timelineHeaderRef}
          className="dialogueAudioTrackHeaders"
          style={{ gridTemplateRows: `25px 32px ${trackRows}` }}
        >
          <div className="dialogueAudioCueHeader">未リンクSOUND / トラック別ラベル</div>
          {cutState.tracks.map(track => (
            <div
              key={track.trackId}
              className={`dialogueAudioTrackHeader ${track.trackId === cutState.activeTrackId ? 'isActive' : ''}`}
              style={{ height: trackHeight(track.trackId) }}
              onContextMenu={event => {
                if (track.trackId !== cutState.activeTrackId) onCutStateChange({ ...cutState, activeTrackId: track.trackId })
                openToolsMenu(event, track.trackId)
              }}
            >
              <input type="radio" name="dialogue-track" checked={track.trackId === cutState.activeTrackId} disabled={recording} onChange={() => onCutStateChange({ ...cutState, activeTrackId: track.trackId })} aria-label={`${track.name}を録音対象にする`} />
              <span className="dialogueAudioTrackDot" style={{ background: track.color }} />
              <input className="dialogueAudioTrackName" value={track.name} onChange={event => updateTrack(track.trackId, { name: event.target.value })} aria-label="トラック名" />
              <select className="dialogueAudioTrackVadMode" value={track.vadMode} disabled={recording || vadEngine.status === 'loading'} onChange={event => updateTrack(track.trackId, { vadMode: event.target.value as DialogueAudioTrackState['vadMode'] })} aria-label={`${track.name} 録音VAD`}>
                <option value="off">VADなし</option>
                <option value="candidates">候補</option>
                <option value="auto-sound">仮SOUND</option>
              </select>
              <button type="button" className={track.muted ? 'isOn' : ''} onClick={() => updateTrack(track.trackId, { muted: !track.muted })} aria-label={`${track.name}をミュート`}>M</button>
              <button type="button" className={track.solo ? 'isOn' : ''} onClick={() => updateTrack(track.trackId, { solo: !track.solo })} aria-label={`${track.name}をソロ`}>S</button>
              <span
                className="dialogueAudioTrackResizeHandle"
                role="separator"
                aria-label={`${track.name}の高さを変更`}
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
              frameOrigin={frameOrigin}
              durationFrames={timelineDurationFrames}
              fps={fps}
              onPointerDown={beginPlayheadScrub}
              onPointerMove={movePlayheadScrub}
              onPointerUp={finishPlayheadScrub}
              onPointerCancel={finishPlayheadScrub}
            />
            <div
              className="dialogueAudioCueLane"
              onPointerDown={beginPlayheadScrub}
              onPointerMove={movePlayheadScrub}
              onPointerUp={finishPlayheadScrub}
              onPointerCancel={finishPlayheadScrub}
            >
              {soundCues.filter(cue => !bindingForCue(cutState, cue.cueId, activeRevisionId)).map(cue => renderCueButton(cue))}
            </div>
            {timelineDurationFrames > cutDurationFrames && <span
              className="dialogueAudioPostCut"
              style={{
                left: `${cutDurationFrames / timelineDurationFrames * 100}%`,
                width: `${(timelineDurationFrames - cutDurationFrames) / timelineDurationFrames * 100}%`,
              }}
              title="紙シートのカット尺より後の音声領域"
            ><span>カット外</span></span>}
            {cutState.tracks.map(track => (
              <div
                key={track.trackId}
                className={`dialogueAudioTrack ${track.trackId === cutState.activeTrackId ? 'isActive' : ''}`}
                style={{ height: trackHeight(track.trackId) }}
                onContextMenu={event => {
                  if (track.trackId !== cutState.activeTrackId) onCutStateChange({ ...cutState, activeTrackId: track.trackId })
                  openToolsMenu(event, track.trackId)
                }}
              >
                <div className="dialogueAudioTrackCueLayer">
                  {soundCues.filter(cue => bindingForCue(cutState, cue.cueId, activeRevisionId)?.trackId === track.trackId).map(cue => renderCueButton(cue, true))}
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
                      <button
                        type="button"
                        className="dialogueAudioClipHandle"
                        style={rangeStyle(clip.timelineStartFrame, clip.timelineStartFrame + clip.durationFrames - 1, frameOrigin, timelineDurationFrames)}
                        onPointerDown={event => beginClipDrag(event, track.trackId, sourceClip)}
                        onPointerMove={moveClipDrag}
                        onPointerUp={event => finishClipDrag(event)}
                        onPointerCancel={event => finishClipDrag(event, true)}
                        aria-label={`音声クリップ ${asset.sourceName ?? clip.clipId}`}
                        title="ドラッグで音声クリップを移動"
                      >⋮⋮</button>
                    </span> : null
                  })}
                  {track.speechCandidates.map(candidate => {
                    const presentation = candidatePresentation(candidate, cutState, activeRevisionId)
                    const openCandidates = selectedCandidateIds.includes(candidate.candidateId) ? track.speechCandidates.filter(item => selectedCandidateIds.includes(item.candidateId)) : [candidate]
                    return <button
                      type="button"
                      key={candidate.candidateId}
                      className={`dialogueSpeechCandidate is-${presentation.state} ${selectedCandidateIds.includes(candidate.candidateId) ? 'isSelected' : ''}`}
                      style={rangeStyle(candidate.frameStart, candidate.frameEnd, frameOrigin, timelineDurationFrames)}
                      onPointerDown={event => selectCandidate(event, track, candidate)}
                      onDoubleClick={event => { event.stopPropagation(); openCandidateSound(track.trackId, openCandidates) }}
                      title={presentation.title}
                      aria-label={`発話候補 ${candidate.frameStart}–${candidate.frameEnd}F ${presentation.label}`}
                    ><span>{presentation.label}</span></button>
                  })}
                  {(vadPrerollDebugRanges[track.trackId] ?? []).map((range, index) => <span
                    key={`vad-preroll-${range.frameStart}-${range.frameEnd}-${index}`}
                    className="dialogueVadPrerollDebug"
                    style={rangeStyle(range.frameStart, range.frameEnd, frameOrigin, timelineDurationFrames)}
                    aria-label={`VAD前倒し ${range.frameStart}–${range.frameEnd}F`}
                  />)}
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

      {contextMenu && <div
        className="dialogueAudioContextMenu"
        role="menu"
        aria-label="音声タイムラインの操作"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onPointerDown={event => event.stopPropagation()}
        onContextMenu={event => event.preventDefault()}
      >
        <button type="button" role="menuitem" onClick={() => { setContextMenu(null); fileInputRef.current?.click() }} disabled={recording || playing || vadEngine.status === 'loading'}>音声を再生ヘッドへ読み込む</button>
        <button type="button" role="menuitem" onClick={() => { setContextMenu(null); createSoundFromSelection() }} disabled={selectedCandidates.length === 0 && !audioSelection}>紙シートへSOUND反映</button>
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
        <label>録音VAD環境<select value={cutState.detectionPreset} disabled={vadEngine.status === 'loading'} onChange={event => onCutStateChange({ ...cutState, detectionPreset: event.target.value as DialogueAudioCutState['detectionPreset'] })}>
          <option value="quiet">静か</option><option value="normal">通常</option><option value="noisy">騒がしい</option>
        </select></label>
        <label>検出感度<input type="range" min="0" max="1" step="0.01" value={cutState.detectionSensitivity} disabled={vadEngine.status === 'loading'} onChange={event => onCutStateChange({ ...cutState, detectionSensitivity: Number(event.target.value) })} /></label>
        <label>途切れにくさ<input type="range" min="0" max="1" step="0.01" value={cutState.detectionStability} disabled={vadEngine.status === 'loading'} onChange={event => onCutStateChange({ ...cutState, detectionStability: Number(event.target.value) })} /></label>
        <button type="button" role="menuitem" onClick={() => { setContextMenu(null); void redetectActiveTrack() }} disabled={recording || playing || vadEngine.status === 'loading' || !activeTrack?.clips.length}>セリフ区間を再検出</button>
        <button type="button" role="menuitem" onClick={() => { setContextMenu(null); ignoreSelectedCandidate() }} disabled={selectedCandidates.length === 0 || selectedCandidates.every(candidate => Boolean(bindingForCandidate(cutState, candidate.candidateId, activeRevisionId)))}>候補を無視</button>
        <button type="button" role="menuitem" className="isDanger" onClick={() => { setContextMenu(null); clearActiveTrack() }} disabled={recording || !activeTrack?.clips.length}>トラックをクリア</button>
      </div>}

      {pendingSoundRequest && !pendingSoundRequest.awaitingCutUpdate && <div className="dialogueAudioPromptBackdrop">
        <div className="dialogueAudioPrompt" role="alertdialog" aria-modal="true" aria-labelledby="dialogue-audio-extend-title">
          <h3 id="dialogue-audio-extend-title">SOUND区間がカット尺を越えています</h3>
          <p>音声は{pendingSoundRequest.requiredCutDuration}Fまであります。区間を切り捨てず、紙シートのカット尺も延長して反映しますか？</p>
          <div>
            <button type="button" onClick={() => setPendingSoundRequest(null)}>キャンセル</button>
            <button type="button" className="dialogueAudioReflectButton" onClick={confirmSoundCutExtension}>カット尺を延長して反映</button>
          </div>
        </div>
      </div>}
    </section>
  )
}

function TimeRuler(props: {
  frameOrigin: number
  durationFrames: number
  fps: number
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void
}) {
  const step = props.durationFrames > 480 ? props.fps * 2 : props.fps
  const ticks: number[] = []
  for (let offset = 0; offset < props.durationFrames; offset += step) ticks.push(props.frameOrigin + offset)
  return <div
    className="dialogueAudioRuler"
    onPointerDown={props.onPointerDown}
    onPointerMove={props.onPointerMove}
    onPointerUp={props.onPointerUp}
    onPointerCancel={props.onPointerCancel}
  >{ticks.map(frame => <span key={frame} style={{ left: `${(frame - props.frameOrigin) / props.durationFrames * 100}%` }}>{formatFrame(frame, props.frameOrigin, props.fps)}</span>)}</div>
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

function candidatePresentation(candidate: DialogueSpeechCandidate, state: DialogueAudioCutState, activeRevisionId: string) {
  if (candidate.status === 'ignored') return { state: 'ignored', label: '無視', title: `無視した発話候補 ${candidate.frameStart}–${candidate.frameEnd}F` }
  const binding = bindingForCandidate(state, candidate.candidateId, activeRevisionId)
  if (binding?.status === 'linked') return { state: 'linked', label: 'VAD', title: `SOUNDリンク済みVAD ${candidate.frameStart}–${candidate.frameEnd}F` }
  if (binding || candidate.status === 'review') return { state: 'review', label: '要確認', title: binding?.reviewReason ?? candidate.reviewReason ?? 'リンク状態を確認してください。' }
  return { state: 'pending', label: 'VAD', title: `ダブルクリックでSOUNDを作成 ${candidate.frameStart}–${candidate.frameEnd}F` }
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
