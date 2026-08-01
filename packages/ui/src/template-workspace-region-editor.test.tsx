import { cleanup, fireEvent, render } from '@testing-library/react'
import { standardA3SheetTemplate, type SheetTemplate } from '@xsheet-remap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultSheetImageSettings } from './sheetImages'
import { TemplateRegionEditor } from './template-workspace-region-editor'

const REGION_ID = 'visibility-test-region'
const template: SheetTemplate = {
  ...standardA3SheetTemplate,
  templateId: 'visibility-test-template',
  calibration: undefined,
  defaultUnderlay: undefined,
  regions: [{
    regionId: REGION_ID,
    type: 'decorative',
    label: '表示テスト領域',
    rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
    usage: 'reference',
  }],
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TemplateRegionEditor region visibility and position locks', () => {
  it('removes hidden regions from both the static preview and hit testing', () => {
    vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
    const onSelectRegion = vi.fn()
    const commonProps = {
      template,
      setTemplate: vi.fn(),
      imageUrl: null,
      imageSettings: defaultSheetImageSettings(),
      zoom: 1,
      setZoom: vi.fn(),
      selectedRegionId: null,
      onSelectRegion,
    }
    const { container, rerender } = render(<TemplateRegionEditor {...commonProps} />)

    expect(container.querySelector('.templateReferenceRegion.decorative')).toBeTruthy()
    fireEvent.pointerDown(container.querySelector('.templateEditorHitSurface')!, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 20,
      clientY: 20,
    })
    expect(onSelectRegion).toHaveBeenCalledWith(REGION_ID)

    onSelectRegion.mockClear()
    rerender(<TemplateRegionEditor {...commonProps} hiddenRegionIds={new Set([REGION_ID])} />)

    expect(container.querySelector('.templateReferenceRegion.decorative')).toBeNull()
    fireEvent.pointerDown(container.querySelector('.templateEditorHitSurface')!, {
      pointerId: 2,
      pointerType: 'mouse',
      button: 0,
      clientX: 20,
      clientY: 20,
    })
    expect(onSelectRegion).not.toHaveBeenCalled()
  })

  it('keeps a locked selection visible without resize guides or handles', () => {
    const commonProps = {
      template,
      setTemplate: vi.fn(),
      imageUrl: null,
      imageSettings: defaultSheetImageSettings(),
      zoom: 1,
      setZoom: vi.fn(),
      selectedRegionId: REGION_ID,
      onSelectRegion: vi.fn(),
    }
    const { container, rerender } = render(<TemplateRegionEditor {...commonProps} />)

    expect(container.querySelectorAll('.templateHandleKnob')).toHaveLength(4)
    expect(container.querySelector('.templateEdgeGuides')).toBeTruthy()

    rerender(<TemplateRegionEditor {...commonProps} positionLockedRegionIds={new Set([REGION_ID])} />)

    expect(container.querySelector('.templateSelectedRegion')).toBeTruthy()
    expect(container.querySelectorAll('.templateHandleKnob')).toHaveLength(0)
    expect(container.querySelector('.templateEdgeGuides')).toBeNull()
  })
})
