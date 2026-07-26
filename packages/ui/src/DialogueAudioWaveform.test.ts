import { describe, expect, it } from 'vitest'
import {
  createDialogueAudioWaveformPath,
  dialogueAudioWaveformDisplayAmplitude,
} from './DialogueAudioWaveform'

describe('DialogueAudioWaveform', () => {
  it('keeps exact digital silence at zero height', () => {
    expect(dialogueAudioWaveformDisplayAmplitude(0)).toBe(0)
    expect(createDialogueAudioWaveformPath([0])).toBe('M0.0 24.00 L0.0 24.00 Z')
  })

  it('gives recorded low-level samples a visible display-only minimum', () => {
    const amplitude = dialogueAudioWaveformDisplayAmplitude(0.000001)
    expect(amplitude).toBeCloseTo(1.25 / 21)
    expect(createDialogueAudioWaveformPath([0.000001])).toBe('M0.0 22.75 L0.0 25.25 Z')
  })

  it('compresses the display curve without changing its zero or full-scale endpoints', () => {
    expect(dialogueAudioWaveformDisplayAmplitude(0.01)).toBeCloseTo(0.1)
    expect(dialogueAudioWaveformDisplayAmplitude(0.25)).toBeCloseTo(0.5)
    expect(dialogueAudioWaveformDisplayAmplitude(1)).toBe(1)
  })
})
