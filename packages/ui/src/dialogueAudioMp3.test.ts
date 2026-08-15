import { describe, expect, it } from 'vitest'
import { encodeDialogueAudioMp3 } from './dialogueAudioMp3'

describe('dialogue audio MP3 encoding', () => {
  it('encodes mono 48 kHz PCM with an MP3 frame header', async () => {
    const bytes = await encodeDialogueAudioMp3({
      samples: new Float32Array(48_000),
      sampleRate: 48_000,
    })

    expect(bytes.length).toBeGreaterThan(1_000)
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1] & 0xe0).toBe(0xe0)
  }, 15_000)
})
