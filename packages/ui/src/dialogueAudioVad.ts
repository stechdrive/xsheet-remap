import type { DialogueAudioVadPreset, DialogueSpeechRange } from './dialogueAudioProject'

export const DIALOGUE_VAD_SAMPLE_RATE = 16_000
export const DIALOGUE_VAD_CHUNK_SAMPLES = 512
export const DIALOGUE_VAD_STEP_SAMPLES = 512
export const DIALOGUE_VAD_CONTEXT_SAMPLES = 64

const PROBABILITY_MIN = 0.05
const PROBABILITY_MAX = 0.95
const NOISE_FLOOR_QUANTILE = 0.2
const NOISE_FLOOR_MULTIPLIER = 2
const START_PREROLL_FRAMES = 3
const START_PREROLL_VOLUME_RATIO = 0.2

export interface DialogueVadTuning {
  startThreshold: number
  endThreshold: number
  holdFrames: number
  speechRatio: number
  probabilityBase: number
  probabilityHysteresis: number
  thresholdScale: number
}

export interface DialogueVadFrame {
  frameIndex: number
  time: number
  volume: number
  isSpeech: boolean
  isPreroll: boolean
}

export interface DialogueVadDebug {
  probabilitiesLength: number
  probMin: number | null
  probMax: number | null
  probNanCount: number
  noiseFloor: number | null
  autoThreshold: number | null
  baseThreshold: number | null
  thresholdScale: number | null
  startThreshold: number | null
  endThreshold: number | null
  speechRatio: number
  holdFrames: number
  usedFallbackRms: boolean
}

export interface DialogueVadFrameAnalysis {
  frames: DialogueVadFrame[]
  debug: DialogueVadDebug
}

export function getDialogueVadTuning(
  preset: DialogueAudioVadPreset,
  stability01: number,
  sensitivity01: number,
): DialogueVadTuning {
  const stability = clamp(stability01, 0, 1)
  // UIは右ほど高感度、SileroのthresholdScaleは小さいほど高感度。
  const thresholdScale = clamp(1.5 - clamp(sensitivity01, 0, 1), 0.5, 1.5)
  const probabilityBase = preset === 'noisy' ? 0.65 : 0.5
  const probabilityHysteresis = preset === 'noisy' ? 0.77 : 0.7
  const holdFrames = preset === 'quiet' ? 0 : Math.round(2 + 10 * stability)
  const baseThreshold = preset === 'quiet' ? 0.03 : preset === 'noisy' ? 0.08 : 0.05
  const startThreshold = clamp(baseThreshold * (1 - 0.4 * stability) * thresholdScale, 0.005, 0.5)
  const hysteresisRatio = clamp(0.85 - 0.25 * stability, 0.55, 0.9)
  return {
    startThreshold,
    endThreshold: startThreshold * hysteresisRatio,
    holdFrames,
    speechRatio: 0.5,
    probabilityBase,
    probabilityHysteresis,
    thresholdScale,
  }
}

export function resampleDialogueAudioTo16k(input: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === DIALOGUE_VAD_SAMPLE_RATE) return input.slice()
  if (input.length === 0 || sampleRate <= 0) return new Float32Array()
  const ratio = sampleRate / DIALOGUE_VAD_SAMPLE_RATE
  const output = new Float32Array(Math.max(1, Math.floor(input.length / ratio)))
  for (let index = 0; index < output.length; index += 1) {
    const sourcePosition = index * ratio
    const low = Math.floor(sourcePosition)
    const high = Math.min(low + 1, input.length - 1)
    const mix = sourcePosition - low
    output[index] = input[low] * (1 - mix) + input[high] * mix
  }
  return output
}

