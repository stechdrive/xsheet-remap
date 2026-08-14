import { cleanup, createEvent, fireEvent, render } from '@testing-library/react'
import { createAlphabeticTrackLabels, digitalStandardSheetTemplate, resolveSheetTemplatePageSize, resolveSheetTemplateRegionRect, standardA3SheetTemplate, withSheetTemplatePaperTracks, type SheetTemplate } from '@xsheet-remap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultSheetImageSettings } from './sheetImages'
import { TemplateRegionEditor } from './template-workspace-region-editor'
import { PAPER_TIMELINE_TARGET_ID } from './paperTimelineAuthoring'
import { createTemplateEditorViewStore } from './templateEditorViewStore'

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
  it('zooms at the pointer with an unmodified wheel', () => {
    const viewStore = createTemplateEditorViewStore()
    const setZoom = vi.spyOn(viewStore, 'setZoom')
    const zoomFrames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      zoomFrames.push(callback)
      return 1
    })
    const { container } = render(
      <TemplateRegionEditor
        template={standardA3SheetTemplate}
        setTemplate={vi.fn()}
        imageUrl={null}
        imageSettings={defaultSheetImageSettings()}
        viewStore={viewStore}
        selectedRegionId={PAPER_TIMELINE_TARGET_ID}
        onSelectRegion={vi.fn()}
      />,
    )
    const viewport = container.querySelector<HTMLElement>('.templateEditorViewport')!
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, 500))
    const wheel = createEvent.wheel(viewport, { deltaY: -120, clientX: 200, clientY: 180 })

    fireEvent(viewport, wheel)

    expect(wheel.defaultPrevented).toBe(true)
    expect(setZoom).not.toHaveBeenCalled()
    zoomFrames[0]!(0)
    expect(setZoom).toHaveBeenCalledWith(1.12)
  })

  it('coalesces continuous wheel input into one zoom update per animation frame', () => {
    const viewStore = createTemplateEditorViewStore()
    const setZoom = vi.spyOn(viewStore, 'setZoom')
    const zoomFrames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      zoomFrames.push(callback)
      return zoomFrames.length
    })
    const { container } = render(
      <TemplateRegionEditor
        template={standardA3SheetTemplate}
        setTemplate={vi.fn()}
        imageUrl={null}
        imageSettings={defaultSheetImageSettings()}
        viewStore={viewStore}
        selectedRegionId={PAPER_TIMELINE_TARGET_ID}
        onSelectRegion={vi.fn()}
      />,
    )
    const viewport = container.querySelector<HTMLElement>('.templateEditorViewport')!
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, 500))

    fireEvent.wheel(viewport, { deltaY: -120, clientX: 200, clientY: 180 })
    fireEvent.wheel(viewport, { deltaY: -120, clientX: 200, clientY: 180 })
    fireEvent.wheel(viewport, { deltaY: -120, clientX: 200, clientY: 180 })

    expect(zoomFrames).toHaveLength(1)
    expect(setZoom).not.toHaveBeenCalled()
    zoomFrames[0]!(0)
    expect(setZoom).toHaveBeenCalledTimes(1)
    expect(setZoom).toHaveBeenCalledWith(1.12 ** 3)
  })

  it('uses Shift+wheel for horizontal scrolling without changing zoom', () => {
    const viewStore = createTemplateEditorViewStore()
    const setZoom = vi.spyOn(viewStore, 'setZoom')
    const { container } = render(
      <TemplateRegionEditor
        template={standardA3SheetTemplate}
        setTemplate={vi.fn()}
        imageUrl={null}
        imageSettings={defaultSheetImageSettings()}
        viewStore={viewStore}
        selectedRegionId={PAPER_TIMELINE_TARGET_ID}
        onSelectRegion={vi.fn()}
      />,
    )
    const viewport = container.querySelector<HTMLElement>('.templateEditorViewport')!
    const wheel = createEvent.wheel(viewport, { deltaY: 120, shiftKey: true, clientX: 200, clientY: 180 })

    fireEvent(viewport, wheel)

    expect(wheel.defaultPrevented).toBe(true)
    expect(viewport.scrollLeft).toBe(120)
    expect(setZoom).not.toHaveBeenCalled()
  })

  it('presents the physical 6-second table as one movable four-edge selection', () => {
    const { container } = render(
      <TemplateRegionEditor
        template={standardA3SheetTemplate}
        setTemplate={vi.fn()}
        imageUrl={null}
        imageSettings={defaultSheetImageSettings()}
        viewStore={createTemplateEditorViewStore()}
        selectedRegionId={PAPER_TIMELINE_TARGET_ID}
        onSelectRegion={vi.fn()}
      />,
    )

    expect(container.querySelector('.templateEditHandles.paperTimeline .templateSelectedRegion')).toBeTruthy()
    expect(container.querySelectorAll('.templateHandleKnob')).toHaveLength(4)
    expect(container.querySelectorAll('.templateEdgeGuides.paperTimeline .templateDomEdgeGuide')).toHaveLength(4)
    expect(container.querySelector<HTMLButtonElement>('.paperTimelineMoveHandle')?.textContent).toBe('6秒表を移動')
    expect(container.querySelector('.templateEditorCaption')?.textContent).toContain('6秒タイムライン表')
  })

  it('hit-tests a horizontally flowed region at its displayed position', () => {
    vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
    const action = digitalStandardSheetTemplate.regions.find(region => region.regionId === 'digital_action_grid')!
    const flowedTemplate: SheetTemplate = {
      ...digitalStandardSheetTemplate,
      horizontalFlow: {
        ...digitalStandardSheetTemplate.horizontalFlow!,
        regionIds: [action.regionId],
      },
      regions: [{ ...action, rect: { ...action.rect, x: 0.8 } }],
    }
    const onSelectRegion = vi.fn()
    const { container } = render(
      <TemplateRegionEditor
        template={flowedTemplate}
        setTemplate={vi.fn()}
        imageUrl={null}
        imageSettings={defaultSheetImageSettings()}
        viewStore={createTemplateEditorViewStore()}
        selectedRegionId={null}
        onSelectRegion={onSelectRegion}
      />,
    )

    fireEvent.pointerDown(container.querySelector('.templateEditorHitSurface')!, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 10,
      clientY: 50,
    })

    expect(onSelectRegion).toHaveBeenCalledWith(action.regionId)
  })

  it('uses the resolved digital canvas and aligns selection controls with flowed regions', () => {
    const tracks = createAlphabeticTrackLabels(22)
    const expanded = withSheetTemplatePaperTracks({
      ...digitalStandardSheetTemplate,
      defaults: {
        ...digitalStandardSheetTemplate.defaults,
        durationFrames: 481,
        paperTracks: tracks,
      },
    }, tracks)
    const selected = expanded.regions.find(region => region.regionId === 'digital_cell_grid')!
    const pageSize = resolveSheetTemplatePageSize(expanded, 481, { paperTracks: tracks })
    const resolvedRect = resolveSheetTemplateRegionRect(expanded, selected, 481, { paperTracks: tracks })

    const { container } = render(
      <TemplateRegionEditor
        template={expanded}
        setTemplate={vi.fn()}
        imageUrl={null}
        imageSettings={defaultSheetImageSettings()}
        viewStore={createTemplateEditorViewStore()}
        selectedRegionId={selected.regionId}
        onSelectRegion={vi.fn()}
      />,
    )

    expect(container.querySelector<HTMLElement>('.templateEditorCanvas')?.style.width).toBe(`${pageSize.widthPx}px`)
    expect(container.querySelector<HTMLElement>('.templateEditorCanvas')?.style.height).toBe(`${pageSize.heightPx}px`)
    expect(container.querySelector<HTMLElement>('.templateEditorZoomSurface')?.style.width).toBe(`${pageSize.widthPx}px`)
    expect(Array.from(container.querySelectorAll('.templateColumnText')).some(element => element.textContent === 'V')).toBe(true)
    const handle = container.querySelector<HTMLElement>('.templateHandleSvg')!
    expect(Number.parseFloat(handle.style.left)).toBeCloseTo(resolvedRect.x * pageSize.widthPx)
    expect(Number.parseFloat(handle.style.width)).toBeCloseTo(resolvedRect.w * pageSize.widthPx)
    expect(container.querySelectorAll('.templateHandleKnob')).toHaveLength(2)
    expect(container.querySelectorAll('.templateDomEdgeGuide.vertical')).toHaveLength(0)
    expect(container.querySelectorAll('.templateDomEdgeGuide.horizontal')).toHaveLength(2)
    expect(container.querySelector('.templateEditorCaption')?.textContent).toContain('CELL / 22列 / 481行')
  })

  it('removes hidden regions from both the static preview and hit testing', () => {
    vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
    const onSelectRegion = vi.fn()
    const commonProps = {
      template,
      setTemplate: vi.fn(),
      imageUrl: null,
      imageSettings: defaultSheetImageSettings(),
      viewStore: createTemplateEditorViewStore(),
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
      viewStore: createTemplateEditorViewStore(),
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
