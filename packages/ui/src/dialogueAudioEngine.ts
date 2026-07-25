import type { DialogueSpeechRange } from './dialogueAudioProject'

export interface DialogueAudioAnalysis {
  waveform: number[]
  speechRanges: DialogueSpeechRange[]
}

export interface PcmAudio {
  samples: Float32Array
  sampleRate: number
}

export interface DialogueSpeechNormalization {
  frameStart: number
  frameEnd: number
  gainDb: number
}

export interface DialogueSpeechNormalizationResult extends PcmAudio {
  normalizedRanges: DialogueSpeechNormalization[]
}

/**
 * Normalizes only VAD-detected speech. Ambient sound and pauses remain byte-for-byte
 * unchanged, while short gain ramps avoid clicks at each detected boundary.
 */
export function normalizeDetectedDialogueSpeech(
  audio: PcmAudio,
  speechRanges: DialogueSpeechRange[],
  audioStartFrame: number,
  fps: number,
  options: { targetRmsDb?: number; peakCeilingDb?: number; minGainDb?: number; maxGainDb?: number; rampMs?: number } = {},
): DialogueSpeechNormalizationResult {
  const targetRms = dbToGain(options.targetRmsDb ?? -18)
  const peakCeiling = dbToGain(options.peakCeilingDb ?? -1)
  const minGainDb = options.minGainDb ?? -12
  const maxGainDb = options.maxGainDb ?? 18
  const rampSamples = Math.max(1, Math.round(audio.sampleRate * (options.rampMs ?? 6) / 1000))
  const samples = audio.samples.slice()
  const normalizedRanges: DialogueSpeechNormalization[] = []

  for (const range of mergeTouchingRanges(speechRanges.map(item => ({ ...item })))) {
    const start = Math.max(0, Math.min(samples.length, Math.floor((range.frameStart - audioStartFrame) * audio.sampleRate / Math.max(1, fps))))
    const end = Math.max(start, Math.min(samples.length, Math.ceil((range.frameEnd - audioStartFrame + 1) * audio.sampleRate / Math.max(1, fps))))
    if (end <= start) continue
    let energy = 0
    let peak = 0
    for (let index = start; index < end; index += 1) {
      const magnitude = Math.abs(audio.samples[index])
      energy += magnitude * magnitude
      peak = Math.max(peak, magnitude)
    }
    const rms = Math.sqrt(energy / (end - start))
    if (rms < 1e-6 || peak < 1e-6) continue
    const targetGain = targetRms / rms
    const ceilingGain = peakCeiling / peak
    const gain = Math.min(
      dbToGain(maxGainDb),
      Math.max(dbToGain(minGainDb), targetGain),
      ceilingGain,
    )
    for (let index = start; index < end; index += 1) {
      const distanceFromStart = index - start
      const distanceFromEnd = end - index - 1
      const ramp = Math.min(1, (distanceFromStart + 1) / rampSamples, (distanceFromEnd + 1) / rampSamples)
      const smoothedGain = 1 + (gain - 1) * ramp
      samples[index] = Math.max(-peakCeiling, Math.min(peakCeiling, audio.samples[index] * smoothedGain))
    }
    normalizedRanges.push({ ...range, gainDb: Math.round(gainToDb(gain) * 10) / 10 })
  }

  return { samples, sampleRate: audio.sampleRate, normalizedRanges }
}