export function analyzeDialogueVadProbabilities(
  samples: Float32Array,
  sampleRate: number,
  fps: number,
  tuning: DialogueVadTuning,
  probabilities: Float32Array,
): DialogueVadFrameAnalysis {
  if (samples.length === 0 || sampleRate <= 0 || fps <= 0 || probabilities.length === 0) {
    return analyzeDialogueAudioWithRmsVad(samples, sampleRate, fps, tuning)
  }

  const baseThreshold = clamp(tuning.probabilityBase, PROBABILITY_MIN, PROBABILITY_MAX)
  const thresholdScale = clamp(tuning.thresholdScale, 0.5, 1.5)
  const noiseFloor = quantile(probabilities, NOISE_FLOOR_QUANTILE)
  const autoThreshold = Math.max(baseThreshold, noiseFloor * NOISE_FLOOR_MULTIPLIER)
  const startThreshold = clamp(autoThreshold * thresholdScale, PROBABILITY_MIN, PROBABILITY_MAX)
  const hysteresis = clamp(tuning.probabilityHysteresis, 0.4, 0.95)
  const endThreshold = clamp(startThreshold * hysteresis, PROBABILITY_MIN, startThreshold)
  const speechRatio = clamp(tuning.speechRatio, 0.1, 0.95)
  const holdFrames = Math.max(1, Math.round(tuning.holdFrames))
  const totalFrames = Math.round(samples.length * fps / sampleRate)
  const frames: DialogueVadFrame[] = []
  let active = false
  let belowCount = 0

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    const { startSample, endSample, rms } = frameVolume(samples, sampleRate, fps, frameIndex)
    if (startSample >= endSample) break
    const frameStartSample16k = Math.max(0, Math.floor(frameIndex / fps * DIALOGUE_VAD_SAMPLE_RATE))
    const frameEndSample16k = Math.max(frameStartSample16k + 1, Math.floor((frameIndex + 1) / fps * DIALOGUE_VAD_SAMPLE_RATE))
    const maximumStep = probabilities.length - 1
    const stepStart = clamp(Math.floor(frameStartSample16k / DIALOGUE_VAD_STEP_SAMPLES), 0, maximumStep)
    const stepEnd = clamp(Math.floor((frameEndSample16k - 1) / DIALOGUE_VAD_STEP_SAMPLES), 0, maximumStep)
    const threshold = active ? endThreshold : startThreshold
    let matchingSteps = 0
    const stepCount = Math.max(0, stepEnd - stepStart + 1)
    for (let step = stepStart; step <= stepEnd; step += 1) {
      if (probabilities[step] >= threshold) matchingSteps += 1
    }
    const frameSpeech = stepCount > 0 && matchingSteps / stepCount >= speechRatio
    if (active) {
      if (frameSpeech) belowCount = 0
      else if (++belowCount >= holdFrames) {
        active = false
        belowCount = 0
      }
    } else if (frameSpeech) {
      active = true
      belowCount = 0
    }
    frames.push({ frameIndex, time: frameIndex / fps, volume: rms, isSpeech: active, isPreroll: false })
  }

  applySpeechPreroll(frames, tuning)
  const probabilityStats = finiteStats(probabilities)
  return {
    frames,
    debug: {
      probabilitiesLength: probabilities.length,
      probMin: probabilityStats.min,
      probMax: probabilityStats.max,
      probNanCount: probabilityStats.nanCount,
      noiseFloor,
      autoThreshold,
      baseThreshold,
      thresholdScale,
      startThreshold,
      endThreshold,
      speechRatio,
      holdFrames,
      usedFallbackRms: false,
    },
  }
}

export function analyzeDialogueAudioWithRmsVad(
  samples: Float32Array,
  sampleRate: number,
  fps: number,
  tuning: DialogueVadTuning,
): DialogueVadFrameAnalysis {
  const frames: DialogueVadFrame[] = []
  if (samples.length === 0 || sampleRate <= 0 || fps <= 0) return { frames, debug: fallbackDebug(tuning) }
  const totalFrames = Math.round(samples.length * fps / sampleRate)
  const holdFrames = Math.max(1, Math.round(tuning.holdFrames))
  let active = false
  let belowCount = 0
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    const { startSample, endSample, rms } = frameVolume(samples, sampleRate, fps, frameIndex)
    if (startSample >= endSample) break
    if (active) {
      if (rms < tuning.endThreshold) {
        belowCount += 1
        if (belowCount >= holdFrames) {
          active = false
          belowCount = 0
        }
      } else belowCount = 0
    } else if (rms >= tuning.startThreshold) {
      active = true
      belowCount = 0
    }
    frames.push({ frameIndex, time: frameIndex / fps, volume: rms, isSpeech: active, isPreroll: false })
  }
  applySpeechPreroll(frames, tuning)
  return { frames, debug: fallbackDebug(tuning) }
}

