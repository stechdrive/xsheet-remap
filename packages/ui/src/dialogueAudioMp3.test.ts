import { describe, expect, it } from 'vitest'
import { BufferSource, Input, Mp3InputFormat } from 'mediabunny'
import { encodeDialogueAudioMp3 } from './dialogueAudioMp3'

describe('dialogue audio MP3 encoding', () => {
  it('encodes mono 48 kHz PCM with an MP3 frame header and preserves duration and channel metadata', async () => {
    const bytes = await encodeDialogueAudioMp3({
      samples: Float32Array.from({ length: 48_000 }, (_, index) => 0.5 * Math.sin(index * 2 * Math.PI * 440 / 48_000)),
      sampleRate: 48_000,
    })

    expect(bytes.length).toBeGreaterThan(1_000)
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1] & 0xe0).toBe(0xe0)
    const input = new Input({ source: new BufferSource(bytes), formats: [new Mp3InputFormat()] })
    try {
      const track = await input.getPrimaryAudioTrack()
      expect(track).not.toBeNull()
      expect(await track!.getSampleRate()).toBe(48_000)
      expect(await track!.getNumberOfChannels()).toBe(1)
      expect(await input.computeDuration()).toBeCloseTo(1, 1)
    } finally {
      input.dispose()
    }
  }, 15_000)
})
