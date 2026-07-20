import { describe, expect, it } from 'vitest'
import {
  addOverlayPaperTrack,
  createAlphabeticTrackLabels,
  createDefaultProject,
  createStackGuideLabel,
  digitalStandardSheetTemplate,
  logicalSheetDisplayDurationFrames,
  resolveSheetTemplateGridLayout,
  resolveSheetTemplatePageSize,
  standardA3SheetTemplate,
  timelineLanesForLayout,
  updateProjectPaperTracks,
  type SheetTemplate,
} from '@xsheet-remap/core'
import { overlayBandSegments, overlayPaperTracks, overlayVisibleSnapIndex, stampAuxiliaryPlacementTemplate, templatePaperTracks } from './app-sheet-geometry'
import { stackGuideInsertionTargets, stackGuideSvgGeometry, stackGuideVisibleSnapIndex } from './stack-guides-geometry'

function templateTracks(project: ReturnType<typeof createDefaultProject>) {
  return project.logicalSheet.paperTracks.filter(track => track.source !== 'overlay').map(track => track.paperTrack)
}

function gridLayout(template: SheetTemplate, project: ReturnType<typeof createDefaultProject>, regionId: string) {
  const region = template.regions.find(candidate => candidate.regionId === regionId)
  if (!region?.grid) throw new Error(`grid not found: ${regionId}`)
  const layout = resolveSheetTemplateGridLayout(template, region, {
    paperTracks: templateTracks(project),
    durationFrames: logicalSheetDisplayDurationFrames(project.logicalSheet),
    layoutOverrides: project.sheetView.layoutOverrides,
  })
  if (!layout) throw new Error(`layout not found: ${regionId}`)
  return { region, layout }
}