export function dialogueVadFramesToSpeechRanges(
  frames: DialogueVadFrame[],
  audioStartFrame: number,
): DialogueSpeechRange[] {
  return dialogueVadFramesToRanges(frames, audioStartFrame, frame => frame.isSpeech)
}

export function dialogueVadFramesToPrerollRanges(
  frames: DialogueVadFrame[],
  audioStartFrame: number,
): DialogueSpeechRange[] {
  return dialogueVadFramesToRanges(frames, audioStartFrame, frame => frame.isPreroll)
}

function dialogueVadFramesToRanges(
  frames: DialogueVadFrame[],
  audioStartFrame: number,
  matches: (frame: DialogueVadFrame) => boolean,
): DialogueSpeechRange[] {
  const ranges: DialogueSpeechRange[] = []
  let rangeStart = -1
  for (let index = 0; index <= frames.length; index += 1) {
    const matched = frames[index] ? matches(frames[index]) : false
    if (matched && rangeStart < 0) rangeStart = index
    if (!matched && rangeStart >= 0) {
      ranges.push({ frameStart: audioStartFrame + rangeStart, frameEnd: audioStartFrame + index - 1 })
      rangeStart = -1
    }
  }
  return ranges
}

function applySpeechPreroll(frames: DialogueVadFrame[], tuning: DialogueVadTuning): void {
  const volumeThreshold = tuning.startThreshold * START_PREROLL_VOLUME_RATIO
  for (let index = 1; index < frames.length; index += 1) {
    if (frames[index - 1].isSpeech || !frames[index].isSpeech) continue
    for (let offset = 1; offset <= START_PREROLL_FRAMES; offset += 1) {
      const target = frames[index - offset]
      if (!target) break
      if (!target.isSpeech && target.volume >= volumeThreshold) {
        target.isSpeech = true
        target.isPreroll = true
      }
    }
  }
}

function frameVolume(samples: Float32Array, sampleRate: number, fps: number, frameIndex: number) {
  const startSample = Math.round(frameIndex * sampleRate / fps)
  const endSample = Math.min(samples.length, Math.round((frameIndex + 1) * sampleRate / fps))
  let energy = 0
  for (let index = startSample; index < endSample; index += 1) energy += samples[index] * samples[index]
  const rms = endSample > startSample ? Math.sqrt(energy / (endSample - startSample)) : 0
  return { startSample, endSample, rms }
}

function fallbackDebug(tuning: DialogueVadTuning): DialogueVadDebug {
  return {
    probabilitiesLength: 0,
    probMin: null,
    probMax: null,
    probNanCount: 0,
    noiseFloor: null,
    autoThreshold: null,
    baseThreshold: null,
    thresholdScale: null,
    startThreshold: tuning.startThreshold,
    endThreshold: tuning.endThreshold,
    speechRatio: clamp(tuning.speechRatio, 0.1, 0.95),
    holdFrames: Math.max(1, Math.round(tuning.holdFrames)),
    usedFallbackRms: true,
  }
}

function finiteStats(values: Float32Array): { min: number | null; max: number | null; nanCount: number } {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let nanCount = 0
  values.forEach(value => {
    if (!Number.isFinite(value)) nanCount += 1
    else {
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
  })
  return {
    min: min === Number.POSITIVE_INFINITY ? null : min,
    max: max === Number.NEGATIVE_INFINITY ? null : max,
    nanCount,
  }
}

function quantile(values: ArrayLike<number>, ratio: number): number {
  if (values.length === 0) return 0
  const sorted = Array.from(values).filter(Number.isFinite).sort((left, right) => left - right)
  if (sorted.length === 0) return 0
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(ratio * (sorted.length - 1))))]
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
