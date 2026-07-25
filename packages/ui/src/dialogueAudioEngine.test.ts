import { describe, expect, it } from 'vitest'
import {
  analyzeDialogueAudio,
  deleteAudioAtFrame,
  insertSilenceAtFrame,
  normalizeDetectedDialogueSpeech,
  overwritePcmAtFrame,
  slicePcmForDialogueScrub,
} from './dialogueAudioEngine'

describe('dialogue audio engine', () => {
  it('detects separated speech while preserving the silence between lines', () => {
    const sampleRate = 1000
    const samples = new Float32Array(sampleRate * 3)
    for (let index = 300; index < 900; index += 1) samples[index] = Math.sin(index * 0.2) * 0.7
    for (let index = 1700; index < 2450; index += 1) samples[index] = Math.sin(index * 0.17) * 0.6
    const result = analyzeDialogueAudio(samples, sampleRate, 24, 1, 0.52)
    expect(result.speechRanges).toHaveLength(2)
    expect(result.speechRanges[0].frameEnd).toBeLessThan(result.speechRanges[1].frameStart)
    expect(result.waveform.length).toBeGreaterThan(100)
  })

  it('punches in at an absolute frame without removing later audio', () => {
    const base = { samples: Float32Array.from([1, 1, 1, 1, 1, 1]), sampleRate: 6 }
    const replacement = { samples: Float32Array.from([0.25, 0.5]), sampleRate: 6 }
    const result = overwritePcmAtFrame(base, replacement, 2, 1, 6)
    expect([...result.samples]).toEqual([1, 0.25, 0.5, 1, 1, 1])
  })

  it('inserts and deletes one frame of audio at the playhead', () => {
    const audio = { samples: Float32Array.from([1, 2, 3, 4]), sampleRate: 4 }
    const inserted = insertSilenceAtFrame(audio, 2, 1, 1, 4)
    expect([...inserted.samples]).toEqual([1, 0, 2, 3, 4])
    expect([...deleteAudioAtFrame(inserted, 2, 1, 1, 4).samples]).toEqual([1, 2, 3, 4])
  })

  it('extracts exactly one project frame for forward and reverse scrubbing', () => {
    const audio = { samples: Float32Array.from([1, 2, 3, 4, 5, 6]), sampleRate: 6 }
    expect([...slicePcmForDialogueScrub(audio, 1, 1, 3, false).samples]).toEqual([3, 4])
    expect([...slicePcmForDialogueScrub(audio, 1, 1, 3, true).samples]).toEqual([4, 3])
  })

  it('rounds adjacent sample boundaries without extending a fractional-fps scrub past one frame', () => {
    const sampleRate = 48_000
    const fps = 24_000 / 1_001
    const sourceFrame = 7
    const expectedStart = Math.round(sourceFrame * sampleRate / fps)
    const expectedEnd = Math.round((sourceFrame + 1) * sampleRate / fps)
    const audio = { samples: Float32Array.from({ length: expectedEnd + 10 }, (_, index) => index), sampleRate }

    const scrub = slicePcmForDialogueScrub(audio, sourceFrame, 1, fps, false)

    expect(scrub.samples).toHaveLength(expectedEnd - expectedStart)
    expect(scrub.samples[0]).toBe(expectedStart)
    expect(scrub.samples.at(-1)).toBe(expectedEnd - 1)
  })

  it('normalizes only VAD-detected speech and preserves sound outside the detected ranges', () => {
    const samples = new Float32Array(1000).fill(0.01)
    samples.fill(0.05, 200, 400)
    samples.fill(0.5, 600, 800)
    const result = normalizeDetectedDialogueSpeech(
      { samples, sampleRate: 1000 },
      [{ frameStart: 2, frameEnd: 3 }, { frameStart: 6, frameEnd: 7 }],
      0,
      10,
      { rampMs: 1 },
    )

    expect(result.samples[100]).toBe(samples[100])
    expect(result.samples[500]).toBe(samples[500])
    expect(result.samples[300]).toBeGreaterThan(samples[300])
    expect(result.samples[700]).toBeLessThan(samples[700])
    expect(Math.max(...result.samples)).toBeLessThanOrEqual(10 ** (-1 / 20))
    expect(result.normalizedRanges).toHaveLength(2)
    expect(result.normalizedRanges[0].gainDb).toBeGreaterThan(0)
    expect(result.normalizedRanges[1].gainDb).toBeLessThan(0)
  })
})
