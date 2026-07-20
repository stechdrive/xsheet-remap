import { useCallback, useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { TimedRangeCue } from '@xsheet-remap/core'
import {
  copyDialogueAudioRange,
  ignoreDialogueSpeechCandidate,
  insertDialogueAudioSilence,
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
  analyzeDialogueAudio,
  audioBufferFromPcm,
  blobToDataUrl,
  decodeAudioBlob,
  decodeAudioDataUrl,
  durationFramesForAudio,
  pcmToWavBlob,
  type PcmAudio,
} from './dialogueAudioEngine'
import {
  pruneUnusedDialogueAudioAssets,
  type DialogueAudioAsset,
  type DialogueAudioClip,
  type DialogueAudioCutState,
  type DialogueAudioTrackState,
  type DialogueSpeechCandidate,
} from './dialogueAudioProject'

interface DialogueAudioTimelineProps {
  cutState: DialogueAudioCutState
  fps: number
  frameOrigin: number
  durationFrames: number
  activeRevisionId: string
  soundCues: TimedRangeCue[]
  selectedSoundCueId: string | null
  onCutStateChange: (state: DialogueAudioCutState) => void
  onPlayheadChange: (frame: number) => void
  onSoundCueSelect: (cueId: string) => void
  onSoundCueEdit: (cueId: string) => void
  onSoundCueTransform: (cueId: string, updates: { laneId: string; frameStart: number; frameEnd: number }) => void
  onSoundCuesTransform: (updates: Array<{ cueId: string; frameStart: number; frameEnd: number }>) => void
  onSoundCandidateEdit: (trackId: string, candidateId: string, frameStart: number, frameEnd: number) => void
}

interface AudioHistory {
  past: DialogueAudioCutState[]
  future: DialogueAudioCutState[]
}

const MIN_PIXELS_PER_FRAME = 1.2
const MAX_PIXELS_PER_FRAME = 9

export function DialogueAudioTimeline(props: DialogueAudioTimelineProps) {
  const {
    cutState, fps, frameOrigin, durationFrames, activeRevisionId, soundCues, selectedSoundCueId,
    onCutStateChange, onPlayheadChange, onSoundCueSelect, onSoundCueEdit, onSoundCueTransform, onSoundCuesTransform,
    onSoundCandidateEdit,
  } = props
  const [collapsed, setCollapsed] = useState(false)
  const [playheadFrame, setPlayheadFrame] = useState(frameOrigin)
  const [pixelsPerFrame, setPixelsPerFrame] = useState(2.4)
  const [playing, setPlaying] = useState(false)
  const [recording, setRecording] = useState(false)
  const [loopSelectedCue, setLoopSelectedCue] = useState(false)
  const [audioSelection, setAudioSelection] = useState<(DialogueAudioRange & { trackId: string }) | null>(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [selectionDrag, setSelectionDrag] = useState<{ trackId: string; anchorFrame: number } | null>(null)
  const [silenceFrameCount, setSilenceFrameCount] = useState(1)
  const [clipboard, setClipboard] = useState<DialogueAudioClipboard | null>(null)
  const [audioHistory, setAudioHistory] = useState<AudioHistory>({ past: [], future: [] })
  const [cueDrag, setCueDrag] = useState<{
    cueId: string
    mode: 'start' | 'body' | 'end'
    clientX: number
    origin: TimedRangeCue
    preview: TimedRangeCue
  } | null>(null)
  const [status, setStatus] = useState('カット頭または再生ヘッドから、3トラックを通して確認できます。')
  const cutStateRef = useRef(cutState)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourcesRef = useRef<AudioBufferSourceNode[]>([])
  const animationRef = useRef<number | null>(null)
  const playSessionRef = useRef<{ contextStart: number; frameStart: number; frameEnd: number; loop: boolean } | null>(null)
  const recorderRef = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startFrame: number; trackId: string } | null>(null)
  const decodedRef = useRef(new Map<string, { dataUrl: string; audio: PcmAudio }>())
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const timelineWidth = Math.max(720, durationFrames * pixelsPerFrame)
  const frameEnd = frameOrigin + Math.max(1, durationFrames) - 1
  const activeTrack = cutState.tracks.find(track => track.trackId === cutState.activeTrackId) ?? cutState.tracks[0]
  const selectedCue = soundCues.find(cue => cue.cueId === selectedSoundCueId) ?? null
  const selectedCandidate = activeTrack?.speechCandidates.find(candidate => candidate.candidateId === selectedCandidateId) ?? null

  useEffect(() => {
    cutStateRef.current = cutState
  }, [cutState])

  const setPlayhead = useCallback((frame: number) => {
    const next = Math.max(frameOrigin, Math.min(frameEnd, Math.round(frame)))
    setPlayheadFrame(next)
    onPlayheadChange(next)
  }, [frameEnd, frameOrigin, onPlayheadChange])

  useEffect(() => () => {
    stopSources(sourcesRef.current)
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

  async function startPlayback(fromFrame = playheadFrame, omitTrackId?: string) {
    stopPlayback(false)
    const context = audioContext()
    await context.resume()
    const loopRange = loopSelectedCue && selectedCue
      ? { start: selectedCue.frameStart, end: selectedCue.frameEnd }
      : null
    const playbackStart = Math.max(frameOrigin, Math.min(frameEnd, loopRange?.start ?? fromFrame))
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
      if (session.loop) void startPlayback(session.frameStart)
      else {
        setPlayhead(session.frameEnd)
        stopPlayback(false)
      }
      return
    }
    setPlayhead(next)
    animationRef.current = requestAnimationFrame(tickPlayback)
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.recorder.stop()
      return
    }
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
      await addAudioAssetClip(recorded, startFrame, trackId, 'マイク録音')
      setPlayhead(startFrame + durationFramesForAudio(recorded, fps))
      setStatus('録音を非破壊クリップとして反映しました。')
    } catch (error) {
      setStatus(`録音を処理できませんでした: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function addAudioAssetClip(audio: PcmAudio, timelineStartFrame: number, trackId: string, sourceName: string) {
    const current = cutStateRef.current
    const track = current.tracks.find(item => item.trackId === trackId)
    if (!track) return
    const duration = durationFramesForAudio(audio, fps)
    const analysis = analyzeDialogueAudio(audio.samples, audio.sampleRate, fps, timelineStartFrame, current.detectionSensitivity)
    const usedAssetIds = new Set(current.assets.map(asset => asset.assetId))
    const usedClipIds = new Set(current.tracks.flatMap(item => item.clips.map(clip => clip.clipId)))
    const assetId = nextUniqueId('dialogue-asset', usedAssetIds)
    const clipId = nextUniqueId(`${trackId}-clip`, usedClipIds)
    const audioDataUrl = await blobToDataUrl(pcmToWavBlob(audio))
    const asset: DialogueAudioAsset = { assetId, audioDataUrl, durationFrames: duration, waveform: analysis.waveform, sourceName }
    const clip: DialogueAudioClip = { clipId, assetId, timelineStartFrame, sourceOffsetFrames: 0, durationFrames: duration }
    decodedRef.current.set(assetId, { dataUrl: audioDataUrl, audio })
    const range = { frameStart: timelineStartFrame, frameEnd: timelineStartFrame + Math.max(1, duration) - 1 }
    const nextTrack = replaceDialogueAudioRangeWithClip(track, range, clip, analysis.speechRanges)
    commitCutState({
      ...current,
      assets: [...current.assets, asset],
      tracks: current.tracks.map(item => item.trackId === trackId ? nextTrack : item),
    })
  }

  async function importAudio(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !activeTrack) return
    try {
      const audio = await decodeAudioBlob(file, audioContext())
      await addAudioAssetClip(audio, playheadFrame, activeTrack.trackId, file.name)
      setStatus(`${file.name}を${playheadFrame}Fへ読み込みました。`)
    } catch (error) {
      setStatus(`音声を読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function updateTrack(trackId: string, updates: Partial<DialogueAudioTrackState>, recordHistory = true) {
    const next = { ...cutState, tracks: cutState.tracks.map(track => track.trackId === trackId ? { ...track, ...updates } : track) }
    if (recordHistory) commitCutState(next)
    else onCutStateChange(next)
  }

  function commitCutState(nextInput: DialogueAudioCutState, recordHistory = true) {
    const next = pruneUnusedDialogueAudioAssets(nextInput)
    if (recordHistory) setAudioHistory(current => ({ past: [...current.past.slice(-49), cutState], future: [] }))
    syncLinkedSoundCues(cutState, next)
    onCutStateChange(next)
  }

  function undoAudioEdit() {
    const previous = audioHistory.past.at(-1)
    if (!previous) return
    setAudioHistory(current => ({ past: current.past.slice(0, -1), future: [cutState, ...current.future.slice(0, 49)] }))
    syncLinkedSoundCues(cutState, previous)
    onCutStateChange(previous)
    setStatus('音声編集を元に戻しました。')
  }

  function redoAudioEdit() {
    const next = audioHistory.future[0]
    if (!next) return
    setAudioHistory(current => ({ past: [...current.past.slice(-49), cutState], future: current.future.slice(1) }))
    syncLinkedSoundCues(cutState, next)
    onCutStateChange(next)
    setStatus('音声編集をやり直しました。')
  }

  function syncLinkedSoundCues(previous: DialogueAudioCutState, next: DialogueAudioCutState) {
    const previousCandidates = new Map(previous.tracks.flatMap(track => track.speechCandidates.map(candidate => [candidate.candidateId, candidate] as const)))
    const cueById = new Map(soundCues.map(cue => [cue.cueId, cue]))
    const updates: Array<{ cueId: string; frameStart: number; frameEnd: number }> = []
    for (const candidate of next.tracks.flatMap(track => track.speechCandidates)) {
      const prior = previousCandidates.get(candidate.candidateId)
      if (!prior || (prior.frameStart === candidate.frameStart && prior.frameEnd === candidate.frameEnd)) continue
      const link = candidate.cueLinks?.find(item => item.revisionId === activeRevisionId)
      const cue = link ? cueById.get(link.cueId) : undefined
      if (!cue || candidate.status === 'review') continue
      updates.push({ cueId: cue.cueId, frameStart: candidate.frameStart, frameEnd: candidate.frameEnd })
    }
    if (updates.length > 0) onSoundCuesTransform(updates)
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
      const assetById = new Map(cutState.assets.map(asset => [asset.assetId, asset]))
      const ranges = []
      for (const clip of activeTrack.clips) {
        const asset = assetById.get(clip.assetId)
        if (!asset) continue
        const audio = await decodedAsset(asset, audioContext())
        const sourceStart = Math.round(clip.sourceOffsetFrames * audio.sampleRate / fps)
        const sourceEnd = Math.min(audio.samples.length, Math.round((clip.sourceOffsetFrames + clip.durationFrames) * audio.sampleRate / fps))
        const analysis = analyzeDialogueAudio(audio.samples.slice(sourceStart, sourceEnd), audio.sampleRate, fps, clip.timelineStartFrame, cutState.detectionSensitivity)
        ranges.push(...analysis.speechRanges)
      }
      const candidates = reconcileDialogueSpeechCandidates(activeTrack.speechCandidates, mergeRanges(ranges), activeTrack.trackId)
      updateTrack(activeTrack.trackId, { speechCandidates: candidates })
      setStatus(`${activeTrack.name}から${ranges.length}区間を再検出しました。処理済みラベルは保持しています。`)
    } catch (error) {
      setStatus(`再検出に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function ignoreSelectedCandidate() {
    if (!activeTrack || !selectedCandidate) return
    updateTrack(activeTrack.trackId, ignoreDialogueSpeechCandidate(activeTrack, selectedCandidate.candidateId))
    setStatus('発話候補を無視にしました。再検出しても保持します。')
  }

  function createSoundFromSelection() {
    if (!activeTrack) return
    let candidate = selectedCandidate
    if (!candidate && audioSelection?.trackId === activeTrack.trackId) {
      const usedIds = new Set(activeTrack.speechCandidates.map(item => item.candidateId))
      candidate = {
        candidateId: nextUniqueId(`${activeTrack.trackId}-candidate-manual`, usedIds),
        frameStart: audioSelection.frameStart,
        frameEnd: audioSelection.frameEnd,
        status: 'pending',
      }
      updateTrack(activeTrack.trackId, { speechCandidates: [...activeTrack.speechCandidates, candidate] })
      setSelectedCandidateId(candidate.candidateId)
    }
    if (!candidate) return
    openCandidateSound(activeTrack.trackId, candidate)
  }

  function openCandidateSound(trackId: string, candidate: DialogueSpeechCandidate) {
    const link = candidate.cueLinks?.find(item => item.revisionId === activeRevisionId)
    const cue = link ? soundCues.find(item => item.cueId === link.cueId) : undefined
    if (cue) {
      onSoundCueSelect(cue.cueId)
      onSoundCueEdit(cue.cueId)
      return
    }
    onSoundCandidateEdit(trackId, candidate.candidateId, candidate.frameStart, candidate.frameEnd)
  }

  function seekFromPointer(event: ReactPointerEvent<HTMLElement>) {
    if (recording) return
    if (playing) stopPlayback()
    setPlayhead(frameForPointer(event))
  }

  function beginRangeSelection(event: ReactPointerEvent<HTMLDivElement>, trackId: string) {
    if (recording || event.button !== 0) return
    if (playing) stopPlayback()
    const frame = frameForPointer(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    if (cutState.activeTrackId !== trackId) onCutStateChange({ ...cutState, activeTrackId: trackId })
    setSelectionDrag({ trackId, anchorFrame: frame })
    setAudioSelection({ trackId, frameStart: frame, frameEnd: frame })
    setSelectedCandidateId(null)
    setPlayhead(frame)
  }

  function moveRangeSelection(event: ReactPointerEvent<HTMLDivElement>) {
    if (!selectionDrag) return
    const frame = frameForPointer(event)
    setAudioSelection({ trackId: selectionDrag.trackId, ...normalizeDialogueAudioRange(selectionDrag.anchorFrame, frame) })
  }

  function finishRangeSelection(event: ReactPointerEvent<HTMLDivElement>) {
    if (!selectionDrag) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setSelectionDrag(null)
  }

  function frameForPointer(event: ReactPointerEvent<HTMLElement>): number {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    return Math.max(frameOrigin, Math.min(frameEnd, Math.round(frameOrigin + ratio * Math.max(0, durationFrames - 1))))
  }

  function selectCandidate(event: ReactPointerEvent<HTMLButtonElement>, track: DialogueAudioTrackState, candidate: DialogueSpeechCandidate) {
    event.stopPropagation()
    if (cutState.activeTrackId !== track.trackId) onCutStateChange({ ...cutState, activeTrackId: track.trackId })
    setSelectedCandidateId(candidate.candidateId)
    setAudioSelection({ trackId: track.trackId, frameStart: candidate.frameStart, frameEnd: candidate.frameEnd })
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
    const delta = Math.round((event.clientX - cueDrag.clientX) / (timelineWidth / Math.max(1, durationFrames)))
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

  if (collapsed) {
    return (
      <section className="dialogueAudioTimeline isCollapsed" aria-label="セリフ音声タイムライン">
        <button type="button" className="dialogueAudioCollapse" onClick={() => setCollapsed(false)} aria-expanded="false">音声タイムラインを開く</button>
        <span>{playheadFrame}F</span>
        <button type="button" onClick={() => void startPlayback(frameOrigin)}>カット頭から再生</button>
      </section>
    )
  }

  return (
    <section className="dialogueAudioTimeline" aria-label="セリフ音声タイムライン">
      <div className="dialogueAudioToolbar">
        <button type="button" className="dialogueAudioCollapse" onClick={() => setCollapsed(true)} aria-expanded="true" disabled={recording}>▾ 音声タイムライン</button>
        <button type="button" onClick={() => { setPlayhead(frameOrigin); void startPlayback(frameOrigin) }} disabled={recording}>⏮ カット頭から</button>
        <button type="button" onClick={() => playing ? stopPlayback() : void startPlayback()} disabled={recording}>{playing ? '⏸ 一時停止' : '▶ 再生ヘッドから'}</button>
        <button type="button" className={recording ? 'isRecording' : ''} onClick={() => void toggleRecording()}>{recording ? '■ 録音終了' : '● 録音'}</button>
        <button type="button" onClick={undoAudioEdit} disabled={recording || playing || audioHistory.past.length === 0} aria-label="音声編集を元に戻す">↶</button>
        <button type="button" onClick={redoAudioEdit} disabled={recording || playing || audioHistory.future.length === 0} aria-label="音声編集をやり直す">↷</button>
        <button type="button" onClick={() => insertSilence(1)} disabled={recording || playing || !activeTrack?.clips.length}>+1F</button>
        <button type="button" onClick={() => rippleDelete()} disabled={recording || playing || !activeTrack?.clips.length}>−1F</button>
        <label className="dialogueAudioToggle"><input type="checkbox" checked={loopSelectedCue} disabled={recording} onChange={event => setLoopSelectedCue(event.target.checked)} />選択SOUNDをループ</label>
        <span className="dialogueAudioTime">{formatFrame(playheadFrame, frameOrigin, fps)}</span>
        <label className="dialogueAudioZoom">幅<input type="range" min={MIN_PIXELS_PER_FRAME} max={MAX_PIXELS_PER_FRAME} step="0.2" value={pixelsPerFrame} onChange={event => setPixelsPerFrame(Number(event.target.value))} /></label>
      </div>

      <div className="dialogueAudioBody">
        <aside className="dialogueAudioTrackHeaders">
          <div className="dialogueAudioCueHeader">SOUND区間 / 発話候補</div>
          {cutState.tracks.map(track => (
            <div key={track.trackId} className={`dialogueAudioTrackHeader ${track.trackId === cutState.activeTrackId ? 'isActive' : ''}`}>
              <input type="radio" name="dialogue-track" checked={track.trackId === cutState.activeTrackId} disabled={recording} onChange={() => onCutStateChange({ ...cutState, activeTrackId: track.trackId })} aria-label={`${track.name}を録音対象にする`} />
              <span className="dialogueAudioTrackDot" style={{ background: track.color }} />
              <input className="dialogueAudioTrackName" value={track.name} onChange={event => updateTrack(track.trackId, { name: event.target.value })} aria-label="トラック名" />
              <button type="button" className={track.muted ? 'isOn' : ''} onClick={() => updateTrack(track.trackId, { muted: !track.muted })} aria-label={`${track.name}をミュート`}>M</button>
              <button type="button" className={track.solo ? 'isOn' : ''} onClick={() => updateTrack(track.trackId, { solo: !track.solo })} aria-label={`${track.name}をソロ`}>S</button>
            </div>
          ))}
        </aside>

        <div className="dialogueAudioScroller">
          <div className="dialogueAudioContent" style={{ width: timelineWidth }}>
            <TimeRuler frameOrigin={frameOrigin} durationFrames={durationFrames} fps={fps} onPointerDown={seekFromPointer} />
            <div className="dialogueAudioCueLane" onPointerDown={seekFromPointer}>
              {soundCues.map(sourceCue => {
                const cue = cueDrag?.cueId === sourceCue.cueId ? cueDrag.preview : sourceCue
                return (
                  <button
                    type="button"
                    key={cue.cueId}
                    className={`dialogueAudioCue ${cue.cueId === selectedSoundCueId ? 'isSelected' : ''}`}
                    style={rangeStyle(cue.frameStart, cue.frameEnd, frameOrigin, durationFrames)}
                    onPointerDown={event => beginCueDrag(event, cue)}
                    onPointerMove={moveCueDrag}
                    onPointerUp={event => finishCueDrag(event)}
                    onPointerCancel={event => finishCueDrag(event, true)}
                    onClick={() => onSoundCueSelect(cue.cueId)}
                    title={`${cue.label} ${cue.frameStart}–${cue.frameEnd}F`}
                  ><span className="dialogueAudioCueHandle isStart" />{cue.label || cue.text || 'SOUND'}<span className="dialogueAudioCueHandle isEnd" /></button>
                )
              })}
            </div>
            {cutState.tracks.map(track => (
              <div
                key={track.trackId}
                className={`dialogueAudioTrack ${track.trackId === cutState.activeTrackId ? 'isActive' : ''}`}
                onPointerDown={event => beginRangeSelection(event, track.trackId)}
                onPointerMove={moveRangeSelection}
                onPointerUp={finishRangeSelection}
                onPointerCancel={finishRangeSelection}
              >
                {track.clips.length === 0 && <span className="dialogueAudioEmpty">録音または音声読込</span>}
                {track.clips.map(clip => {
                  const asset = cutState.assets.find(item => item.assetId === clip.assetId)
                  return asset ? <Waveform key={clip.clipId} asset={asset} clip={clip} color={track.color} frameOrigin={frameOrigin} durationFrames={durationFrames} /> : null
                })}
                {track.speechCandidates.map(candidate => {
                  const presentation = candidatePresentation(candidate, activeRevisionId, soundCues)
                  return <button
                    type="button"
                    key={candidate.candidateId}
                    className={`dialogueSpeechCandidate is-${presentation.state} ${candidate.candidateId === selectedCandidateId ? 'isSelected' : ''}`}
                    style={rangeStyle(candidate.frameStart, candidate.frameEnd, frameOrigin, durationFrames)}
                    onPointerDown={event => selectCandidate(event, track, candidate)}
                    onDoubleClick={event => { event.stopPropagation(); openCandidateSound(track.trackId, candidate) }}
                    title={presentation.title}
                    aria-label={`発話候補 ${candidate.frameStart}–${candidate.frameEnd}F ${presentation.label}`}
                  ><span>{presentation.label}</span></button>
                })}
                {audioSelection?.trackId === track.trackId && <span className="dialogueAudioSelection" style={rangeStyle(audioSelection.frameStart, audioSelection.frameEnd, frameOrigin, durationFrames)} />}
              </div>
            ))}
            <span className="dialogueAudioPlayhead" style={{ left: `${(playheadFrame - frameOrigin) / Math.max(1, durationFrames) * 100}%` }} />
          </div>
        </div>
      </div>

      <footer className="dialogueAudioFooter">
        <input ref={fileInputRef} type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm" hidden onChange={event => void importAudio(event)} />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={recording || playing}>再生ヘッドへ音声読込</button>
        <span className="dialogueAudioSelectionSummary">{audioSelection ? `${audioSelection.frameStart}–${audioSelection.frameEnd}F (${audioSelection.frameEnd - audioSelection.frameStart + 1}F)` : '範囲未選択'}</span>
        <button type="button" onClick={silenceSelection} disabled={recording || playing || !audioSelection}>範囲を無音化</button>
        <button type="button" onClick={() => rippleDelete()} disabled={recording || playing || !audioSelection}>範囲をリップル削除</button>
        <button type="button" onClick={() => copySelection(false)} disabled={!audioSelection}>コピー</button>
        <button type="button" onClick={() => copySelection(true)} disabled={!audioSelection}>切り取り</button>
        <button type="button" onClick={() => pasteClipboard('overwrite')} disabled={!clipboard}>上書き貼付</button>
        <button type="button" onClick={() => pasteClipboard('insert')} disabled={!clipboard}>挿入貼付</button>
        <label>無音<input className="dialogueAudioFrameCount" type="number" min="1" max={durationFrames} value={silenceFrameCount} onChange={event => setSilenceFrameCount(Math.max(1, Math.round(Number(event.target.value) || 1)))} />F</label>
        <button type="button" onClick={() => insertSilence()} disabled={recording || playing || !activeTrack?.clips.length}>挿入</button>
        <button type="button" onClick={createSoundFromSelection} disabled={!selectedCandidate && !audioSelection}>{selectedCandidate?.cueLinks?.some(link => link.revisionId === activeRevisionId) ? 'SOUNDを編集' : 'SOUNDを作成'}</button>
        <button type="button" onClick={ignoreSelectedCandidate} disabled={!selectedCandidate}>候補を無視</button>
        <label>検出感度<input type="range" min="0" max="1" step="0.01" value={cutState.detectionSensitivity} onChange={event => onCutStateChange({ ...cutState, detectionSensitivity: Number(event.target.value) })} /></label>
        <button type="button" onClick={() => void redetectActiveTrack()} disabled={recording || playing || !activeTrack?.clips.length}>セリフ区間を再検出</button>
        <button type="button" onClick={() => { stopPlayback(false); if (activeTrack) commitCutState({ ...cutState, tracks: cutState.tracks.map(track => track.trackId === activeTrack.trackId ? { ...track, clips: [], speechCandidates: [] } : track) }) }} disabled={recording || !activeTrack?.clips.length}>トラックをクリア</button>
        <span className="dialogueAudioStatus" role="status">{status}</span>
      </footer>
    </section>
  )
}

function TimeRuler(props: { frameOrigin: number; durationFrames: number; fps: number; onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void }) {
  const step = props.durationFrames > 480 ? props.fps * 2 : props.fps
  const ticks: number[] = []
  for (let offset = 0; offset < props.durationFrames; offset += step) ticks.push(props.frameOrigin + offset)
  return <div className="dialogueAudioRuler" onPointerDown={props.onPointerDown}>{ticks.map(frame => <span key={frame} style={{ left: `${(frame - props.frameOrigin) / props.durationFrames * 100}%` }}>{formatFrame(frame, props.frameOrigin, props.fps)}</span>)}</div>
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

function candidatePresentation(candidate: DialogueSpeechCandidate, activeRevisionId: string, soundCues: TimedRangeCue[]) {
  if (candidate.status === 'ignored') return { state: 'ignored', label: '無視', title: `無視した発話候補 ${candidate.frameStart}–${candidate.frameEnd}F` }
  const link = candidate.cueLinks?.find(item => item.revisionId === activeRevisionId)
  const cue = link ? soundCues.find(item => item.cueId === link.cueId) : undefined
  if (link && cue) {
    const mismatch = cue.frameStart !== candidate.frameStart || cue.frameEnd !== candidate.frameEnd
    return mismatch
      ? { state: 'mismatch', label: '要確認', title: `SOUND「${cue.label}」と検出区間が一致しません。` }
      : { state: 'linked', label: cue.label || 'SOUND', title: `SOUND「${cue.label}」へ反映済み` }
  }
  if (link || candidate.status === 'review') return { state: 'review', label: '要確認', title: candidate.reviewReason ?? 'リンク先のSOUNDを確認してください。' }
  return { state: 'pending', label: '候補', title: `ダブルクリックでSOUNDを作成 ${candidate.frameStart}–${candidate.frameEnd}F` }
}

function mergeRanges(ranges: DialogueAudioRange[]): DialogueAudioRange[] {
  return ranges.sort((left, right) => left.frameStart - right.frameStart).reduce<DialogueAudioRange[]>((result, range) => {
    const previous = result.at(-1)
    if (previous && range.frameStart <= previous.frameEnd + 1) previous.frameEnd = Math.max(previous.frameEnd, range.frameEnd)
    else result.push({ ...range })
    return result
  }, [])
}

function rangeStyle(frameStart: number, rangeFrameEnd: number, frameOrigin: number, durationFrames: number) {
  return {
    left: `${(frameStart - frameOrigin) / Math.max(1, durationFrames) * 100}%`,
    width: `${Math.max(1, rangeFrameEnd - frameStart + 1) / Math.max(1, durationFrames) * 100}%`,
  }
}

function formatFrame(frame: number, frameOrigin: number, fps: number): string {
  const elapsed = Math.max(0, Math.round(frame) - frameOrigin)
  const safeFps = Math.max(1, Math.round(fps))
  return `${Math.floor(elapsed / safeFps)}+${String(elapsed % safeFps).padStart(2, '0')} / ${Math.round(frame)}F`
}

function stopSources(sources: AudioBufferSourceNode[]) {
  sources.forEach(source => {
    try { source.stop() } catch { /* already stopped */ }
    source.disconnect()
  })
}
