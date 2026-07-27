import { describe, expect, it, vi } from 'vitest'
import {
  advancePrimaryPointerActivation,
  handleWorkspaceKeyboardBoundary,
  isRepeatedPrimaryPointerActivation,
  nextSoundCueNavigationRequest,
  resolveSheetViewportPointerIntent,
  resolveWorkspaceKeyboardScope,
  sheetViewportPointerTarget,
} from './workspaceInteractionPolicy'

describe('workspace interaction policy', () => {
  it('creates monotonic one-shot SOUND navigation requests even for the same cue', () => {
    const first = nextSoundCueNavigationRequest(null, 'cue-1')
    const second = nextSoundCueNavigationRequest(first, 'cue-1')
    expect(first).toEqual({ requestId: 1, cueId: 'cue-1' })
    expect(second).toEqual({ requestId: 2, cueId: 'cue-1' })
  })

  it('routes shortcuts to the focused workspace without leaking audio commands into sheet selection', () => {
    expect(resolveWorkspaceKeyboardScope({
      owner: 'audio',
      defaultPrevented: true,
      modifier: true,
      key: 'c',
    })).toBe('ignore')
    expect(resolveWorkspaceKeyboardScope({
      owner: 'audio',
      defaultPrevented: false,
      modifier: false,
      key: 'Delete',
    })).toBe('ignore')
    expect(resolveWorkspaceKeyboardScope({
      owner: 'audio',
      defaultPrevented: false,
      modifier: true,
      key: 'z',
    })).toBe('global-history')
    expect(resolveWorkspaceKeyboardScope({
      owner: 'sheet',
      defaultPrevented: false,
      modifier: false,
      key: 'ArrowRight',
    })).toBe('sheet')
  })

  it('keeps global history available while audio owns the workspace keyboard', () => {
    const undo = vi.fn()
    const redo = vi.fn()
    const preventDefault = vi.fn()
    expect(handleWorkspaceKeyboardBoundary({
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      key: 'z',
      defaultPrevented: false,
      preventDefault,
    }, 'audio', { undo, redo })).toBe(true)
    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).not.toHaveBeenCalled()
    expect(preventDefault).toHaveBeenCalledTimes(1)
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

  it('recognizes a repeated activation only on the same nearby target within the double-click window', () => {
    const first = { targetId: 'cue-1', timeStamp: 100, clientX: 20, clientY: 30 }
    expect(isRepeatedPrimaryPointerActivation(first, { targetId: 'cue-1', timeStamp: 450, clientX: 22, clientY: 32 })).toBe(true)
    expect(isRepeatedPrimaryPointerActivation(first, { targetId: 'cue-2', timeStamp: 450, clientX: 22, clientY: 32 })).toBe(false)
    expect(isRepeatedPrimaryPointerActivation(first, { targetId: 'cue-1', timeStamp: 700, clientX: 22, clientY: 32 })).toBe(false)
    expect(isRepeatedPrimaryPointerActivation(first, { targetId: 'cue-1', timeStamp: 450, clientX: 30, clientY: 40 })).toBe(false)
  })

  it('clears a completed double activation and retains a new first activation', () => {
    const first = { targetId: 'cue-1', timeStamp: 100, clientX: 20, clientY: 30 }
    expect(advancePrimaryPointerActivation(null, first)).toEqual({ repeated: false, next: first })
    expect(advancePrimaryPointerActivation(first, { ...first, timeStamp: 300 })).toEqual({ repeated: true, next: null })
  })
})