export function analyzeDialogueAudio(
  samples: Float32Array,
  sampleRate: number,
  fps: number,
  audioStartFrame: number,
  sensitivity: number,
): DialogueAudioAnalysis {
  const safeSampleRate = Math.max(1, Math.round(sampleRate))
  const safeFps = Math.max(1, fps)
  const windowSamples = Math.max(1, Math.round(safeSampleRate * 0.02))
  const rms: number[] = []
  for (let start = 0; start < samples.length; start += windowSamples) {
    let energy = 0
    const end = Math.min(samples.length, start + windowSamples)
    for (let index = start; index < end; index += 1) energy += samples[index] * samples[index]
    rms.push(Math.sqrt(energy / Math.max(1, end - start)))
  }

  const sorted = [...rms].sort((a, b) => a - b)
  const noiseFloor = percentile(sorted, 0.2)
  const upperLevel = percentile(sorted, 0.9)
  const normalizedSensitivity = Math.max(0, Math.min(1, sensitivity))
  const startThreshold = Math.max(0.006, noiseFloor * 2.6, upperLevel * (0.34 - normalizedSensitivity * 0.2))
  const continueThreshold = Math.max(0.004, startThreshold * 0.56)
  const holdWindows = Math.max(2, Math.round(0.14 / 0.02))
  const preRollWindows = Math.max(1, Math.round(0.08 / 0.02))
  const minSpeechWindows = Math.max(2, Math.round(0.12 / 0.02))
  const ranges: Array<{ start: number; end: number }> = []
  let activeStart = -1
  let quietCount = 0

  rms.forEach((level, index) => {
    if (activeStart < 0) {
      if (level >= startThreshold) {
        activeStart = Math.max(0, index - preRollWindows)
        quietCount = 0
      }
      return
    }
    quietCount = level < continueThreshold ? quietCount + 1 : 0
    if (quietCount >= holdWindows) {
      const end = Math.max(activeStart, index - quietCount + 1)
      if (end - activeStart >= minSpeechWindows) ranges.push({ start: activeStart, end })
      activeStart = -1
      quietCount = 0
    }
  })
  if (activeStart >= 0) {
    const end = rms.length
    if (end - activeStart >= minSpeechWindows) ranges.push({ start: activeStart, end })
  }

  const secondsPerWindow = windowSamples / safeSampleRate
  const speechRanges = ranges.map(range => ({
    frameStart: audioStartFrame + Math.floor(range.start * secondsPerWindow * safeFps),
    frameEnd: audioStartFrame + Math.max(0, Math.ceil(range.end * secondsPerWindow * safeFps) - 1),
  }))
  return { waveform: summarizeDialogueWaveform(samples, 1024), speechRanges: mergeTouchingRanges(speechRanges) }
}

export function overwritePcmAtFrame(
  base: PcmAudio | null,
  replacement: PcmAudio,
  recordFrame: number,
  audioStartFrame: number,
  fps: number,
): PcmAudio {
  const sampleRate = replacement.sampleRate
  const baseSamples = base ? resampleLinear(base.samples, base.sampleRate, sampleRate) : new Float32Array()
  const offset = Math.max(0, Math.round((recordFrame - audioStartFrame) * sampleRate / Math.max(1, fps)))
  const output = new Float32Array(Math.max(baseSamples.length, offset + replacement.samples.length))
  output.set(baseSamples)
  output.set(replacement.samples, offset)
  return { samples: output, sampleRate }
}

export function insertSilenceAtFrame(audio: PcmAudio, frame: number, count: number, audioStartFrame: number, fps: number): PcmAudio {
  const offset = clampedSampleOffset(audio, frame, audioStartFrame, fps)
  const inserted = Math.max(1, Math.round(count * audio.sampleRate / Math.max(1, fps)))
  const output = new Float32Array(audio.samples.length + inserted)
  output.set(audio.samples.subarray(0, offset))
  output.set(audio.samples.subarray(offset), offset + inserted)
  return { samples: output, sampleRate: audio.sampleRate }
}

export function deleteAudioAtFrame(audio: PcmAudio, frame: number, count: number, audioStartFrame: number, fps: number): PcmAudio {
  const start = clampedSampleOffset(audio, frame, audioStartFrame, fps)
  const end = Math.min(audio.samples.length, start + Math.max(1, Math.round(count * audio.sampleRate / Math.max(1, fps))))
  const output = new Float32Array(audio.samples.length - (end - start))
  output.set(audio.samples.subarray(0, start))
  output.set(audio.samples.subarray(end), start)
  return { samples: output, sampleRate: audio.sampleRate }
}

export async function decodeAudioBlob(blob: Blob, context: AudioContext): Promise<PcmAudio> {
  const buffer = await context.decodeAudioData(await blob.arrayBuffer())
  return pcmFromAudioBuffer(buffer)
}

export async function decodeAudioDataUrl(dataUrl: string, context: AudioContext): Promise<PcmAudio> {
  return decodeAudioBlob(await (await fetch(dataUrl)).blob(), context)
}

