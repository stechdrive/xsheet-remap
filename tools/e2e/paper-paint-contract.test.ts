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
