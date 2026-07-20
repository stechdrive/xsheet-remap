import { describe, expect, it } from 'vitest'
import { analyzeDialogueAudio, deleteAudioAtFrame, insertSilenceAtFrame, overwritePcmAtFrame } from './dialogueAudioEngine'

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
})
