import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemplateStartScreen, type TemplateStartScreenProps } from './TemplateStartScreen'

afterEach(() => cleanup())

function renderStartScreen(overrides: Partial<TemplateStartScreenProps> = {}) {
  const callbacks: TemplateStartScreenProps = {
    onCreateA3Standard: vi.fn(),
    onCreatePaperFromImage: vi.fn(),
    onCreateDigital: vi.fn(),
    onOpenTemplateJson: vi.fn(),
    ...overrides,
  }
  render(<TemplateStartScreen {...callbacks} />)
  return callbacks
}

describe('TemplateStartScreen', () => {
  it('presents the three-step route and four clearly named starting choices', () => {
    renderStartScreen()

    expect(screen.getByRole('heading', { name: 'テンプレート作成を始める' })).toBeTruthy()
    const steps = screen.getByRole('list', { name: 'テンプレート作成の流れ' })
    expect(steps.textContent).toContain('作り方')
    expect(steps.textContent).toContain('用紙レイアウト')
    expect(steps.textContent).toContain('自動検証してJSONを書き出す')
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toContain('いまここ')

    expect(screen.getByRole('button', { name: /標準用紙を調整/ })).toBeTruthy()
    expect(screen.getByText('おすすめ')).toBeTruthy()
    expect(screen.getByLabelText('用紙画像から作成')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'デジタルシートを作成' })).toBeTruthy()
    expect(screen.getByLabelText('既存JSONを開く')).toBeTruthy()
  })

  it('dispatches the two button choices through their callbacks', () => {
    const callbacks = renderStartScreen()

    fireEvent.click(screen.getByRole('button', { name: /標準用紙を調整/ }))
    fireEvent.click(screen.getByRole('button', { name: /デジタルシートを作成/ }))

    expect(callbacks.onCreateA3Standard).toHaveBeenCalledTimes(1)
    expect(callbacks.onCreateDigital).toHaveBeenCalledTimes(1)
  })

  it('passes the selected image and JSON files through accessible native file inputs', () => {
    const callbacks = renderStartScreen()
    const imageInput = screen.getByLabelText('用紙画像から作成') as HTMLInputElement
    const jsonInput = screen.getByLabelText('既存JSONを開く') as HTMLInputElement
    const image = new File(['image'], 'studio-sheet.png', { type: 'image/png' })
    const json = new File(['{}'], 'studio.template.json', { type: 'application/json' })

    expect(imageInput.type).toBe('file')
    expect(imageInput.accept).toBe('image/*')
    expect(imageInput.tabIndex).toBe(0)
    expect(jsonInput.type).toBe('file')
    expect(jsonInput.accept).toBe('.json,application/json')
    expect(jsonInput.tabIndex).toBe(0)

    fireEvent.change(imageInput, { target: { files: [image] } })
    fireEvent.change(jsonInput, { target: { files: [json] } })

    expect(callbacks.onCreatePaperFromImage).toHaveBeenCalledWith(image)
    expect(callbacks.onOpenTemplateJson).toHaveBeenCalledWith(json)
  })

  it('uses native focusable buttons for non-file choices', () => {
    renderStartScreen()

    const standard = screen.getByRole('button', { name: /標準用紙を調整/ }) as HTMLButtonElement
    const digital = screen.getByRole('button', { name: /デジタルシートを作成/ }) as HTMLButtonElement
    expect(standard.type).toBe('button')
    expect(standard.tabIndex).toBe(0)
    expect(digital.type).toBe('button')
    expect(digital.tabIndex).toBe(0)
  })
})
