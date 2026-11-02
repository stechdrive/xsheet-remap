import { act, fireEvent, renderHook, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDefaultProject, standardA3SheetTemplate, timingHitForFrame, type SheetHit } from '@xsheet-remap/core'
import { useSheetTextSizing, type NextCueTextSizes } from './useSheetTextSizing'
import { useAppController } from './app-shell-controller'
import { canvasContextPrototype } from './canvas-context.test-support'
import { createSheetRenderModelContext, inputTextRenderItemsForPage } from './sheetRenderModel'
import { eventRectsForPages } from './sheet-layers-hit-geometry'
import './App.test-support'

afterEach(cleanup)
beforeEach(() => { vi.spyOn(canvasContextPrototype(), 'getContext').mockReturnValue(null) })

it.each([
  ['standard-a3-default', 'action'], ['standard-a3-default', 'cell'],
  ['digital-standard', 'action'], ['digital-standard', 'cell'],
] as const)('resizes selected occurrences with one Undo and preserves future input: %s %s', (presetId, role) => {
  const { result } = renderHook(() => useAppController({ appKind: 'remap' }))
  act(() => result.current.handlePresetSelect(presetId))
  const hit = (track: string, frame: number): SheetHit => ({ ...timingHitForFrame(result.current.template, role, track, frame)!, pageId: 'page_1' })
  const select = (track: string, frame: number) => act(() => result.current.handleCellClick(hit(track, frame)))
  const enter = (track: string, frame: number) => { select(track, frame); fireEvent.keyDown(window, { key: '1' }); fireEvent.keyDown(window, { key: 'Enter' }) }
  const sizes = () => result.current.project.logicalSheet.events.filter(event => event.sheetRole === role && event.valueKind === 'cell').map(event => event.fontSizePx)
  enter('A', 1); enter('A', 10); enter('B', 4)
  select('B', 4)
  act(() => result.current.textSizeControl.onApply({ kind: 'set', value: 32 }))
  const range = { role, inputMode: 'point-event' as const, paperTrack: 'A', paperTracks: ['A', 'B'], columnId: 'A', frameStart: 1, frameEnd: 6,
    anchorFrame: 1, focusFrame: 6, anchorHit: hit('A', 1), focusHit: hit('B', 6) }
  act(() => result.current.handleRangeSelect(range))
  expect(result.current.textSizeControl.value).toBeNull()
  expect(result.current.isTextFontSizeDisabled).toBe(false)
  const before = sizes(), source = result.current.project
  act(() => result.current.textSizeControl.onApply({ kind: 'set', value: 24 }))
  expect(sizes()).toEqual([24, 18, 24])
  expect(result.current.rangeSelection).toEqual(range)
  act(() => result.current.handleUndo())
  expect(sizes()).toEqual(before)
  act(() => result.current.handleRedo())
  expect(sizes()).toEqual([24, 18, 24])
  const context = createSheetRenderModelContext(result.current.project, result.current.template)
  const cache = new WeakMap()
  const old = eventRectsForPages(source, result.current.template, context.pages, { cache }).get(context.pages[0].pageId)!
  const current = eventRectsForPages(result.current.project, result.current.template, context.pages, { cache }).get(context.pages[0].pageId)!
  expect(current.find(item => item.event.frame === 10)).toBe(old.find(item => item.event.frame === 10))
  expect(inputTextRenderItemsForPage(context, context.pages[0]).filter(item => item.kind === 'cell').map(item => item.textLayout.fontSizePx)).toEqual([24, 18, 24])
  enter('C', 9)
  expect(sizes()).toEqual([24, 18, 24, 24])
  expect(result.current.project.logicalSheet.events.at(-1)?.fontSizeMode).toBe('fixed')
})

it('keeps independent SOUND/CAMERA defaults and edits both parts with one undo', () => {
  const { result } = renderHook(() => useAppController({ appKind: 'remap' }))
  const sound = (start: number) => act(() => result.current.submitSoundCueDialog({ laneId: 'sound_lane_1', frameStart: start, frameEnd: start + 4, label: 'A', text: 'あいうえお' }))
  const camera = (start: number) => act(() => result.current.submitCameraCueDialog({ laneId: 'camera_lane_1', frameStart: start, frameEnd: start + 10, label: 'PAN', camera: { shape: 'range', startLabel: 'A', endLabel: 'B' } }))
  sound(20)
  act(() => result.current.textSizeControl.onApply({ kind: 'set', value: 32 }))
  act(() => result.current.textSizeControl.onApply({ kind: 'set', part: 'secondary', value: 14 }))
  const source = result.current.project.timedRangeCues[0]
  act(() => result.current.textSizeControl.onApply({ kind: 'set', value: 64 }))
  expect(result.current.project.timedRangeCues[0]).toMatchObject({ fontSizePx: 64, secondaryFontSizePx: 28, frameStart: 20, frameEnd: 24 })
  act(() => result.current.handleUndo())
  expect(result.current.project.timedRangeCues[0]).toEqual(source)
  act(() => result.current.textSizeControl.onApply({ kind: 'set', value: 32 }))
  camera(40)
  expect(result.current.project.timedRangeCues[1].fontSizePx).toBeUndefined()
  act(() => result.current.textSizeControl.onApply({ kind: 'set', value: 24 }))
  sound(30)
  expect(result.current.project.timedRangeCues.find(cue => cue.role === 'sound' && cue.frameStart === 30)).toMatchObject({ fontSizePx: 32, secondaryFontSizePx: 14, fontSizeMode: 'fixed' })
  camera(60)
  expect(result.current.project.timedRangeCues.find(cue => cue.role === 'camera' && cue.frameStart === 60)).toMatchObject({ fontSizePx: 24, fontSizeMode: 'fixed' })
})

it('blocks font changes on protected sheets, including next-input defaults', () => {
  const project = createDefaultProject(), commitProject = vi.fn(), setNextSize = vi.fn(), commitDraft = vi.fn(() => project)
  const nextCueSizesRef = { current: {} as NextCueTextSizes }
  const { result } = renderHook(() => useSheetTextSizing({ project, template: standardA3SheetTemplate, pageSize: standardA3SheetTemplate.page,
    selection: { kind: 'none' }, nextSize: 18, setNextSize, nextCueSizesRef, protectedSheet: true, commitProject, commitDraft, scopeKey: 'protected' }))
  expect(result.current.model.disabled).toBe(true)
  act(() => result.current.apply({ kind: 'set', value: 32 }))
  expect(commitDraft).not.toHaveBeenCalled()
  expect(commitProject).not.toHaveBeenCalled()
  expect(setNextSize).not.toHaveBeenCalled()
})
