import { expect, it, vi } from 'vitest'
import { DialogueAudioCache } from './dialogueAudioCache'
import type { PcmAudio } from './dialogueAudioEngine'

const asset = (assetId: string, audioDataUrl = assetId) => ({ assetId, audioDataUrl })
const pcm = (length = 4): PcmAudio => ({ samples: Float32Array.from({ length }, (_, i) => i / length), sampleRate: 48000 })

it('shares in-flight decoding and reuses exactly the same samples for split clips', async () => {
  const cache = new DialogueAudioCache(), audio = pcm(), decode = vi.fn(async () => audio)
  const results = await Promise.all([0, 1, 2].map(() => cache.getOrDecode(asset('a'), decode)))
  expect(decode).toHaveBeenCalledTimes(1)
  expect(results.every(result => result === audio)).toBe(true)
  expect(await cache.getOrDecode(asset('a'), decode)).toBe(audio)
  expect(decode).toHaveBeenCalledTimes(1)
})

it('bounds completed PCM by bytes, evicts the least recently used asset and never truncates audio', async () => {
  const cache = new DialogueAudioCache(32), decode = vi.fn(async () => pcm())
  await cache.getOrDecode(asset('a'), decode); await cache.getOrDecode(asset('b'), decode)
  await cache.getOrDecode(asset('a'), decode); await cache.getOrDecode(asset('c'), decode)
  await cache.getOrDecode(asset('a'), decode)
  expect(decode).toHaveBeenCalledTimes(3)
  await cache.getOrDecode(asset('b'), decode)
  expect(decode).toHaveBeenCalledTimes(4)
  const oversized = vi.fn(async () => pcm(20))
  expect((await cache.getOrDecode(asset('large'), oversized)).samples).toEqual(pcm(20).samples)
  await cache.getOrDecode(asset('large'), oversized)
  expect(oversized).toHaveBeenCalledTimes(2)
})

it('drops changed/deleted assets and cannot resurrect stale pending results after clear', async () => {
  const cache = new DialogueAudioCache(), decode = vi.fn(async () => pcm())
  await cache.getOrDecode(asset('a'), decode)
  cache.retain([asset('a', 'new')])
  await cache.getOrDecode(asset('a', 'new'), decode)
  cache.retain([])
  await cache.getOrDecode(asset('a'), decode)
  expect(decode).toHaveBeenCalledTimes(3)
  let finish!: (audio: PcmAudio) => void
  const pending = cache.getOrDecode(asset('b'), () => new Promise(resolve => { finish = resolve }))
  await Promise.resolve(); cache.clear(); finish(pcm()); await pending
  await cache.getOrDecode(asset('b'), decode)
  expect(decode).toHaveBeenCalledTimes(4)
})

it('does not let an old decode overwrite normalized audio, and retries failed decodes', async () => {
  const cache = new DialogueAudioCache()
  let finish!: (audio: PcmAudio) => void
  const pending = cache.getOrDecode(asset('a'), () => new Promise(resolve => { finish = resolve }))
  await Promise.resolve()
  const normalized = pcm(8)
  cache.set('a', { dataUrl: 'normalized', audio: normalized })
  finish(pcm()); await pending
  const decode = vi.fn(async () => pcm())
  expect(await cache.getOrDecode(asset('a', 'normalized'), decode)).toBe(normalized)
  expect(decode).not.toHaveBeenCalled()
  await expect(cache.getOrDecode(asset('failure'), async () => { throw new Error('invalid') })).rejects.toThrow('invalid')
  await cache.getOrDecode(asset('failure'), decode)
  expect(decode).toHaveBeenCalledTimes(1)
})
