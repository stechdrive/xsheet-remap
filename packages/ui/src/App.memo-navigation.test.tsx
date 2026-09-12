import { canvasContextPrototype } from './canvas-context.test-support'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from './App'
import { standardA3SheetTemplate } from '@xsheet-remap/core'
import { dragSheet, setSheetRect, templateFramePoint } from './App.test-support'
import { uiText } from './i18n'

beforeEach(() => {
  vi.spyOn(canvasContextPrototype(), 'getContext').mockReturnValue(null)
})
afterEach(() => vi.restoreAllMocks())

async function createPanMemo() {
  render(<App />)
  const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
  const viewport = sheet.closest<HTMLElement>('.sheetViewport')!
  setSheetRect(sheet, 0, 0)
  const camera = standardA3SheetTemplate.regions.find(region => region.regionId === 'left_camera_grid')!
  const cameraPoint = (frame: number) => ({
    x: (camera.rect.x + camera.rect.w / camera.grid!.columns.length / 2) * 1000,
    y: (camera.rect.y + camera.rect.h * (frame - 0.5) / camera.grid!.rowCount) * 1000,
  })
  const start = cameraPoint(4)
  const end = cameraPoint(12)
  dragSheet(sheet, start.x, start.y, end.x, end.y)
  fireEvent.keyDown(window, { key: 'Enter' })
  fireEvent.change(screen.getByLabelText('CAMERA指示'), { target: { value: 'PAN' } })
  fireEvent.click(screen.getByRole('button', { name: '追加' }))
  const cue = await waitFor(() => {
    const found = document.querySelector('.cameraCueShapeHit')
    expect(found).toBeTruthy()
    return found!
  })
  fireEvent.pointerDown(cue, { pointerId: 101, pointerType: 'mouse', button: 0, buttons: 1, clientX: start.x, clientY: start.y })
  fireEvent.pointerUp(cue, { pointerId: 101, pointerType: 'mouse', button: 0, buttons: 0, clientX: start.x, clientY: start.y })
  fireEvent.click(screen.getByRole('button', { name: 'メモツールを開く' }))
  fireEvent.click(screen.getByRole('button', { name: uiText.sheet.penTool }))
  const memoId = await waitFor(() => {
    const selected = document.querySelector('.timelineMemoSegment.selected')
    expect(selected).toBeTruthy()
    return selected!.getAttribute('data-timeline-memo-id')!
  })
  return { sheet, viewport, memoId }
}

function expectEditing(memoId: string) {
  expect(document.querySelector('.timelineMemoSegment.selected')?.getAttribute('data-timeline-memo-id')).toBe(memoId)
  expect(document.querySelector('.annotationFloatingPalette')?.getAttribute('data-annotation-tool')).toBe('pen')
}

it('keeps the PAN memo session while a touch outside it becomes a scroll', async () => {
  const { sheet, viewport, memoId } = await createPanMemo()
  viewport.scrollTop = 200
  const start = templateFramePoint('cell', 'A', 20)
  fireEvent.pointerDown(sheet, { pointerId: 201, pointerType: 'touch', button: 0, buttons: 1, clientX: start.x, clientY: start.y })
  expectEditing(memoId)
  fireEvent.pointerMove(viewport, { pointerId: 201, pointerType: 'touch', buttons: 1, clientX: start.x, clientY: start.y - 60 })
  fireEvent.pointerUp(viewport, { pointerId: 201, pointerType: 'touch', button: 0, buttons: 0, clientX: start.x, clientY: start.y - 60 })
  expect(viewport.scrollTop).toBe(260)
  expectEditing(memoId)
  const surface = document.querySelector('.timelineMemoDrawSurface')!
  const x = (Number(surface.getAttribute('x')) + Number(surface.getAttribute('width')) / 3) * 1000
  const y = (Number(surface.getAttribute('y')) + Number(surface.getAttribute('height')) / 3) * 1000
  const pen = { pointerId: 301, pointerType: 'pen', button: 0, buttons: 1, clientX: x, clientY: y, pressure: 0.5 }
  fireEvent.pointerDown(surface, pen)
  fireEvent.pointerMove(window, { ...pen, clientX: x + 25, clientY: y + 10 })
  fireEvent.pointerUp(window, { ...pen, buttons: 0, clientX: x + 30, clientY: y + 15 })
  expect(document.querySelectorAll('.timelineMemoStroke')).toHaveLength(1)
  expectEditing(memoId)

  fireEvent.pointerDown(surface, { ...pen, pointerId: 302 })
  fireEvent.pointerMove(window, { ...pen, pointerId: 302, clientX: x + 20 })
  fireEvent.pointerCancel(window, { ...pen, pointerId: 302 })
  expect(document.querySelectorAll('.timelineMemoStroke')).toHaveLength(1)
  expectEditing(memoId)
})

