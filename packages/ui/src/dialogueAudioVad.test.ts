import { describe, expect, it } from 'vitest'
import {
  DIALOGUE_VAD_STEP_SAMPLES,
  analyzeDialogueAudioWithRmsVad,
  analyzeDialogueVadProbabilities,
  dialogueVadFramesToSpeechRanges,
  getDialogueVadTuning,
  resampleDialogueAudioTo16k,
} from './dialogueAudioVad'

describe('dialogue Silero VAD tuning', () => {
  it('matches the practical KomaSync quiet defaults', () => {
    expect(getDialogueVadTuning('quiet', 0.4, 0.5)).toMatchObject({
      probabilityBase: 0.5,
      probabilityHysteresis: 0.7,
      thresholdScale: 1,
      speechRatio: 0.5,
      holdFrames: 0,
    })
    expect(getDialogueVadTuning('noisy', 0.4, 0.5)).toMatchObject({
      probabilityBase: 0.65,
      probabilityHysteresis: 0.77,
      thresholdScale: 1,
      holdFrames: 6,
    })
  })

  it('maps the Editor sensitivity control to the inverse Silero threshold scale', () => {
    expect(getDialogueVadTuning('quiet', 0.4, 0).thresholdScale).toBe(1.5)
    expect(getDialogueVadTuning('quiet', 0.4, 1).thresholdScale).toBe(0.5)
  })

  it('keeps two spoken phrases separated by a real pause', () => {
    const sampleRate = 16_000
    const fps = 24
    const samples = new Float32Array(sampleRate * 4)
    samples.fill(0.015)
    const probabilities = new Float32Array(Math.ceil(samples.length / DIALOGUE_VAD_STEP_SAMPLES))
    probabilities.fill(0.08)
    markProbabilityRange(probabilities, 0.5, 1.25, 0.84)
    markProbabilityRange(probabilities, 2.05, 2.85, 0.78)
    const result = analyzeDialogueVadProbabilities(
      samples,
      sampleRate,
      fps,
      getDialogueVadTuning('quiet', 0.4, 0.5),
      probabilities,
    )
    const ranges = dialogueVadFramesToSpeechRanges(result.frames, 1)
    expect(ranges).toHaveLength(2)
    expect(ranges[0].frameStart).toBeLessThanOrEqual(14)
    expect(ranges[0].frameEnd).toBeLessThan(ranges[1].frameStart - 8)
    expect(ranges[1].frameEnd).toBeGreaterThanOrEqual(68)
    expect(result.debug).toMatchObject({ usedFallbackRms: false, baseThreshold: 0.5, thresholdScale: 1 })
  })

  it('falls back to the tuned RMS hysteresis only when probabilities are unavailable', () => {
    const sampleRate = 1_000
    const fps = 20
    const samples = new Float32Array(sampleRate * 2)
    samples.fill(0.001)
    samples.fill(0.3, 400, 1_100)
    const tuning = getDialogueVadTuning('normal', 0.4, 0.5)
    const direct = analyzeDialogueAudioWithRmsVad(samples, sampleRate, fps, tuning)
    const emptyProbabilityResult = analyzeDialogueVadProbabilities(samples, sampleRate, fps, tuning, new Float32Array())
    expect(emptyProbabilityResult.frames).toEqual(direct.frames)
    expect(emptyProbabilityResult.debug.usedFallbackRms).toBe(true)
    expect(dialogueVadFramesToSpeechRanges(direct.frames, 1)).toHaveLength(1)
  })

  it('resamples imported audio to the model sample rate without changing duration', () => {
    const source = Float32Array.from({ length: 48_000 }, (_, index) => Math.sin(index / 20))
    const resampled = resampleDialogueAudioTo16k(source, 48_000)
    expect(resampled).toHaveLength(16_000)
    expect(resampled.some(value => Math.abs(value) > 0.5)).toBe(true)
  })
})

function markProbabilityRange(probabilities: Float32Array, startSeconds: number, endSeconds: number, value: number): void {
  const stepsPerSecond = 16_000 / DIALOGUE_VAD_STEP_SAMPLES
  const start = Math.floor(startSeconds * stepsPerSecond)
  const end = Math.ceil(endSeconds * stepsPerSecond)
  probabilities.fill(value, start, Math.min(probabilities.length, end))
}
