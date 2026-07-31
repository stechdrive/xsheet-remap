import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App } from './App'
import { openDisplaySettingsMenu, setSheetRect } from './App.test-support'
import { uiText } from './i18n'

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

it('reprojects a committed MEMO-region stroke when the display template changes', async () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'MEMOを編集' }))
  fireEvent.click(screen.getByRole('button', { name: 'メモツールを開く' }))
  fireEvent.click(screen.getByRole('button', { name: uiText.sheet.penTool }))
  const surface = document.querySelector<SVGSVGElement>('.pageAnnotationInputSurface[data-annotation-tool="pen"]')!
  setSheetRect(surface as unknown as HTMLElement, 0, 0)
  surface.setPointerCapture = vi.fn()

  fireEvent.pointerDown(surface, {
    pointerId: 37,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: 200,
    clientY: 240,
  })
  fireEvent.pointerUp(window, {
    pointerId: 37,
    pointerType: 'mouse',
    button: 0,
    buttons: 0,
    clientX: 280,
    clientY: 270,
  })

  await expectCommittedTarget({
    annotationRegionIds: 'top_memo_area',
    annotationLogicalTargetIds: 'memo:main',
  })

  fireEvent.click(within(openDisplaySettingsMenu()).getByRole('button', { name: 'デジタル標準' }))
  await expectCommittedTarget({
    annotationRegionIds: 'digital_memo_area',
    annotationTargetIds: 'cell:digital_memo_box',
    annotationLogicalTargetIds: 'memo:main',
  })

  fireEvent.click(within(openDisplaySettingsMenu()).getByRole('button', { name: 'A3標準' }))
  await expectCommittedTarget({ annotationRegionIds: 'top_memo_area' })
})

async function expectCommittedTarget(expected: Record<string, string>) {
  await waitFor(() => {
    expect(document.querySelector<HTMLCanvasElement>('.committedAnnotationCanvas')?.dataset).toMatchObject({
      annotationStrokeCount: '1',
      ...expected,
    })
  })
}