describe('auxiliary sheet geometry', () => {
  it('keeps the paper reserve while digital starts directly with variable ACTION columns', () => {
    const project = createDefaultProject()
    const a3 = overlayBandSegments(standardA3SheetTemplate, project, 'action')[0]
    const digital = overlayBandSegments(digitalStandardSheetTemplate, project, 'action')[0]
    const digitalPageSize = resolveSheetTemplatePageSize(digitalStandardSheetTemplate, project.logicalSheet.durationFrames, {
      paperTracks: project.logicalSheet.paperTracks.map(track => track.paperTrack),
      timelineLanes: timelineLanesForLayout(project),
    })

    expect(a3?.slots[0]).toMatchObject({ regionId: 'left_action_reserve_grid', x: 35 / 1754, w: 29 / 1754 })
    expect(a3?.slots[1]).toMatchObject({ regionId: 'left_action_grid', paperTrack: 'A', x: 64 / 1754 })
    expect(digital?.slots.some(slot => slot.regionId.includes('reserve'))).toBe(false)
    expect(digital?.slots[0]).toMatchObject({ regionId: 'digital_action_grid', paperTrack: 'A', x: 32 / digitalPageSize.widthPx })
    expect(digital?.slots.find(slot => slot.regionId === 'digital_cell_grid')?.w).not.toBe(digital?.slots[0]?.w)
  })

  it('renders additional logical cell tracks as digital columns and paper overflow tags', () => {
    const added = addOverlayPaperTrack(createDefaultProject(), {
      paperTrack: 'J', insertAfterPaperTrack: 'I', snapIndex: 10, sheetRole: 'cell',
    }).project

    expect(templatePaperTracks(added, digitalStandardSheetTemplate).map(track => track.paperTrack)).toContain('J')
    expect(overlayPaperTracks(added, digitalStandardSheetTemplate)).toEqual([])
    expect(templatePaperTracks(added, standardA3SheetTemplate).map(track => track.paperTrack)).not.toContain('J')
    expect(overlayPaperTracks(added, standardA3SheetTemplate).map(track => track.paperTrack)).toContain('J')

    const twelveBaseTracks = updateProjectPaperTracks(createDefaultProject(), createAlphabeticTrackLabels(12))
    expect(overlayPaperTracks(twelveBaseTracks, standardA3SheetTemplate).map(track => track.paperTrack)).toEqual(['J', 'K', 'L'])
  })

  it('re-resolves an overlay track semantically when switching A3 to digital and restores its A3 override', () => {
    const created = addOverlayPaperTrack(createDefaultProject(), {
      paperTrack: 'J',
      sheetRole: 'cell',
      insertAfterPaperTrack: 'A',
      snapIndex: 2,
      templateId: standardA3SheetTemplate.templateId,
    })
    const track = created.paperTrack
    const a3Segment = overlayBandSegments(standardA3SheetTemplate, created.project, 'cell')[0]!
    const digitalProject = { ...created.project, sheetTemplateId: digitalStandardSheetTemplate.templateId }
    const digitalSegment = overlayBandSegments(digitalStandardSheetTemplate, digitalProject, 'cell')[0]!
    const digitalAfterA = digitalSegment.slots.findIndex(slot => slot.regionId === 'digital_cell_grid' && slot.paperTrack === 'A') + 1

    expect(overlayVisibleSnapIndex(standardA3SheetTemplate, created.project, track, a3Segment)).toBe(2)
    expect(overlayVisibleSnapIndex(digitalStandardSheetTemplate, digitalProject, track, digitalSegment)).toBe(digitalAfterA)
    expect(digitalSegment.slots[digitalAfterA]?.regionId).toBe('digital_cell_grid')
    expect(overlayVisibleSnapIndex(standardA3SheetTemplate, created.project, track, a3Segment)).toBe(2)
  })

  it('stamps legacy numeric overrides with their source template before switching', () => {
    const overlay = addOverlayPaperTrack(createDefaultProject(), {
      paperTrack: 'J',
      sheetRole: 'cell',
      insertAfterPaperTrack: 'A',
      snapIndex: 2,
    })
    const guide = createStackGuideLabel(overlay.project, {
      label: 'BOOK',
      displayRole: 'cell',
      insertAfterPaperTrack: 'A',
      gapIndex: 1,
      viewSnapIndex: 2,
    })
    const legacy = {
      ...guide.project,
      logicalSheet: {
        ...guide.project.logicalSheet,
        paperTracks: guide.project.logicalSheet.paperTracks.map(track => track.source === 'overlay'
          ? { ...track, viewPlacement: { ...track.viewPlacement, templateId: undefined } }
          : track),
      },
      stackGuideLabels: guide.project.stackGuideLabels.map(label => ({ ...label, viewTemplateId: undefined })),
    }

    const stamped = stampAuxiliaryPlacementTemplate(legacy, standardA3SheetTemplate.templateId)

    expect(stamped.logicalSheet.paperTracks.find(track => track.source === 'overlay')?.viewPlacement?.templateId)
      .toBe(standardA3SheetTemplate.templateId)
    expect(stamped.stackGuideLabels[0]?.viewTemplateId).toBe(standardA3SheetTemplate.templateId)
  })

  it('keeps guide rendering and insertion operations on the same slot after a template switch', () => {
    const created = createStackGuideLabel(createDefaultProject(), {
      label: 'BG',
      displayRole: 'cell',
      insertAfterPaperTrack: 'A',
      gapIndex: 1,
      viewTemplateId: standardA3SheetTemplate.templateId,
      viewSnapIndex: 2,
    })
    const project = { ...created.project, sheetTemplateId: digitalStandardSheetTemplate.templateId }
    const { region, layout } = gridLayout(digitalStandardSheetTemplate, project, 'digital_cell_grid')
    const segment = overlayBandSegments(digitalStandardSheetTemplate, project, 'cell')[0]!
    const targets = stackGuideInsertionTargets(
      digitalStandardSheetTemplate,
      project,
      'cell',
      region.regionId,
      layout.rect,
      layout.columns,
    )
    const visibleSnapIndex = stackGuideVisibleSnapIndex(
      created.label,
      layout.columns,
      digitalStandardSheetTemplate.templateId,
      segment.slots,
      region.regionId,
    )
    const target = targets[visibleSnapIndex]
    const geometry = stackGuideSvgGeometry(
      digitalStandardSheetTemplate,
      layout.rect,
      digitalStandardSheetTemplate.page,
      created.label,
      0,
      layout.columns,
      segment.slots,
      region.regionId,
    )

    expect(target).toMatchObject({ gapIndex: 1, insertAfterPaperTrack: 'A' })
    expect(geometry.anchorX).toBe(target?.x)
    expect(target?.x).toBe(segment.slots[visibleSnapIndex]?.x)
  })
})
