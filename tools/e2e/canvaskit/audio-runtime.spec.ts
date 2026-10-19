import { readdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './fixtures'

test('bundled VAD worker runs the real model and resets recurrent state between requests', async ({ page }, info) => {
  const assets = path.resolve(import.meta.dirname, '../../../apps/web/dist-pages/assets')
  const workers = readdirSync(assets).filter(name => /^dialogueAudioVadWorker-[\w-]+\.js$/.test(name))
  expect(workers).toHaveLength(1)
  await page.goto('./?app=remap')
  const results = await page.evaluate(async name => {
    const baseUrl = new URL('./', location.href).href
    const worker = new Worker(new URL(`assets/${name}`, baseUrl), { type: 'module' })
    const run = (id: number) => new Promise<number[]>((resolve, reject) => {
      worker.onerror = event => reject(new Error(event.message))
      worker.onmessage = event => {
        if (event.data.id !== id) return
        if (event.data.error) reject(new Error(event.data.error))
        else resolve(Array.from(event.data.probabilities))
      }
      const samples = new Float32Array(16_000)
      worker.postMessage({ id, samples, sampleRate: 16_000, baseUrl }, [samples.buffer])
    })
    try { return [await run(1), await run(2)] } finally { worker.terminate() }
  }, workers[0])
  expect(results[0]).toHaveLength(32)
  expect(results[0].every(value => Number.isFinite(value) && value > 0 && value < 0.1)).toBe(true)
  expect(results[1]).toEqual(results[0])
  await info.attach('silero-probabilities', { body: JSON.stringify(results), contentType: 'application/json' })
})