export function pcmFromAudioBuffer(buffer: AudioBuffer): PcmAudio {
  const output = new Float32Array(buffer.length)
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel)
    for (let index = 0; index < samples.length; index += 1) output[index] += samples[index] / buffer.numberOfChannels
  }
  return { samples: output, sampleRate: buffer.sampleRate }
}

export function audioBufferFromPcm(context: BaseAudioContext, audio: PcmAudio): AudioBuffer {
  const buffer = context.createBuffer(1, audio.samples.length, audio.sampleRate)
  buffer.getChannelData(0).set(audio.samples)
  return buffer
}

/**
 * Extracts an inclusive frame span from an asset. Reverse scrubbing uses the
 * same source span with its PCM samples reversed, so silence and clip timing
 * can still be scheduled on the project timeline by the caller.
 */
export function slicePcmForDialogueScrub(
  audio: PcmAudio,
  sourceFrameStart: number,
  frameCount: number,
  fps: number,
  reverse: boolean,
): PcmAudio {
  const safeFps = Math.max(1, fps)
  const safeFrameStart = Math.max(0, sourceFrameStart)
  const safeFrameCount = Math.max(1, frameCount)
  const sampleStart = Math.max(0, Math.min(audio.samples.length, Math.round(safeFrameStart * audio.sampleRate / safeFps)))
  const requestedEnd = Math.round((safeFrameStart + safeFrameCount) * audio.sampleRate / safeFps)
  const sampleEnd = Math.max(sampleStart, Math.min(audio.samples.length, requestedEnd))
  const samples = audio.samples.slice(sampleStart, sampleEnd)
  if (reverse) samples.reverse()
  return { samples, sampleRate: audio.sampleRate }
}

export function pcmToWavBlob(audio: PcmAudio): Blob {
  const dataBytes = audio.samples.length * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, audio.sampleRate, true)
  view.setUint32(28, audio.sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)
  audio.samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 0x7fff), true))
  return new Blob([buffer], { type: 'audio/wav' })
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('音声を読み込めませんでした。'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

export function durationFramesForAudio(audio: PcmAudio, fps: number): number {
  return Math.max(0, Math.ceil(audio.samples.length / audio.sampleRate * Math.max(1, fps)))
}

export function summarizeDialogueWaveform(samples: Float32Array, pointCount: number): number[] {
  if (samples.length === 0) return []
  const count = Math.max(1, Math.min(pointCount, samples.length))
  const bucketSize = samples.length / count
  return Array.from({ length: count }, (_, bucket) => {
    const start = Math.floor(bucket * bucketSize)
    const end = Math.max(start + 1, Math.floor((bucket + 1) * bucketSize))
    let peak = 0
    for (let index = start; index < Math.min(samples.length, end); index += 1) peak = Math.max(peak, Math.abs(samples[index]))
    return Math.min(1, peak)
  })
}

function mergeTouchingRanges(ranges: DialogueSpeechRange[]): DialogueSpeechRange[] {
  return ranges.reduce<DialogueSpeechRange[]>((result, range) => {
    const previous = result.at(-1)
    if (previous && range.frameStart <= previous.frameEnd + 1) previous.frameEnd = Math.max(previous.frameEnd, range.frameEnd)
    else result.push({ ...range })
    return result
  }, [])
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))]
}

function dbToGain(db: number): number {
  return 10 ** (db / 20)
}

function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(Number.EPSILON, gain))
}

function resampleLinear(samples: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate || samples.length === 0) return samples.slice()
  const output = new Float32Array(Math.max(1, Math.round(samples.length * targetRate / sourceRate)))
  for (let index = 0; index < output.length; index += 1) {
    const source = index * sourceRate / targetRate
    const low = Math.floor(source)
    const high = Math.min(samples.length - 1, low + 1)
    const mix = source - low
    output[index] = samples[low] * (1 - mix) + samples[high] * mix
  }
  return output
}

function clampedSampleOffset(audio: PcmAudio, frame: number, audioStartFrame: number, fps: number): number {
  return Math.max(0, Math.min(audio.samples.length, Math.round((frame - audioStartFrame) * audio.sampleRate / Math.max(1, fps))))
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
}
