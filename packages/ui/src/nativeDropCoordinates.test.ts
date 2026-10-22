import { afterEach, expect, it, vi } from 'vitest'
import { clientPointCandidatesFromNativeDropPosition } from './app-foundation'

afterEach(() => vi.unstubAllGlobals())
it.each([1, 1.25, 1.5, 2])('prefers the visible target in CSS coordinates at %sx DPI', scale => {
  vi.stubGlobal('devicePixelRatio', scale)
  const candidates = clientPointCandidatesFromNativeDropPosition({ x: 100 * scale, y: 200 * scale })
  const targets = [{ name: 'intended layer', left: 90, top: 190, right: 110, bottom: 210 },
    { name: 'other layer', left: 140, top: 290, right: 210, bottom: 410 }]
  const hit = candidates.flatMap(point => targets.filter(target => point.x >= target.left && point.x <= target.right && point.y >= target.top && point.y <= target.bottom))[0]
  expect(hit?.name).toBe('intended layer')
})
it('does not route a drop outside the viewport', () => {
  expect(clientPointCandidatesFromNativeDropPosition({ x: -20, y: 100 })).toEqual([])
  expect(clientPointCandidatesFromNativeDropPosition({ x: 100, y: window.innerHeight * 4 })).toEqual([])
})
