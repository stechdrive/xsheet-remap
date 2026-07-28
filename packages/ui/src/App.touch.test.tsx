import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from './App'
import { expectSelectedHit, setSheetRect, templateFramePoint } from './App.test-support'
import { uiText } from './i18n'

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('App: touch sheet interactions', () => {
  it('uses touch taps for cell selection and touch drags for viewport movement', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    const viewport = sheet.closest('.sheetViewport') as HTMLElement
    setSheetRect(sheet, 0, 0)
    const first = templateFramePoint('cell', 'A', 1)

    fireEvent.pointerDown(sheet, {
      pointerId: 201,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: first.x,
      clientY: first.y,
    })
    expect(document.querySelector('.selectedCellRect')).toBeNull()
    fireEvent.pointerUp(viewport, {
      pointerId: 201,
      pointerType: 'touch',
      button: 0,
      buttons: 0,
      clientX: first.x + 2,
      clientY: first.y + 2,
    })
    await waitFor(() => expectSelectedHit('cell', 'A', 1))

    const second = templateFramePoint('cell', 'A', 12)
    viewport.scrollLeft = 100
    viewport.scrollTop = 200
    fireEvent.pointerDown(sheet, {
      pointerId: 202,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: second.x,
      clientY: second.y,
    })
    fireEvent.pointerMove(viewport, {
      pointerId: 202,
      pointerType: 'touch',
      buttons: 1,
      clientX: second.x - 40,
      clientY: second.y - 60,
    })
    expect(viewport.scrollLeft).toBe(140)
    expect(viewport.scrollTop).toBe(260)
    fireEvent.pointerUp(viewport, {
      pointerId: 202,
      pointerType: 'touch',
      button: 0,
      buttons: 0,
      clientX: second.x - 50,
      clientY: second.y - 70,
    })
    expect(viewport.scrollLeft).toBe(150)
    expect(viewport.scrollTop).toBe(270)
    expectSelectedHit('cell', 'A', 1)
  })

  it('keeps finger drags as viewport movement while the pen tool is active', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'メモツールを開く' }))
    fireEvent.click(screen.getByRole('button', { name: uiText.sheet.penTool }))
    const surface = document.querySelector<SVGSVGElement>('.pageAnnotationInputSurface[data-annotation-tool="pen"]')!
    const viewport = surface.closest('.sheetViewport') as HTMLElement
    setSheetRect(surface as unknown as HTMLElement, 0, 0)
    viewport.scrollLeft = 20
    viewport.scrollTop = 30

    fireEvent.pointerDown(surface, {
      pointerId: 203,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 300,
    })
    fireEvent.pointerMove(viewport, {
      pointerId: 203,
      pointerType: 'touch',
      buttons: 1,
      clientX: 250,
      clientY: 220,
    })
    fireEvent.pointerUp(viewport, {
      pointerId: 203,
      pointerType: 'touch',
      button: 0,
      buttons: 0,
      clientX: 250,
      clientY: 220,
    })

    expect(viewport.scrollLeft).toBe(70)
    expect(viewport.scrollTop).toBe(110)
    expect(document.querySelector('.annotationStroke:not(.annotationEraserPreview)')).toBeNull()
    const preview = surface.closest('.pageAnnotationInteractionLayer')?.querySelector<HTMLCanvasElement>('.pageAnnotationInkCanvas')
    expect(preview?.dataset.inkActive).not.toBe('true')
  })

  it('keeps an active pen stroke intact when a palm touch lands on the sheet', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'メモツールを開く' }))
    fireEvent.click(screen.getByRole('button', { name: uiText.sheet.penTool }))
    const surface = document.querySelector<SVGSVGElement>('.pageAnnotationInputSurface[data-annotation-tool="pen"]')!
    const viewport = surface.closest('.sheetViewport') as HTMLElement
    setSheetRect(surface as unknown as HTMLElement, 0, 0)
    viewport.scrollLeft = 20
    viewport.scrollTop = 30

    fireEvent.pointerDown(surface, {
      pointerId: 204,
      pointerType: 'pen',
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
      pressure: 0.5,
    })
    fireEvent.pointerDown(surface, {
      pointerId: 205,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 250,
      clientY: 250,
    })
    fireEvent.pointerMove(viewport, {
      pointerId: 205,
      pointerType: 'touch',
      buttons: 1,
      clientX: 180,
      clientY: 160,
    })
    expect(viewport.scrollLeft).toBe(20)
    expect(viewport.scrollTop).toBe(30)

    fireEvent.pointerUp(window, {
      pointerId: 204,
      pointerType: 'pen',
      button: 0,
      buttons: 0,
      clientX: 140,
      clientY: 150,
      pressure: 0,
    })
    fireEvent.pointerUp(viewport, {
      pointerId: 205,
      pointerType: 'touch',
      button: 0,
      buttons: 0,
      clientX: 180,
      clientY: 160,
    })

    await waitFor(() => {
      expect(document.querySelector('.annotationStroke:not(.annotationEraserPreview)')).not.toBeNull()
    })
  })
})
