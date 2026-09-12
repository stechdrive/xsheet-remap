import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { digitalStandardSheetTemplate, standardA3SheetTemplate, type SheetTemplate } from '@xsheet-remap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemplateRegionEditor } from './template-workspace-region-editor'
import { createTemplateEditorViewStore } from './templateEditorViewStore'
import { defaultSheetImageSettings } from './sheetImages'
import { TEMPLATE_CALIBRATION_TARGET_ID } from './template-workspace-model'
import { PAPER_TIMELINE_TARGET_ID, detectPaperTimelineStructure } from './paperTimelineAuthoring'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function setup(template = standardA3SheetTemplate, selectedRegionId = PAPER_TIMELINE_TARGET_ID) {
  vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, template.page.widthPx, template.page.heightPx))
  const frames = new Map<number, FrameRequestCallback>()
  let id = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++id, callback); return id })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  const setTemplate = vi.fn(), viewStore = createTemplateEditorViewStore()
  const view = render(<TemplateRegionEditor template={template} selectedRegionId={selectedRegionId}
    setTemplate={setTemplate} viewStore={viewStore} imageUrl={null} imageSettings={defaultSheetImageSettings()} onSelectRegion={vi.fn()} />)
  const flush = () => act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(f => f(0)) })
  const pointer = (type: string, x = 500, y = 500, pointerType = 'mouse', target: Element | Window = window) => {
    const events = { pointerdown: fireEvent.pointerDown, pointermove: fireEvent.pointerMove, pointerup: fireEvent.pointerUp, pointercancel: fireEvent.pointerCancel }
    events[type as keyof typeof events](target, { pointerId: 7, pointerType, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y })
  }
  return { ...view, frames, setTemplate, viewStore, flush, pointer,
    moveHandle: () => view.container.querySelector('.templateMoveHandle')! }
}

describe('template pointer transactions', () => {
  for (const operation of ['move', 'resize']) {
    for (const cancel of ['Escape', 'pointercancel', 'lostpointercapture', 'unmount']) {
      it(`cancels ${operation} on ${cancel} without committing geometry`, () => {
        const s = setup()
        const target = operation === 'move' ? s.moveHandle() : s.container.querySelector('.templateHandleKnob.vertical')!
        s.pointer('pointerdown', 500, 500, 'mouse', target)
        s.pointer('pointermove', 510, 512); s.flush()
        expect(s.container.querySelector('.templateRegionTransformPreview')).toBeTruthy()
        if (cancel === 'Escape') fireEvent.keyDown(window, { key: 'Escape' })
        else if (cancel === 'pointercancel') s.pointer('pointercancel')
        else if (cancel === 'unmount') s.unmount()
        else fireEvent(target, new PointerEvent('lostpointercapture', { pointerId: 7 }))
        s.pointer('pointerup', 520, 522); s.flush()
        expect(s.setTemplate).not.toHaveBeenCalled()
        expect(s.frames.size).toBe(0)
      })
    }
  }

  it('commits a touch movement once and keeps the immutable source snapshot during the drag', () => {
    const memo = standardA3SheetTemplate.regions.find(r => r.type === 'memo-area')!
    const s = setup(standardA3SheetTemplate, memo.regionId)
    const baseline = structuredClone(standardA3SheetTemplate)
    s.pointer('pointerdown', 500, 400, 'touch', s.moveHandle())
    const snapshot = s.container.querySelector('.templateRegionSnapshotSvg')
    s.pointer('pointermove', 512, 407, 'touch'); s.flush()
    expect(s.container.querySelector('.templateRegionSnapshotSvg')).toBe(snapshot)
    expect(s.container.querySelector('.templateEditorCanvas')?.getAttribute('data-controls-visible')).toBe('true')
    expect(s.setTemplate).not.toHaveBeenCalled()
    s.pointer('pointerup', 512, 407, 'touch')
    expect(s.setTemplate).toHaveBeenCalledTimes(1)
    const result = (s.setTemplate.mock.calls[0]![0] as (t: SheetTemplate) => SheetTemplate)(standardA3SheetTemplate)
    expect(result.regions.find(r => r.regionId === memo.regionId)!.rect.x).toBeCloseTo(memo.rect.x + 12 / standardA3SheetTemplate.page.widthPx, 3)
    expect(standardA3SheetTemplate).toEqual(baseline)
  })

  it('does not snap imported fractional positions when the selected element is only clicked', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const memo = template.regions.find(r => r.type === 'memo-area')!
    memo.rect = { x: 0.05013, y: 0.10513, w: 0.30017, h: 0.20131 }
    const s = setup(template, memo.regionId)
    s.pointer('pointerdown', 500, 400, 'mouse', s.moveHandle())
    s.pointer('pointerup', 500, 400)
    expect(s.setTemplate).not.toHaveBeenCalled()
    s.pointer('pointerdown', 500, 400, 'mouse', s.moveHandle())
    s.pointer('pointerup', 508, 407)
    const result = (s.setTemplate.mock.calls[0]![0] as (t: SheetTemplate) => SheetTemplate)(template)
    const moved = result.regions.find(r => r.regionId === memo.regionId)!.rect
    expect(moved.w).toBe(memo.rect.w)
    expect(moved.h).toBe(memo.rect.h)
    expect(moved.x).not.toBe(memo.rect.x)
  })

  it('keeps horizontal-flow placement fixed while previewing and moving a digital region vertically', () => {
    const region = digitalStandardSheetTemplate.regions.find(r => r.regionId === 'digital_cell_grid')!
    const s = setup(digitalStandardSheetTemplate, region.regionId)
    s.pointer('pointerdown', 500, 500, 'mouse', s.moveHandle())
    s.pointer('pointermove', 520, 510); s.flush()
    expect(s.container.querySelectorAll('.templateStaticPreviewSvg .gridOverlay').length).toBeGreaterThan(1)
    s.pointer('pointerup', 520, 510)
    const result = (s.setTemplate.mock.calls[0]![0] as (t: SheetTemplate) => SheetTemplate)(digitalStandardSheetTemplate)
    const changed = result.regions.find(r => r.regionId === region.regionId)!
    expect(changed.rect.x).toBe(region.rect.x)
    expect(changed.rect.y).toBeGreaterThan(region.rect.y)
  })

  it('moves the calibration outline itself during a live drag', () => {
    const template = { ...standardA3SheetTemplate, calibration: { ...standardA3SheetTemplate.calibration!,
      targetRect: detectPaperTimelineStructure(standardA3SheetTemplate)!.rect } }
    const s = setup(template, TEMPLATE_CALIBRATION_TARGET_ID)
    const before = s.container.querySelector('.templateCalibrationTargetOutline')!.getAttribute('x')
    s.pointer('pointerdown', 500, 500, 'mouse', s.moveHandle())
    s.pointer('pointermove', 504, 504); s.flush()
    expect(s.container.querySelector('.templateCalibrationTargetOutline')!.getAttribute('x')).not.toBe(before)
    s.pointer('pointercancel')
    expect(s.container.querySelector('.templateCalibrationTargetOutline')!.getAttribute('x')).toBe(before)
  })

  it('keeps knob size constant in screen pixels as zoom changes', () => {
    const s = setup()
    const radius = () => Number(s.container.querySelector('.templateHandleKnob')!.getAttribute('rx'))
    const initial = radius()
    act(() => s.viewStore.setZoom(8))
    expect(radius() * 8).toBeCloseTo(initial)
  })
})
