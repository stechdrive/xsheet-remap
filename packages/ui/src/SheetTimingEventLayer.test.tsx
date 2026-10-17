import { cleanup, fireEvent, render } from '@testing-library/react'
import { createDefaultProject, createOrSetEvent, standardA3SheetTemplate } from '@xsheet-remap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSheetRenderModelContext, type SheetInputTextRenderItem } from './sheetRenderModel'
import { eventRectsForPages } from './sheet-layers-hit-geometry'
import { SheetTimingEventLayer } from './SheetTimingEventLayer'
import { sheetTimelineEventHit } from './sheetTimelineEventHit'

vi.mock('./sheetTimelineEventHit', async importOriginal => {
  const actual = await importOriginal<typeof import('./sheetTimelineEventHit')>()
  return { ...actual, sheetTimelineEventHit: vi.fn(actual.sheetTimelineEventHit) }
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

function fixture() {
  let project = createDefaultProject()
  for (let frame = 1; frame <= 64; frame++) project = createOrSetEvent(project, 'A', frame, 'cell').project
  const context = createSheetRenderModelContext(project, standardA3SheetTemplate)
  const page = context.pages[0]
  return {
    project, geometry: context.geometry, page,
    items: eventRectsForPages(project, standardA3SheetTemplate, [page]).get(page.pageId)!,
    references: [] as SheetInputTextRenderItem[], width: context.width, height: context.height,
    onPointerDown: vi.fn(), onPointerMove: vi.fn(), onPointerUp: vi.fn(), onPointerCancel: vi.fn(),
  }
}

describe('retained timing input content', () => {
  it('keeps cell geometry bounded across selection/hover handler updates and dispatches to the latest handlers', () => {
    const props = fixture()
    const { container, rerender } = render(<svg><SheetTimingEventLayer {...props} /></svg>)
    const calculations = vi.mocked(sheetTimelineEventHit).mock.calls.length
    expect(calculations).toBe(props.items.length)
    let current = props
    for (let step = 0; step < 20; step++) {
      current = { ...props, onPointerDown: vi.fn(), onPointerMove: vi.fn(), onPointerUp: vi.fn(), onPointerCancel: vi.fn() }
      rerender(<svg><SheetTimingEventLayer {...current} /></svg>)
    }
    expect(sheetTimelineEventHit).toHaveBeenCalledTimes(calculations)
    const cell = container.querySelector('[data-timeline-event-frame="1"]')!
    fireEvent.pointerDown(cell, { pointerId: 1, button: 0 })
    fireEvent.pointerMove(cell, { pointerId: 1 })
    fireEvent.pointerUp(cell, { pointerId: 1 })
    fireEvent.pointerCancel(cell, { pointerId: 1 })
    expect(current.onPointerDown).toHaveBeenCalledWith(expect.anything(), props.items[0].event, props.page)
    for (const name of ['onPointerMove', 'onPointerUp', 'onPointerCancel'] as const) expect(current[name]).toHaveBeenCalledOnce()
    expect(props.onPointerDown).not.toHaveBeenCalled()
  })

  it('updates pending/dragging feedback without rebuilding cell hits and clears it on cancellation', () => {
    const props = fixture()
    const hit = sheetTimelineEventHit(props.project, props.geometry, props.items[0].event, props.page)!
    vi.mocked(sheetTimelineEventHit).mockClear()
    const { container, rerender } = render(<svg><SheetTimingEventLayer {...props} /></svg>)
    const count = vi.mocked(sheetTimelineEventHit).mock.calls.length
    rerender(<svg><SheetTimingEventLayer {...props} pending={hit} ready /></svg>)
    expect(container.querySelectorAll('.timelineEventDragReady')).toHaveLength(1)
    rerender(<svg><SheetTimingEventLayer {...props} dragging={hit} /></svg>)
    expect(container.querySelectorAll('.timelineEventDragSource')).toHaveLength(1)
    expect(container.querySelector('.timelineEventDragPending')).toBeNull()
    rerender(<svg><SheetTimingEventLayer {...props} /></svg>)
    expect(container.querySelector('.timelineEventDragSource')).toBeNull()
    expect(sheetTimelineEventHit).toHaveBeenCalledTimes(count)
  })

  it('refreshes edited content while retaining the same visible frame targets', () => {
    const props = fixture()
    const { container, rerender } = render(<svg><SheetTimingEventLayer {...props} /></svg>)
    const keyId = props.items[0].event.keyId
    const project = { ...props.project, logicalSheet: { ...props.project.logicalSheet,
      keys: props.project.logicalSheet.keys.map(key => key.keyId === keyId ? { ...key, displayLabel: '123' } : key) } }
    const items = eventRectsForPages(project, standardA3SheetTemplate, [props.page]).get(props.page.pageId)!
    rerender(<svg><SheetTimingEventLayer {...props} project={project} items={items} /></svg>)
    expect(container.querySelector('[data-timeline-event-frame="1"] .eventText')?.textContent).toBe('123')
    expect(container.querySelectorAll('[data-timeline-event-frame]')).toHaveLength(items.length)
  })
})
