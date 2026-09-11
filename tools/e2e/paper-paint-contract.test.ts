import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { waitForPaperPaint } from './paper-paint-contract'

let paper: SVGSVGElement
const driver = { evaluate: <T>(expression: string): Promise<T> => window.eval(expression) }
beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = '<svg class="sheetSvg" data-canvaskit-state="pending"></svg><canvas></canvas>'
  paper = document.querySelector('svg')!
  vi.spyOn(paper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 200))
  Object.assign(paper.dataset, { canvaskitReady: 'true', canvaskitSceneBuilds: '1' })
})
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.useRealTimers() })

it('waits for async paint completion even when the SVG and previous frame are already present', async () => {
  let settled = false
  const pending = waitForPaperPaint(driver).then(() => { settled = true })
  await vi.advanceTimersByTimeAsync(250)
  expect(settled).toBe(false)
  paper.dataset.canvaskitState = 'active'
  await vi.advanceTimersByTimeAsync(100)
  await pending
  expect(settled).toBe(true)
})

it('rejects native SVG fallback rather than accepting an untested GPU path', async () => {
  paper.dataset.canvaskitState = 'fallback'
  const pending = expect(waitForPaperPaint(driver)).rejects.toThrow('CanvasKit is unavailable')
  await vi.advanceTimersByTimeAsync(100)
  await pending
})

it('fails with renderer diagnostics when pending paint never completes', async () => {
  const pending = expect(waitForPaperPaint(driver, true, 200)).rejects.toThrow('pending')
  await vi.advanceTimersByTimeAsync(250)
  await pending
})

it('observes completed paint when animation frame callbacks stop arriving', async () => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  let settled = false
  const pending = waitForPaperPaint(driver, true, 1_000).then(() => { settled = true })
  await vi.advanceTimersByTimeAsync(150)
  expect(settled).toBe(false)
  paper.dataset.canvaskitState = 'active'
  await vi.advanceTimersByTimeAsync(350)
  expect(settled).toBe(true)
  await pending
  expect(vi.getTimerCount()).toBe(0)
})

it('still rejects incomplete paint when animation frame callbacks stop arriving', async () => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  paper.dataset.canvaskitState = 'active'
  paper.dataset.canvaskitReady = 'false'
  const pending = waitForPaperPaint(driver, true, 350).catch(error => error)
  await vi.advanceTimersByTimeAsync(400)
  expect(await pending).toMatchObject({ message: expect.stringContaining('"ready":"false"') })
  expect(vi.getTimerCount()).toBe(0)
})

it('restarts stability sampling if the submitted drawing changes', async () => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  paper.dataset.canvaskitState = 'active'
  let settled = false
  const pending = waitForPaperPaint(driver, true, 1_000).then(() => { settled = true })
  await vi.advanceTimersByTimeAsync(250)
  expect(settled).toBe(false)
  document.querySelector('canvas')!.dataset.canvasKitDraws = '2'
  await vi.advanceTimersByTimeAsync(200)
  expect(settled).toBe(false)
  await vi.advanceTimersByTimeAsync(100)
  expect(settled).toBe(true)
  await pending
  expect(vi.getTimerCount()).toBe(0)
})
