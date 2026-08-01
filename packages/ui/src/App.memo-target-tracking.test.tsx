import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { standardA3SheetTemplate } from '@xsheet-remap/core'
import { App } from './App'
import { openAppNavigationMenu, setSheetRect } from './App.test-support'
import { uiText } from './i18n'

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

it('re-resolves a selected custom-template memo target and blocks input while that target is absent', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const committedMoveTo = vi.fn()
  const committedContext = {
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: committedMoveTo,
    setTransform: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return this.classList.contains('committedAnnotationCanvas') ? committedContext : null
  })
  render(<App />)
  const memoButton = screen.getByRole('button', { name: 'MEMOを編集' })
  const initialLeft = memoButton.style.left
  fireEvent.click(memoButton)
  fireEvent.click(screen.getByRole('button', { name: 'メモツールを開く' }))
  fireEvent.click(screen.getByRole('button', { name: uiText.sheet.penTool }))

  const movedTemplate = structuredClone(standardA3SheetTemplate)
  movedTemplate.name = '同一IDの移動テンプレート'
  const movedMemoRegion = movedTemplate.regions.find(region => region.regionId === 'top_memo_area')
  if (!movedMemoRegion) throw new Error('MEMO region not found')
  movedMemoRegion.rect = { ...movedMemoRegion.rect, x: movedMemoRegion.rect.x + 0.1 }

  const importTemplate = async (template: typeof movedTemplate) => {
    const menu = openAppNavigationMenu()
    const input = within(menu).getByText('シートテンプレートを読み込む…')
      .closest('label')?.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('template input not found')
    fireEvent.change(input, {
      target: { files: [new File([JSON.stringify(template)], 'template.json', { type: 'application/json' })] },
    })
    await waitFor(() => expect(confirm).toHaveBeenCalled())
  }

  await importTemplate(movedTemplate)
  const movedMemoButton = await screen.findByRole('button', { name: 'MEMOを編集' })
  await waitFor(() => expect(movedMemoButton.style.left).not.toBe(initialLeft))
  expect(movedMemoButton.getAttribute('data-annotation-target-selected')).toBe('true')
  expect(document.querySelector('.annotationFloatingPalette')?.getAttribute('data-annotation-target-kind')).toBe('template-region')

  const surface = document.querySelector<SVGSVGElement>('.pageAnnotationInputSurface[data-annotation-tool="pen"]')!
  setSheetRect(surface as unknown as HTMLElement, 0, 0)
  surface.setPointerCapture = vi.fn()
  committedMoveTo.mockClear()
  fireEvent.pointerDown(surface, {
    pointerId: 38,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: 600,
    clientY: 400,
  })
  fireEvent.pointerUp(window, {
    pointerId: 38,
    pointerType: 'mouse',
    button: 0,
    buttons: 0,
    clientX: 600,
    clientY: 400,
  })
  await waitFor(() => expect(committedMoveTo).toHaveBeenCalled())
  const committedCanvas = document.querySelector<HTMLCanvasElement>('.committedAnnotationCanvas')!
  const [drawX, drawY] = committedMoveTo.mock.calls.at(-1)!
  expect(drawX / Number.parseFloat(committedCanvas.style.width)).toBeCloseTo(0.6)
  expect(drawY / Number.parseFloat(committedCanvas.style.height)).toBeCloseTo(0.4)

  const missingTemplate = structuredClone(movedTemplate)
  missingTemplate.name = '同一IDの対象なしテンプレート'
  missingTemplate.regions = missingTemplate.regions.filter(region => region.regionId !== 'top_memo_area')
  await importTemplate(missingTemplate)
  await waitFor(() => expect(document.querySelector('.pageAnnotationInputSurface')).toBeNull())
  expect(document.querySelector('.annotationFloatingPalette')?.getAttribute('data-annotation-tool')).toBe('pen')

  await importTemplate(movedTemplate)
  const restoredMemoButton = await screen.findByRole('button', { name: 'MEMOを編集' })
  await waitFor(() => expect(document.querySelector('.pageAnnotationInputSurface[data-annotation-tool="pen"]')).toBeTruthy())
  expect(restoredMemoButton.getAttribute('data-annotation-target-selected')).toBe('true')
})
