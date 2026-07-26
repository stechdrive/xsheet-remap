import { describe, expect, it } from 'vitest'
import {
  nextSoundCueNavigationRequest,
  resolveSheetViewportPointerIntent,
  sheetViewportPointerTarget,
} from './workspaceInteractionPolicy'

describe('workspace interaction policy', () => {
  it('creates monotonic one-shot SOUND navigation requests even for the same cue', () => {
    const first = nextSoundCueNavigationRequest(null, 'cue-1')
    const second = nextSoundCueNavigationRequest(first, 'cue-1')
    expect(first).toEqual({ requestId: 1, cueId: 'cue-1' })
    expect(second).toEqual({ requestId: 2, cueId: 'cue-1' })
  })

  it.each([
    [{ pointerType: 'mouse', button: 0, spacePanReady: false, target: 'background' as const }, 'clear-primary-selection'],
    [{ pointerType: 'mouse', button: 0, spacePanReady: false, target: 'sheet-content' as const }, 'delegate'],
    [{ pointerType: 'mouse', button: 1, spacePanReady: false, target: 'background' as const }, 'begin-pan'],
    [{ pointerType: 'mouse', button: 0, spacePanReady: true, target: 'background' as const }, 'begin-pan'],
    [{ pointerType: 'mouse', button: 2, spacePanReady: false, target: 'background' as const }, 'delegate'],
    [{ pointerType: 'touch', button: 0, spacePanReady: false, target: 'background' as const }, 'clear-primary-selection'],
  ])('resolves viewport pointer ownership without conflating pan and dismiss', (input, expected) => {
    expect(resolveSheetViewportPointerIntent(input)).toBe(expected)
  })

  it('recognizes only the viewport and page-stack gaps as sheet background', () => {
    const viewport = document.createElement('div')
    viewport.className = 'sheetViewport'
    const stack = document.createElement('div')
    stack.className = 'sheetPageStack paged'
    const page = document.createElement('div')
    page.className = 'sheetPage'
    stack.append(page)
    viewport.append(stack)

    expect(sheetViewportPointerTarget(viewport, viewport)).toBe('background')
    expect(sheetViewportPointerTarget(stack, viewport)).toBe('background')
    expect(sheetViewportPointerTarget(page, viewport)).toBe('sheet-content')
  })
})
