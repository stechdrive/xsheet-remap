import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TemplateEditorApp } from './TemplateEditorApp'
import { uiText } from './i18n'

afterEach(() => cleanup())

describe('TemplateEditorApp', () => {
  it('mounts template authoring without the project sheet workspace', () => {
    render(<TemplateEditorApp />)

    expect(screen.getByText('xsheet-template')).toBeTruthy()
    expect(screen.getByText(uiText.actions.loadTemplateJson)).toBeTruthy()
    expect(screen.getByRole('button', { name: uiText.actions.downloadTemplateJson })).toBeTruthy()
    expect(document.querySelector(`.templateEditorSvg[aria-label="${uiText.template.editorLabel}"]`)).toBeTruthy()
    const staticPreview = document.querySelector('.templateStaticPreviewSvg')
    const interactionOverlay = document.querySelector('.templateEditorSvg')
    expect(staticPreview).toBeTruthy()
    expect(interactionOverlay).toBeTruthy()
    expect(staticPreview).not.toBe(interactionOverlay)
    expect(staticPreview?.querySelector('.templateStaticLayer')).toBeTruthy()
    expect(interactionOverlay?.querySelector('.templateStaticLayer')).toBeNull()
    expect(document.querySelector('.templateWorkspace')).toBeTruthy()
    expect(document.querySelector('.sheetWorkspace')).toBeNull()
  })

  it('creates a paper template from physical page settings with 3200% authoring zoom', () => {
    render(<TemplateEditorApp />)

    fireEvent.click(screen.getByRole('button', { name: '新しいテンプレート' }))
    expect(screen.getByText('1754 × 2480px')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '作成' }))

    expect(document.querySelector<HTMLElement>('.templateEditorCanvas')?.style.aspectRatio).toBe('1754 / 2480')
    const zoom = document.querySelector<HTMLInputElement>('.templateToolbar input[type="range"]')
    expect(zoom).toBeTruthy()
    expect(zoom?.max).toBe('3200')
    fireEvent.click(screen.getByRole('button', { name: '3200%' }))
    expect(document.querySelector<HTMLElement>('.templateEditorCanvas')?.style.transform).toBe('scale(32)')
    expect(document.querySelector<HTMLElement>('.templateEditorCanvas')?.style.width).toBe('1754px')
    expect(document.querySelector<HTMLElement>('.templateEditorZoomSurface')?.style.width).toBe(`${1754 * 32}px`)
    expect(document.querySelector('.templateEditorCanvas')?.classList.contains('showPixelGrid')).toBe(true)
    expect(document.querySelector<HTMLElement>('.templateDomEdgeGuide.vertical')?.style.width).toBe(`${18 / 32}px`)
    expect(document.querySelector<HTMLElement>('.templateEdgeGuides')?.style.getPropertyValue('--template-guide-line-width')).toBe(`${1.25 / 32}px`)
    expect(document.querySelector('.templateHandleSvg')).toBeTruthy()
  })

  it('creates a digital template with digital settings and without paper reference controls', () => {
    render(<TemplateEditorApp />)

    fireEvent.click(screen.getByRole('button', { name: '新しいテンプレート' }))
    fireEvent.click(screen.getByRole('tab', { name: 'デジタルタイムシート' }))
    fireEvent.click(screen.getByRole('button', { name: '作成' }))

    expect(screen.getByText('1920 × 3600px / 連続キャンバス')).toBeTruthy()
    expect(screen.getByText('CELLトラック数')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: uiText.template.detailTabs.reference })).toBeNull()
  })
})