it.each(['cancel', 'lost-capture', 'tap'] as const)('ends a memo only after an outside touch becomes a tap (%s)', async finish => {
  const { sheet, viewport, memoId } = await createPanMemo()
  const point = templateFramePoint('cell', 'A', 20)
  const touch = { pointerId: 202, pointerType: 'touch', button: 0, buttons: 1, clientX: point.x, clientY: point.y }
  fireEvent.pointerDown(sheet, touch)
  expectEditing(memoId)
  if (finish === 'tap') {
    fireEvent.pointerUp(viewport, { ...touch, buttons: 0 })
    expect(document.querySelector('.timelineMemoSegment.selected')).toBeNull()
  } else {
    if (finish === 'cancel') fireEvent.pointerCancel(viewport, touch)
    else fireEvent.lostPointerCapture(viewport, touch)
    fireEvent.pointerUp(viewport, { ...touch, buttons: 0 })
    expectEditing(memoId)
  }
})

it('keeps the memo during a two-finger pinch and release', async () => {
  const { sheet, viewport, memoId } = await createPanMemo()
  const first = { pointerId: 203, pointerType: 'touch', button: 0, buttons: 1, clientX: 200, clientY: 200 }
  const second = { ...first, pointerId: 204, clientX: 400 }
  fireEvent.pointerDown(sheet, first)
  fireEvent.pointerDown(sheet, second)
  fireEvent.pointerMove(viewport, { ...second, clientX: 450 })
  fireEvent.pointerUp(viewport, { ...second, buttons: 0, clientX: 450 })
  fireEvent.pointerUp(viewport, { ...first, buttons: 0 })
  expectEditing(memoId)
  expect(document.querySelectorAll('.timelineMemoStroke')).toHaveLength(0)
})

it.each(['middle', 'space'] as const)('pans from inside the memo with %s mouse input without drawing or ending it', async mode => {
  const { viewport, memoId } = await createPanMemo()
  const surface = document.querySelector('.timelineMemoDrawSurface')!
  viewport.scrollTop = 200
  if (mode === 'space') fireEvent.keyDown(window, { key: ' ', code: 'Space' })
  const mouse = { pointerId: 205, pointerType: 'mouse', button: mode === 'middle' ? 1 : 0, buttons: mode === 'middle' ? 4 : 1, clientX: 400, clientY: 400 }
  fireEvent.pointerDown(surface, mouse)
  fireEvent.pointerMove(window, { ...mouse, clientY: 340 })
  fireEvent.pointerUp(window, { ...mouse, buttons: 0, clientY: 340 })
  if (mode === 'space') fireEvent.keyUp(window, { key: ' ', code: 'Space' })
  expect(viewport.scrollTop).toBe(260)
  expectEditing(memoId)
  expect(document.querySelectorAll('.timelineMemoStroke')).toHaveLength(0)
})

it('ends editing on an outside control activation and preserves the explicit Escape exit', async () => {
  const { memoId, viewport } = await createPanMemo()
  fireEvent.pointerDown(document.body, { pointerId: 206, pointerType: 'touch', button: 0, buttons: 1 })
  expectEditing(memoId)
  fireEvent.pointerUp(document.body, { pointerId: 206, pointerType: 'touch', button: 0, buttons: 0 })
  fireEvent.click(document.body)
  expect(document.querySelector('.timelineMemoSegment.selected')).toBeNull()
  const anchor = document.querySelector('.timelineMemoAnchorHitArea')!
  const point = { pointerId: 207, pointerType: 'touch', button: 0, buttons: 1,
    clientX: (Number(anchor.getAttribute('x')) + Number(anchor.getAttribute('width')) / 2) * 1000,
    clientY: (Number(anchor.getAttribute('y')) + Number(anchor.getAttribute('height')) / 2) * 1000 }
  fireEvent.pointerDown(anchor, point)
  fireEvent.pointerUp(viewport, { ...point, buttons: 0 })
  expectEditing(memoId)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(document.querySelector('.timelineMemoSegment.selected')).toBeNull()
})
