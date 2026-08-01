import { describe, expect, it } from 'vitest'
import {
  resolveSheetTemplateRegionCapabilities,
  type SheetTemplateRegion,
} from './sheet-template-schema'
import {
  getSheetTemplatePaperTracks,
  getSheetTemplateVisiblePaperTracks,
  getTemplateFramesPerPage,
  hitTestSheetTemplate,
} from './sheet-template-layout'
import { standardA3SheetTemplate } from './sheet-template-presets'

function region(overrides: Partial<SheetTemplateRegion> = {}): SheetTemplateRegion {
  return {
    regionId: 'region',
    type: 'decorative',
    label: '領域',
    rect: { x: 0, y: 0, w: 1, h: 1 },
    usage: 'render-only',
    ...overrides,
  }
}

describe('sheet template region capabilities', () => {
  it('separates a rendered timing grid from one that accepts input', () => {
    const grid = {
      role: 'cell' as const,
      rowCount: 1,
      columns: [{ columnId: 'cell_a', label: 'A', paperTrack: 'A' }],
    }

    expect(resolveSheetTemplateRegionCapabilities(region({
      type: 'exposure-grid',
      usage: 'input',
      grid,
    }))).toMatchObject({ rendersGrid: true, projectsTimelineData: true, acceptsTimelineInput: true })

    expect(resolveSheetTemplateRegionCapabilities(region({
      type: 'exposure-grid',
      usage: 'render-only',
      inputMode: 'point-event',
      grid,
    }))).toMatchObject({ rendersGrid: true, projectsTimelineData: true, acceptsTimelineInput: false })

    expect(resolveSheetTemplateRegionCapabilities(region({
      type: 'exposure-grid',
      usage: 'reference',
      inputKind: 'timing-event',
      inputMode: 'point-event',
      grid,
    }))).toMatchObject({ rendersGrid: true, projectsTimelineData: true, acceptsTimelineInput: true })

    expect(resolveSheetTemplateRegionCapabilities(region({
      type: 'decorative',
      usage: 'render-only',
      grid,
    }))).toMatchObject({ rendersGrid: true, projectsTimelineData: false, acceptsTimelineInput: false })
  })

  it('keeps render-only forms visible without exposing field or memo editing', () => {
    const form = { columns: [1], rows: [1], cells: [] }

    expect(resolveSheetTemplateRegionCapabilities(region({ form }))).toMatchObject({
      rendersForm: true,
      acceptsFormInput: false,
      providesMemoTargets: false,
    })
    expect(resolveSheetTemplateRegionCapabilities(region({ usage: 'reference', form }))).toMatchObject({
      rendersForm: true,
      acceptsFormInput: false,
      providesMemoTargets: true,
    })
  })

  it('only exposes editable cut metadata and suppresses every ignored region capability', () => {
    expect(resolveSheetTemplateRegionCapabilities(region({
      type: 'metadata-field',
      usage: 'input',
      binding: { target: 'cut-metadata', field: 'title' },
    })).acceptsMetadataInput).toBe(true)

    expect(resolveSheetTemplateRegionCapabilities(region({
      type: 'metadata-field',
      usage: 'input',
      binding: { target: 'cut-metadata', field: 'page' },
    })).acceptsMetadataInput).toBe(false)

    expect(resolveSheetTemplateRegionCapabilities(region({
      usage: 'ignored',
      grid: { role: 'other', rowCount: 1, columns: [] },
      form: { columns: [1], rows: [1], cells: [] },
    }))).toEqual({
      rendered: false,
      rendersGrid: false,
      rendersForm: false,
      rendersReferenceOutline: false,
      projectsTimelineData: false,
      acceptsTimelineInput: false,
      acceptsMetadataInput: false,
      acceptsFormInput: false,
      providesMemoTargets: false,
    })
  })

  it('keeps output projection separate from editing across every grid usage', () => {
    const timelineRegion = (
      regionId: string,
      usage: SheetTemplateRegion['usage'],
      paperTrack: string,
      x: number,
      rowCount: number,
      explicitInput = false,
    ): SheetTemplateRegion => ({
      regionId,
      type: 'exposure-grid',
      label: regionId,
      rect: { x, y: 0.1, w: 0.2, h: 0.8 },
      usage,
      ...(explicitInput ? { inputKind: 'timing-event' as const, inputMode: 'point-event' as const } : {}),
      grid: {
        role: 'cell',
        frameStart: 1,
        rowCount,
        columns: [{
          columnId: `${regionId}-column`,
          label: paperTrack,
          paperTrack,
          xdtsEligible: true,
        }],
      },
    })
    const template = {
      ...structuredClone(standardA3SheetTemplate),
      viewLayout: { type: 'paged' as const },
      pageModel: undefined,
      defaults: {
        ...standardA3SheetTemplate.defaults,
        durationFrames: 12,
        paperTracks: ['A', 'B', 'C', 'D'],
      },
      regions: [
        timelineRegion('input', 'input', 'A', 0.05, 4),
        timelineRegion('reference', 'reference', 'B', 0.28, 6, true),
        timelineRegion('render-only', 'render-only', 'C', 0.51, 8),
        timelineRegion('ignored', 'ignored', 'D', 0.74, 999, true),
      ],
    }

    expect(getSheetTemplateVisiblePaperTracks(template)).toEqual(['A', 'B', 'C'])
    expect(getSheetTemplatePaperTracks(template)).toEqual(['A', 'B', 'C'])
    expect(getTemplateFramesPerPage(template)).toBe(8)
    expect(hitTestSheetTemplate(template, { x: 0.1, y: 0.2 })?.regionId).toBe('input')
    expect(hitTestSheetTemplate(template, { x: 0.33, y: 0.2 })?.regionId).toBe('reference')
    expect(hitTestSheetTemplate(template, { x: 0.56, y: 0.2 })).toBeNull()
    expect(hitTestSheetTemplate(template, { x: 0.79, y: 0.2 })).toBeNull()
  })
})
