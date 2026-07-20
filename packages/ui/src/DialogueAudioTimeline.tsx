import { useCallback, useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { TimedRangeCue } from '@xsheet-remap/core'
import {
  analyzeDialogueAudio,
  audioBufferFromPcm,
  blobToDataUrl,
  decodeAudioBlob,
  decodeAudioDataUrl,
  deleteAudioAtFrame,
  durationFramesForAudio,
  insertSilenceAtFrame,
  overwritePcmAtFrame,
  pcmToWavBlob,
  type PcmAudio,
} from './dialogueAudioEngine'
import type { DialogueAudioCutState, DialogueAudioTrackState } from './dialogueAudioProject'

interface DialogueAudioTimelineProps {
  cutState: DialogueAudioCutState
  fps: number
  frameOrigin: number
  durationFrames: number
  soundCues: TimedRangeCue[]
  selectedSoundCueId: string | null
  onCutStateChange: (state: DialogueAudioCutState) => void
  onPlayheadChange: (frame: number) => void
  onSoundCueSelect: (cueId: string) => void
  onSoundCueTransform: (cueId: string, updates: { laneId: string; frameStart: number; frameEnd: number }) => void
}

const MIN_PIXELS_PER_FRAME = 1.2
const MAX_PIXELS_PER_FRAME = 9

export function DialogueAudioTimeline(props: DialogueAudioTimelineProps) {
  const {
    cutState, fps, frameOrigin, durationFrames, soundCues, selectedSoundCueId,
    onCutStateChange, onPlayheadChange, onSoundCueSelect, onSoundCueTransform,
  } = props
  const [collapsed, setCollapsed] = useState(false)
  const [playheadFrame, setPlayheadFrame] = useState(frameOrigin)
  const [pixelsPerFrame, setPixelsPerFrame] = useState(2.4)
  const [playing, setPlaying] = useState(false)
  const [recording, setRecording] = useState(false)
  const [loopSelectedCue, setLoopSelectedCue] = useState(false)
  const [cueDrag, setCueDrag] = useState<{
    cueId: string
    mode: 'start' | 'body' | 'end'
    clientX: number
    origin: TimedRangeCue
    preview: TimedRangeCue
  } | null>(null)
  const [status, setStatus] = useState('カット頭または再生ヘッドから、3トラックを通して確認できます。')
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourcesRef = useRef<AudioBufferSourceNode[]>([])
  const animationRef = useRef<number | null>(null)
  const playSessionRef = useRef<{ contextStart: number; frameStart: number; frameEnd: number; loop: boolean } | null>(null)
  const recorderRef = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startFrame: number } | null>(null)
  const decodedRef = useRef(new Map<string, { dataUrl: string; audio: PcmAudio }>())
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const timelineWidth = Math.max(720, durationFrames * pixelsPerFrame)
  const frameEnd = frameOrigin + Math.max(1, durationFrames) - 1
  const activeTrack = cutState.tracks.find(track => track.trackId === cutState.activeTrackId) ?? cutState.tracks[0]
  const selectedCue = soundCues.find(cue => cue.cueId === selectedSoundCueId) ?? null

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

  async function decodedTrack(track: DialogueAudioTrackState, context: AudioContext): Promise<PcmAudio | null> {
    if (!track.audioDataUrl) return null
    const cached = decodedRef.current.get(track.trackId)
    if (cached?.dataUrl === track.audioDataUrl) return cached.audio
    const audio = await decodeAudioDataUrl(track.audioDataUrl, context)
    decodedRef.current.set(track.trackId, { dataUrl: track.audioDataUrl, audio })
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
    const sources: AudioBufferSourceNode[] = []
    const scheduled: Array<{ source: AudioBufferSourceNode; audibleStart: number; trackStart: number }> = []
    for (const track of cutState.tracks) {
      if (track.trackId === omitTrackId || track.muted || (soloed && !track.solo)) continue
      const audio = await decodedTrack(track, context)
      if (!audio?.samples.length) continue
      const audioEndFrame = track.audioStartFrame + durationFramesForAudio(audio, fps) - 1
      if (audioEndFrame < playbackStart || track.audioStartFrame > playbackEnd) continue
      const audibleStart = Math.max(playbackStart, track.audioStartFrame)
      const source = context.createBufferSource()
      source.buffer = audioBufferFromPcm(context, audio)
      source.connect(context.destination)
      sources.push(source)
      scheduled.push({ source, audibleStart, trackStart: track.audioStartFrame })
    }
    const startAt = context.currentTime + 0.05
    scheduled.forEach(({ source, audibleStart, trackStart }) => source.start(
      startAt + (audibleStart - playbackStart) / fps,
      Math.max(0, (audibleStart - trackStart) / fps),
      Math.max(0.001, (playbackEnd - audibleStart + 1) / fps),
    ))
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
      if (session.loop) {
        void startPlayback(session.frameStart)
      } else {
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
      recorder.onstop = () => void finishRecording(recorder.mimeType, chunks, playheadFrame, stream, activeTrack)
      recorderRef.current = { recorder, stream, chunks, startFrame: playheadFrame }
      recorder.start(100)
      setRecording(true)
      setStatus(`${activeTrack.name}へパンチイン録音中。ほかのトラックは再生されます。`)
      void startPlayback(playheadFrame, activeTrack.trackId)
    } catch (error) {
      setStatus(`録音を開始できませんでした: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function finishRecording(mimeType: string, chunks: Blob[], startFrame: number, stream: MediaStream, track: DialogueAudioTrackState) {
    stream.getTracks().forEach(item => item.stop())
    recorderRef.current = null
    setRecording(false)
    stopPlayback()
    if (chunks.length === 0) {
      setStatus('録音データがありませんでした。')
      return
    }
    try {
      const context = audioContext()
      const recorded = await decodeAudioBlob(new Blob(chunks, { type: mimeType }), context)
      const existing = await decodedTrack(track, context)
      const audioStartFrame = existing ? track.audioStartFrame : startFrame
      const merged = overwritePcmAtFrame(existing, recorded, startFrame, audioStartFrame, fps)
      await commitTrackAudio(track, merged, audioStartFrame)
      setPlayhead(startFrame + durationFramesForAudio(recorded, fps))
      setStatus(`${track.name}へ録音を反映しました。`)
    } catch (error) {
      setStatus(`録音を処理できませんでした: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function commitTrackAudio(track: DialogueAudioTrackState, audio: PcmAudio, audioStartFrame: number) {
    const analysis = analyzeDialogueAudio(audio.samples, audio.sampleRate, fps, audioStartFrame, cutState.detectionSensitivity)
    const audioDataUrl = await blobToDataUrl(pcmToWavBlob(audio))
    decodedRef.current.set(track.trackId, { dataUrl: audioDataUrl, audio })
    updateTrack(track.trackId, {
      audioDataUrl,
      audioStartFrame,
      durationFrames: durationFramesForAudio(audio, fps),
      waveform: analysis.waveform,
      speechRanges: analysis.speechRanges,
    })
  }

  async function importAudio(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !activeTrack) return
    try {
      const audio = await decodeAudioBlob(file, audioContext())
      await commitTrackAudio(activeTrack, audio, frameOrigin)
      setStatus(`${file.name}を${activeTrack.name}へ読み込みました。`)
    } catch (error) {
      setStatus(`音声を読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function updateTrack(trackId: string, updates: Partial<DialogueAudioTrackState>) {
    onCutStateChange({ ...cutState, tracks: cutState.tracks.map(track => track.trackId === trackId ? { ...track, ...updates } : track) })
  }

  async function editOneFrame(kind: 'insert' | 'delete') {
    if (!activeTrack?.audioDataUrl) return
    try {
      const audio = await decodedTrack(activeTrack, audioContext())
      if (!audio) return
      const edited = kind === 'insert'
        ? insertSilenceAtFrame(audio, playheadFrame, 1, activeTrack.audioStartFrame, fps)
        : deleteAudioAtFrame(audio, playheadFrame, 1, activeTrack.audioStartFrame, fps)
      await commitTrackAudio(activeTrack, edited, activeTrack.audioStartFrame)
      setStatus(`${activeTrack.name}の${playheadFrame}Fで${kind === 'insert' ? '無音1フレーム挿入' : '1フレーム削除'}しました。`)
    } catch (error) {
      setStatus(`音声編集に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function redetectActiveTrack() {
    if (!activeTrack?.audioDataUrl) return
    const audio = await decodedTrack(activeTrack, audioContext())
    if (!audio) return
    const analysis = analyzeDialogueAudio(audio.samples, audio.sampleRate, fps, activeTrack.audioStartFrame, cutState.detectionSensitivity)
    updateTrack(activeTrack.trackId, { waveform: analysis.waveform, speechRanges: analysis.speechRanges })
    setStatus(`${activeTrack.name}から${analysis.speechRanges.length}区間を検出しました。`)
  }

  function applyDetectedRangeToSelectedCue() {
    if (!selectedCue || !activeTrack) return
    const nearest = [...activeTrack.speechRanges].sort((a, b) => rangeDistance(a, selectedCue) - rangeDistance(b, selectedCue))[0]
    if (!nearest) {
      setStatus('選択トラックに検出区間がありません。')
      return
    }
    onSoundCueTransform(selectedCue.cueId, { laneId: selectedCue.laneId, frameStart: nearest.frameStart, frameEnd: nearest.frameEnd })
    setStatus(`選択中のSOUND区間を${nearest.frameStart}–${nearest.frameEnd}Fへ合わせました。`)
  }

  function seekFromPointer(event: ReactPointerEvent<HTMLElement>) {
    if (recording) return
    if (playing) stopPlayback()
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    setPlayhead(frameOrigin + ratio * durationFrames)
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
    let frameEnd = cueDrag.origin.frameEnd
    if (cueDrag.mode === 'start') frameStart = Math.max(frameOrigin, Math.min(frameEnd, frameStart + delta))
    if (cueDrag.mode === 'end') frameEnd = Math.min(frameEndForCut(), Math.max(frameStart, frameEnd + delta))
    if (cueDrag.mode === 'body') {
      const duration = frameEnd - frameStart
      frameStart = Math.max(frameOrigin, Math.min(frameEndForCut() - duration, frameStart + delta))
      frameEnd = frameStart + duration
    }
    setCueDrag({ ...cueDrag, preview: { ...cueDrag.origin, frameStart, frameEnd } })
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

  function frameEndForCut() {
    return frameOrigin + Math.max(1, durationFrames) - 1
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
        <button type="button" onClick={() => void editOneFrame('insert')} disabled={recording || playing || !activeTrack?.audioDataUrl}>+1F</button>
        <button type="button" onClick={() => void editOneFrame('delete')} disabled={recording || playing || !activeTrack?.audioDataUrl}>−1F</button>
        <label className="dialogueAudioToggle"><input type="checkbox" checked={loopSelectedCue} disabled={recording} onChange={event => setLoopSelectedCue(event.target.checked)} />選択SOUNDをループ</label>
        <span className="dialogueAudioTime">{formatFrame(playheadFrame, frameOrigin, fps)}</span>
        <label className="dialogueAudioZoom">幅<input type="range" min={MIN_PIXELS_PER_FRAME} max={MAX_PIXELS_PER_FRAME} step="0.2" value={pixelsPerFrame} onChange={event => setPixelsPerFrame(Number(event.target.value))} /></label>
      </div>

      <div className="dialogueAudioBody">
        <aside className="dialogueAudioTrackHeaders">
          <div className="dialogueAudioCueHeader">SOUND区間</div>
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
            <TimeRuler frameOrigin={frameOrigin} durationFrames={durationFrames} fps={fps} />
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
              <div key={track.trackId} className={`dialogueAudioTrack ${track.trackId === cutState.activeTrackId ? 'isActive' : ''}`} onPointerDown={seekFromPointer}>
                {track.audioDataUrl ? <Waveform track={track} frameOrigin={frameOrigin} durationFrames={durationFrames} /> : <span className="dialogueAudioEmpty">録音または音声読込</span>}
                {track.speechRanges.map((range, index) => <span key={`${range.frameStart}-${index}`} className="dialogueSpeechRange" style={rangeStyle(range.frameStart, range.frameEnd, frameOrigin, durationFrames)} />)}
              </div>
            ))}
            <span className="dialogueAudioPlayhead" style={{ left: `${(playheadFrame - frameOrigin) / Math.max(1, durationFrames) * 100}%` }} />
          </div>
        </div>
      </div>

      <footer className="dialogueAudioFooter">
        <input ref={fileInputRef} type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm" hidden onChange={event => void importAudio(event)} />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={recording || playing}>選択トラックへ音声読込</button>
        <label>検出感度<input type="range" min="0" max="1" step="0.01" value={cutState.detectionSensitivity} onChange={event => onCutStateChange({ ...cutState, detectionSensitivity: Number(event.target.value) })} /></label>
        <button type="button" onClick={() => void redetectActiveTrack()} disabled={recording || playing || !activeTrack?.audioDataUrl}>セリフ区間を再検出</button>
        <button type="button" onClick={applyDetectedRangeToSelectedCue} disabled={recording || !selectedCue || !activeTrack?.speechRanges.length}>選択SOUNDを検出区間へ</button>
        <button type="button" onClick={() => { stopPlayback(false); if (activeTrack) updateTrack(activeTrack.trackId, { audioDataUrl: undefined, durationFrames: 0, waveform: [], speechRanges: [] }) }} disabled={recording || !activeTrack?.audioDataUrl}>音声をクリア</button>
        <span className="dialogueAudioStatus" role="status">{status}</span>
      </footer>
    </section>
  )
}

function TimeRuler(props: { frameOrigin: number; durationFrames: number; fps: number }) {
  const step = props.durationFrames > 480 ? props.fps * 2 : props.fps
  const ticks: number[] = []
  for (let offset = 0; offset < props.durationFrames; offset += step) ticks.push(props.frameOrigin + offset)
  return <div className="dialogueAudioRuler">{ticks.map(frame => <span key={frame} style={{ left: `${(frame - props.frameOrigin) / props.durationFrames * 100}%` }}>{formatFrame(frame, props.frameOrigin, props.fps)}</span>)}</div>
}

function Waveform(props: { track: DialogueAudioTrackState; frameOrigin: number; durationFrames: number }) {
  const points = props.track.waveform
  if (points.length === 0) return null
  const left = (props.track.audioStartFrame - props.frameOrigin) / props.durationFrames * 100
  const width = props.track.durationFrames / props.durationFrames * 100
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
  return <svg className="dialogueWaveform" viewBox="0 0 1000 48" preserveAspectRatio="none" style={{ left: `${left}%`, width: `${width}%` }} aria-hidden="true"><path d={`${path} ${lowerPath} Z`} fill={props.track.color} /></svg>
}

function rangeStyle(frameStart: number, frameEnd: number, frameOrigin: number, durationFrames: number) {
  return {
    left: `${(frameStart - frameOrigin) / Math.max(1, durationFrames) * 100}%`,
    width: `${Math.max(1, frameEnd - frameStart + 1) / Math.max(1, durationFrames) * 100}%`,
  }
}

function formatFrame(frame: number, frameOrigin: number, fps: number): string {
  const elapsed = Math.max(0, Math.round(frame) - frameOrigin)
  const safeFps = Math.max(1, Math.round(fps))
  return `${Math.floor(elapsed / safeFps)}+${String(elapsed % safeFps).padStart(2, '0')} / ${Math.round(frame)}F`
}

function rangeDistance(a: { frameStart: number; frameEnd: number }, b: { frameStart: number; frameEnd: number }): number {
  if (a.frameEnd < b.frameStart) return b.frameStart - a.frameEnd
  if (b.frameEnd < a.frameStart) return a.frameStart - b.frameEnd
  return 0
}

function stopSources(sources: AudioBufferSourceNode[]) {
  sources.forEach(source => {
    try { source.stop() } catch { /* already stopped */ }
    source.disconnect()
  })
}
