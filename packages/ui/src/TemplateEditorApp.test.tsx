import { cleanup, render, screen } from '@testing-library/react'
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
})
