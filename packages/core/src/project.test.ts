import { describe, expect, it } from 'vitest'
import {
  addOverlayPaperTrack,
  addAnnotation,
  addTimelineMemo,
  addBlankSharedCutToProjectDocument,
  applyNameNormalizationPlan,
  assetAbsolutePath,
  assignAssetToStackGuideLabel,
  activeCutProjectFromDocument,
  buildExportPlan,
  buildNameNormalizationPlan,
  cellHitForFrame,
  assignSheetSourceToPage,
  clearAnnotationsForPage,
  clearEvent,
  createSheetPages,
  createProjectHistory,
  createProjectDocumentFromCutProject,
  buildAeRemapText,
  buildCspImportPackage,
  createAlphabeticTrackLabels,
  clearAnnotations,
  createDefaultProject,
  createKey,
  createUnplacedCspCard,
  createOrSetEvent,
  createRecognizedEvent,
  createProjectFromTrackLabels,
  createStackGuideLabel,
  createTimedRangeCue,
  defaultCspCellName,
  deleteOverlayPaperTrack,
  digitalStandardSheetTemplate,
  eraseAnnotations,
  getSheetTemplateHiddenPaperTracks,
  getSheetTemplatePaperTracks,
  getSheetTemplateVisiblePaperTracks,
  getSheetViewLayout,
  formatLogicalSheetFrameTimecode,
  hitTestSheetTemplate,
  logicalSheetFrameNumber,
  migrateProject,
  parseProjectDocument,
  moveBindingToCorrectionLayer,
  removeCellBinding,
  NULL_CELL_CSP_CELL_NAME,
  NULL_CELL_KEY_ID,
  redoHistory,
  sheetAnnotations,
  timelineMemos,
  registerAsset,
  registerAssetRoot,
  registerAssetsToCspTrack,
  registerSheetSource,
  synchronizeAssetRoot,
  resolveSheetTemplatePageSize,
  resolveSheetTemplateRegionRect,
  setEvent,
  suggestUnplacedCspCellName,
  timingHitForFrame,
  undoHistory,
  updateKey,
  updateOrMergeTimingKeyDisplayLabel,
  updateActiveCutProjectInDocument,
  switchActiveCutInProjectDocument,
  updateCorrectionLayers,
  updateProductionStageLabel,
  updateLogicalSheetSettings,
  updatePaperTrack,
  updateProjectPaperTracks,
  reprojectProjectToTemplate,
  updateStackGuideLabel,
  updateSheetPageViewState,
  updateSheetViewState,
  upsertBinding,
  validateProject,
  withSheetTemplatePaperTracks,
  standardA3SheetTemplate,
  resolveSheetTemplateGridColumns,
  resolveSheetTemplateGridFrames,
  sheetTemplatePresets,
  sheetTemplatePresetsForImageCorrection,
  sheetTemplatePresetSupportsCapability,
  type AnnotationStroke,
  type CutProject,
  type ExportProfile,
} from './index'

function withDirectExportProfile(project: CutProject, updates: Partial<ExportProfile> = {}): CutProject {
  return {
    ...project,
    exportProfiles: [
      ...project.exportProfiles.filter(profile => profile.profileId !== 'direct'),
      {
        profileId: 'direct',
        name: '直接反映テスト',
        mode: 'direct-to-visible-slots',
        cspCellNamePolicy: { mode: 'binding-or-paper-track-label' },
        slotIds: project.cspTrackSlots.map(slot => slot.slotId),
        ...updates,
      },
    ],
  }
}

describe('core project commands', () => {
  it('creates the default logical timeline sections', () => {
    const sections = createDefaultProject().logicalSheet.timelineSections
    expect(sections.map(section => [section.role, section.inputMode, section.trackAxis, section.frameAxis])).toEqual([
      ['action', 'point-event', 'paper-tracks', 'shared-logical-frames'],
      ['sound', 'timed-range', 'fixed-lanes', 'shared-logical-frames'],
      ['cell', 'point-event', 'paper-tracks', 'shared-logical-frames'],
      ['camera', 'timed-range', 'fixed-lanes', 'shared-logical-frames'],
    ])
  })

  it('creates keys and events through immutable commands', () => {
    const initial = createDefaultProject()
    const { project, key } = createOrSetEvent(initial, 'A', 1)
    expect(initial.logicalSheet.keys).toHaveLength(0)
    expect(project.logicalSheet.keys).toHaveLength(1)
    expect(project.logicalSheet.events[0]).toMatchObject({ paperTrack: 'A', frame: 1, keyId: key.keyId })
  })

  it('replaces an existing event at the same paperTrack/frame', () => {
    const one = createOrSetEvent(createDefaultProject(), 'A', 1)
    const two = createOrSetEvent(one.project, 'A', 5)
    const replaced = setEvent(two.project, 'A', 1, two.key.keyId)
    expect(replaced.logicalSheet.events.filter(event => event.paperTrack === 'A' && event.frame === 1)).toHaveLength(1)
    expect(replaced.logicalSheet.events.find(event => event.frame === 1)?.keyId).toBe(two.key.keyId)
  })

  it('reuses a key with the same display label in the same paperTrack and role', () => {
    const one = createKey(createDefaultProject(), 'A', '1', 'manual', '1', 'cell')
    const two = createKey(one.project, 'A', '1', 'manual', '1', 'cell')
    const otherTrack = createKey(two.project, 'B', '1', 'manual', '1', 'cell')
    const otherRole = createKey(otherTrack.project, 'A', '1', 'manual', '1', 'action')

    expect(two.key.keyId).toBe(one.key.keyId)
    expect(two.project.logicalSheet.keys.filter(key => key.paperTrack === 'A' && key.sheetRole === 'cell')).toHaveLength(1)
    expect(otherTrack.key.keyId).not.toBe(one.key.keyId)
    expect(otherRole.key.keyId).not.toBe(one.key.keyId)
  })

  it('creates recognition keys and events atomically while reusing labels', () => {
    const first = createRecognizedEvent(createDefaultProject(), 'A', 3, 'cell', '○1')
    const second = createRecognizedEvent(first.project, 'A', 9, 'cell', '○1')

    expect(first.status).toBe('created')
    expect(second.status).toBe('created')
    expect(second.key?.keyId).toBe(first.key?.keyId)
    expect(second.project.logicalSheet.keys).toHaveLength(1)
    expect(second.project.logicalSheet.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ paperTrack: 'A', sheetRole: 'cell', frame: 3, keyId: first.key?.keyId, source: 'recognition' }),
      expect.objectContaining({ paperTrack: 'A', sheetRole: 'cell', frame: 9, keyId: first.key?.keyId, source: 'recognition' }),
    ]))
  })

  it('does not overwrite an existing event with a recognition result', () => {
    const existing = createOrSetEvent(createDefaultProject(), 'A', 3, 'action')
    const conflict = createRecognizedEvent(existing.project, 'A', 3, 'action', '9')
    const duplicate = createRecognizedEvent(existing.project, 'A', 3, 'action', existing.key.displayLabel)

    expect(conflict.status).toBe('conflict')
    expect(conflict.project).toBe(existing.project)
    expect(duplicate.status).toBe('already-present')
    expect(duplicate.key?.keyId).toBe(existing.key.keyId)
    expect(existing.project.logicalSheet.events).toHaveLength(1)
  })

  it('rejects duplicate display labels in the same paperTrack and role when editing keys', () => {
    const one = createKey(createDefaultProject(), 'A', '1', 'manual', '1', 'cell')
    const two = createKey(one.project, 'A', '2', 'manual', '2', 'cell')

    expect(() => updateKey(two.project, two.key.keyId, { displayLabel: '1', paperToken: '1' })).toThrow(/displayLabel already exists/)
  })

  it('keeps ACTION and CELL timing events separate at the same paperTrack/frame', () => {
    const action = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const cell = createOrSetEvent(action.project, 'A', 1, 'cell')

    expect(cell.project.logicalSheet.events).toHaveLength(2)
    expect(cell.project.logicalSheet.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ paperTrack: 'A', frame: 1, sheetRole: 'action', keyId: action.key.keyId }),
      expect.objectContaining({ paperTrack: 'A', frame: 1, sheetRole: 'cell', keyId: cell.key.keyId }),
    ]))
    expect(action.key.displayLabel).toBe('1')
    expect(cell.key.displayLabel).toBe('1')
  })

  it('exports ACTION timing events by default and can switch to CELL timing events', () => {
    const action = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const cell = createOrSetEvent(action.project, 'A', 1, 'cell')
    const labeledCell = updateKey(cell.project, cell.key.keyId, { displayLabel: '9' })
    const actionPlan = buildExportPlan(labeledCell)
    const cellPlan = buildExportPlan(labeledCell, { timingSourceRole: 'cell' })

    expect(actionPlan.tracks.find(track => track.slotId === 'slot_A')?.frames).toEqual([{ frame: 0, value: 'A1' }])
    expect(cellPlan.tracks.find(track => track.slotId === 'slot_A')?.frames).toEqual([{ frame: 0, value: 'A9' }])
  })

  it('keeps timing global while allowing multiple process bindings for the same key', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    let project = upsertBinding(created.project, { slotId: 'slot_A', keyId: created.key.keyId, cspCellName: 'A1_sakuga', materialState: 'assigned', assetId: 'asset_sakuga' })
    project = {
      ...project,
      assets: [
        { assetId: 'asset_sakuga', binId: 'asset_bin_root', originalFileName: 'A1_sakuga.png', displayName: 'A1_sakuga.png', role: 'cell-material', source: { kind: 'unresolved' } },
        { assetId: 'asset_enshutsu', binId: 'asset_bin_root', originalFileName: 'A1_enshutsu.png', displayName: 'A1_enshutsu.png', role: 'cell-material', source: { kind: 'unresolved' } },
      ],
    }
    project = upsertBinding(project, { slotId: 'slot_enshutsu_A', keyId: created.key.keyId, cspCellName: 'A1_enshutsu', materialState: 'assigned', assetId: 'asset_enshutsu' })
    const plan = buildExportPlan(withDirectExportProfile(project), { profileId: 'direct' })

    expect(project.logicalSheet.events).toHaveLength(1)
    expect(project.logicalSheet.keys).toHaveLength(1)
    expect(plan.tracks.map(track => track.slotId)).toEqual(['slot_A', 'slot_enshutsu_A'])
    expect(plan.tracks.map(track => track.frames)).toEqual([
      [{ frame: 0, value: 'A1_sakuga' }],
      [{ frame: 0, value: 'A1_enshutsu' }],
    ])
  })

  it('creates default CSP cell names from paper labels', () => {
    expect(defaultCspCellName('2', 'A')).toBe('A2')
    expect(defaultCspCellName('A2_B2_C3', 'A')).toBe('A2_B2_C3')
    expect(defaultCspCellName('x', 'A')).toBe(NULL_CELL_CSP_CELL_NAME)
  })

  it('uses a reserved null-cell event without creating a user-visible key', () => {
    const project = setEvent(createDefaultProject(), 'A', 1, NULL_CELL_KEY_ID, 'action')
    const plan = buildExportPlan(withDirectExportProfile(project), { profileId: 'direct' })

    expect(project.logicalSheet.keys).toHaveLength(0)
    expect(project.logicalSheet.events).toEqual([expect.objectContaining({ paperTrack: 'A', frame: 1, keyId: NULL_CELL_KEY_ID })])
    expect(validateProject(project).some(issue => issue.code === 'event.key.missing')).toBe(false)
    expect(plan.tracks.find(track => track.slotId === 'slot_A')?.frames).toEqual([{ frame: 0, value: NULL_CELL_CSP_CELL_NAME }])
  })

  it('clears only the selected null-cell event while preserving other null-cell events', () => {
    const first = setEvent(createDefaultProject(), 'A', 1, NULL_CELL_KEY_ID, 'action')
    const second = setEvent(first, 'B', 5, NULL_CELL_KEY_ID, 'action')
    const cleared = clearEvent(second, 'A', 1, 'action')

    expect(cleared.logicalSheet.keys).toHaveLength(0)
    expect(cleared.logicalSheet.events).toEqual([expect.objectContaining({ paperTrack: 'B', frame: 5, keyId: NULL_CELL_KEY_ID })])
  })

  it('resolves CSP cell names through an export profile policy while preserving binding overrides', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const labeled = updateKey(created.project, created.key.keyId, { displayLabel: '12' })
    const directLabeled = withDirectExportProfile(labeled)
    const displayLabelPolicy = withDirectExportProfile(labeled, { cspCellNamePolicy: { mode: 'binding-or-display-label' as const } })
    const bound = upsertBinding(displayLabelPolicy, { slotId: 'slot_A', keyId: created.key.keyId, cspCellName: 'manual_12', materialState: 'missing-ok' })

    expect(buildExportPlan(directLabeled, { profileId: 'direct' }).tracks.find(track => track.slotId === 'slot_A')?.frames).toEqual([{ frame: 0, value: 'A12' }])
    expect(buildExportPlan(displayLabelPolicy, { profileId: 'direct' }).tracks.find(track => track.slotId === 'slot_A')?.frames).toEqual([{ frame: 0, value: '12' }])
    expect(buildExportPlan(bound, { profileId: 'direct' }).tracks.find(track => track.slotId === 'slot_A')?.frames).toEqual([{ frame: 0, value: 'manual_12' }])
  })

  it('validates duplicate cell names in one slot', () => {
    const one = createOrSetEvent(createDefaultProject(), 'A', 1)
    const two = createOrSetEvent(one.project, 'A', 5)
    let project = upsertBinding(two.project, { slotId: 'slot_A', keyId: one.key.keyId, cspCellName: 'A1', materialState: 'missing-ok' })
    project = upsertBinding(project, { slotId: 'slot_A', keyId: two.key.keyId, cspCellName: 'A1', materialState: 'missing-ok' })
    expect(validateProject(project).some(issue => issue.code === 'binding.cspCellName.duplicateInSlot')).toBe(true)
  })

  it('builds export plan with zero-based XDTS frames', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const project = upsertBinding(created.project, { slotId: 'slot_A', keyId: created.key.keyId, cspCellName: 'A1', materialState: 'missing-ok' })
    const plan = buildExportPlan(withDirectExportProfile(project), { profileId: 'direct' })
    expect(plan.tracks[0].frames[0]).toEqual({ frame: 0, value: 'A1' })
  })

  it('formats logical sheet frames as one-based anime timecode', () => {
    const sheet = { frameOrigin: 1 }
    expect(logicalSheetFrameNumber(sheet, 1)).toBe(1)
    expect(formatLogicalSheetFrameTimecode(1, 1, 24)).toBe('0+1')
    expect(logicalSheetFrameNumber(sheet, 24)).toBe(24)
    expect(formatLogicalSheetFrameTimecode(24, 1, 24)).toBe('0+24')
    expect(logicalSheetFrameNumber(sheet, 25)).toBe(25)
    expect(formatLogicalSheetFrameTimecode(25, 1, 24)).toBe('1+1')
    expect(formatLogicalSheetFrameTimecode(48, 1, 24)).toBe('1+24')
  })

  it('formats anime timecode relative to the logical sheet origin', () => {
    const sheet = { frameOrigin: 73 }
    expect(logicalSheetFrameNumber(sheet, 73)).toBe(1)
    expect(formatLogicalSheetFrameTimecode(73, 73, 24)).toBe('0+1')
    expect(logicalSheetFrameNumber(sheet, 96)).toBe(24)
    expect(formatLogicalSheetFrameTimecode(96, 73, 24)).toBe('0+24')
    expect(logicalSheetFrameNumber(sheet, 97)).toBe(25)
    expect(formatLogicalSheetFrameTimecode(97, 73, 24)).toBe('1+1')
  })

  it('clips pre-roll events into XDTS frame zero when they carry into the cut', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', -11, 'action')
    const project = upsertBinding(created.project, { slotId: 'slot_A', keyId: created.key.keyId, cspCellName: 'A-pre', materialState: 'missing-ok' })
    const plan = buildExportPlan(withDirectExportProfile(project), { profileId: 'direct' })
    expect(plan.tracks[0].frames[0]).toEqual({ frame: 0, value: 'A-pre' })
  })

  it('does not export a pre-roll cycle that is cleared before the cut starts', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', -24, 'action')
    const bound = upsertBinding(created.project, { slotId: 'slot_A', keyId: created.key.keyId, cspCellName: 'A-pre', materialState: 'missing-ok' })
    const cleared = setEvent(bound, 'A', -1, NULL_CELL_KEY_ID, 'action')
    const plan = buildExportPlan(withDirectExportProfile(cleared), { profileId: 'direct' })
    expect(plan.tracks.find(track => track.slotId === 'slot_A')).toBeUndefined()
  })

  it('updates logical sheet duration for arbitrary cut lengths', () => {
    const project = updateLogicalSheetSettings(createDefaultProject(), { durationFrames: 168 })
    expect(project.logicalSheet.durationFrames).toBe(168)
    expect(buildExportPlan(withDirectExportProfile(project), { profileId: 'direct' }).durationFrames).toBe(168)
  })

  it('allows post-roll events inside the logical work range without extending XDTS duration', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 150, 'action')
    const project = updateLogicalSheetSettings(created.project, {
      workRange: {
        ...created.project.logicalSheet.workRange,
        postRollFrames: 12,
        showPostRoll: true,
      },
    })
    expect(validateProject(project).some(issue => issue.code === 'event.frame.afterDuration')).toBe(false)
    expect(buildExportPlan(withDirectExportProfile(project), { profileId: 'direct' }).durationFrames).toBe(144)
    expect(buildExportPlan(withDirectExportProfile(project), { profileId: 'direct' }).tracks.find(track => track.slotId === 'slot_A')).toBeUndefined()
  })

  it('creates same-name CSP slots for base and correction layers', () => {
    const project = createDefaultProject()
    const aSlots = project.cspTrackSlots.filter(slot => slot.paperTrack === 'A')
    expect(aSlots.map(slot => slot.xdtsName)).toEqual(['A', 'A', 'A', 'A', 'A', 'A'])
    expect(aSlots.map(slot => slot.displayPath)).toEqual(['作画/A', '演出/A', '監督/A', '作監/A', '料理/A', '総作監/A'])
  })

  it('updates editable correction layers while preserving matching slots and suffix normalization', () => {
    const first = createOrSetEvent(createDefaultProject(), 'A', 1, 'cell')
    let project = upsertBinding(first.project, { slotId: 'slot_A', keyId: first.key.keyId, cspCellName: 'A1', materialState: 'missing-ok' })
    const nextLayers = [
      { ...project.correctionLayers[0], label: '原画', fileNameSuffix: '' },
      { ...project.correctionLayers[1], label: '演出修正', fileNameSuffix: '_en' },
      { ...project.correctionLayers[3], order: 2, fileNameSuffix: '_sk' },
      { layerId: '', stageId: project.productionStages[0]?.stageId ?? 'stage_lo', label: '色指定', order: 3, role: 'correction' as const, defaultVisible: true, fileNameSuffix: '_iro' },
    ]

    project = updateCorrectionLayers(project, nextLayers)
    expect(project.correctionLayers.map(layer => [layer.layerId, layer.label, layer.order, layer.fileNameSuffix])).toEqual([
      ['layer_sakuga', '原画', 0, ''],
      ['layer_enshutsu', '演出修正', 1, '_en'],
      ['layer_sakkan', '作監', 2, '_sk'],
      ['layer_custom', '色指定', 3, '_iro'],
    ])
    expect(project.cspTrackSlots.filter(slot => slot.paperTrack === 'A').map(slot => [slot.slotId, slot.displayPath])).toEqual([
      ['slot_A', '原画/A'],
      ['slot_enshutsu_A', '演出修正/A'],
      ['slot_sakkan_A', '作監/A'],
      ['slot_custom_A', '色指定/A'],
    ])
    expect(project.bindings.find(binding => binding.slotId === 'slot_A')?.keyId).toBe(first.key.keyId)

    const second = createOrSetEvent(project, 'A', 2, 'cell')
    const withCorrection = upsertBinding(second.project, { slotId: 'slot_enshutsu_A', keyId: second.key.keyId, cspCellName: 'A2', materialState: 'missing-ok' })
    const plan = buildNameNormalizationPlan(withCorrection, { sheetRole: 'cell' })
    expect(plan.items.map(item => [item.slotId, item.nextCspCellName])).toEqual([
      ['slot_A', 'A_01'],
      ['slot_enshutsu_A', 'A_02_en'],
    ])
    expect(buildExportPlan(withCorrection, { profileId: 'import-stack', timingSourceRole: 'cell' }).tracks.map(track => track.name)).toContain('===== 演出修正 =====')
  })

  it('renames a production stage without changing its stable identity', () => {
    const project = createDefaultProject()
    const renamed = updateProductionStageLabel(project, 'stage_lo', '原画')

    expect(renamed.productionStages[0]).toMatchObject({ stageId: 'stage_lo', label: '原画' })
    expect(renamed.correctionLayers.every(layer => layer.stageId === 'stage_lo')).toBe(true)
    expect(() => updateProductionStageLabel(project, 'stage_lo', '  ')).toThrow('制作段階名は空にできません')
  })

  it('blocks deleting correction layers that still have registrations', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'cell')
    const project = upsertBinding(created.project, { slotId: 'slot_enshutsu_A', keyId: created.key.keyId, cspCellName: 'A1_e', materialState: 'missing-ok' })
    expect(() => updateCorrectionLayers(project, project.correctionLayers.filter(layer => layer.layerId !== 'layer_enshutsu'))).toThrow('使用中の工程')
  })

  it('creates projects from an arbitrary short paper track set', () => {
    const project = createProjectFromTrackLabels(['A', 'B', 'C', 'D', 'E'])
    expect(project.logicalSheet.paperTracks.map(track => track.paperTrack)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(project.cspTrackSlots).toHaveLength(30)
    expect(project.cspTrackSlots.some(slot => slot.paperTrack === 'F')).toBe(false)

    const created = createOrSetEvent(project, 'E', 1, 'action')
    const plan = buildExportPlan(withDirectExportProfile(created.project), { profileId: 'direct' })
    expect(plan.tracks.map(track => track.name)).toEqual(['E'])
  })

  it('creates projects with alphabetic labels beyond Z', () => {
    const labels = createAlphabeticTrackLabels(28)
    const project = createProjectFromTrackLabels(labels)
    expect(labels.slice(-2)).toEqual(['AA', 'AB'])
    expect(project.logicalSheet.paperTracks.at(-1)?.paperTrack).toBe('AB')

    const created = createOrSetEvent(project, 'AB', 12, 'action')
    let bound = upsertBinding(created.project, { slotId: 'slot_AB', keyId: created.key.keyId, cspCellName: 'AB1', materialState: 'missing-ok' })
    bound = upsertBinding(bound, { slotId: 'slot_enshutsu_AB', keyId: created.key.keyId, cspCellName: 'AB1演', materialState: 'missing-ok' })
    expect(bound.bindings.filter(binding => binding.keyId === created.key.keyId).map(binding => binding.cspCellName)).toEqual(['AB1', 'AB1演'])
  })

  it('rebuilds project tracks while preserving matching existing slots', () => {
    const renamed = updateProjectPaperTracks(updateProjectPaperTracks(createDefaultProject(), ['A', 'B', 'C', 'D', 'E']), ['A', 'B', 'C', 'D', 'E', 'AA'])
    expect(renamed.logicalSheet.paperTracks.map(track => track.paperTrack)).toEqual(['A', 'B', 'C', 'D', 'E', 'AA'])
    expect(renamed.cspTrackSlots.find(slot => slot.paperTrack === 'A')?.slotId).toBe('slot_A')
    expect(renamed.cspTrackSlots.filter(slot => slot.paperTrack === 'AA').map(slot => slot.slotId)).toEqual(['slot_AA', 'slot_enshutsu_AA', 'slot_kantoku_AA', 'slot_sakkan_AA', 'slot_ryouri_AA', 'slot_sousakkan_AA'])
    expect(renamed.exportProfiles.every(profile => profile.slotIds.length === renamed.cspTrackSlots.length)).toBe(true)
  })

  it('reprojects templates without changing logical tracks, lanes, cues, or FPS', () => {
    const added = addOverlayPaperTrack(createDefaultProject(), {
      paperTrack: 'J',
      insertAfterPaperTrack: 'I',
      snapIndex: 10,
      sheetRole: 'cell',
    }).project
    const withCell = createOrSetEvent(added, 'J', 12, 'cell').project
    const withSound = createTimedRangeCue(withCell, {
      role: 'sound', laneId: 'sound_lane_4', frameStart: 4, frameEnd: 18, label: 'SE',
    }).project
    const source = { ...withSound, logicalSheet: { ...withSound.logicalSheet, fps: 30 } }
    const logicalSheet = structuredClone(source.logicalSheet)
    const timedRangeCues = structuredClone(source.timedRangeCues)

    const digital = reprojectProjectToTemplate(source, digitalStandardSheetTemplate, {
      studioPresetId: 'digital-standard',
      resetSheetView: true,
    })
    const paper = reprojectProjectToTemplate(digital, standardA3SheetTemplate, {
      studioPresetId: 'standard-a3-default',
      resetSheetView: true,
    })

    expect(digital.logicalSheet).toEqual(logicalSheet)
    expect(digital.timedRangeCues).toEqual(timedRangeCues)
    expect(digital.sheetTemplateId).toBe(digitalStandardSheetTemplate.templateId)
    expect(paper.logicalSheet).toEqual(logicalSheet)
    expect(paper.timedRangeCues).toEqual(timedRangeCues)
    expect(paper.sheetTemplateId).toBe(standardA3SheetTemplate.templateId)
  })

  it('adds overlay paper tracks with independent view and export placement', () => {
    const c = createOrSetEvent(createDefaultProject(), 'C', 1, 'action')
    const d = createOrSetEvent(c.project, 'D', 1, 'action')
    const added = addOverlayPaperTrack(d.project, { paperTrack: 'J', insertAfterPaperTrack: 'C', snapIndex: 18, sheetRole: 'action' })
    const j = createOrSetEvent(added.project, 'J', 1, 'action')
    expect(j.project.logicalSheet.paperTracks.map(track => [track.paperTrack, track.source ?? 'template', track.viewPlacement?.snapIndex ?? null])).toContainEqual(['J', 'overlay', 18])

    const plan = buildExportPlan(j.project, { profileId: 'import-stack' })
    expect(plan.tracks.map(track => track.name)).toEqual([
      '===== XSHEET IMPORT START =====',
      '===== 作画 =====',
      'C',
      'J',
      'D',
      '===== XSHEET IMPORT END =====',
    ])
  })

  it('renames overlay paper tracks while preserving events and slots', () => {
    const added = addOverlayPaperTrack(createDefaultProject(), { paperTrack: 'J', insertAfterPaperTrack: 'C', snapIndex: 4 })
    const created = createOrSetEvent(added.project, 'J', 12, 'cell')
    const bound = upsertBinding(created.project, { slotId: 'slot_J', keyId: created.key.keyId, cspCellName: 'J_01', materialState: 'missing-ok' })
    const renamed = updatePaperTrack(bound, 'J', { paperTrack: 'K', label: 'K' })
    expect(renamed.logicalSheet.keys.find(key => key.keyId === created.key.keyId)?.paperTrack).toBe('K')
    expect(renamed.logicalSheet.events.find(event => event.keyId === created.key.keyId)?.paperTrack).toBe('K')
    expect(renamed.cspTrackSlots.filter(slot => slot.paperTrack === 'K').map(slot => slot.xdtsName)).toEqual(['K', 'K', 'K', 'K', 'K', 'K'])
    expect(renamed.bindings.find(binding => binding.keyId === created.key.keyId)?.slotId).toBe('slot_J')
  })

  it('deletes overlay paper tracks without deleting template tracks or stack guide labels', () => {
    const added = addOverlayPaperTrack(createDefaultProject(), { paperTrack: 'J', insertAfterPaperTrack: 'C', snapIndex: 4 })
    const overlayEvent = createOrSetEvent(added.project, 'J', 12, 'cell')
    const templateEvent = createOrSetEvent(overlayEvent.project, 'A', 12, 'cell')
    let project = upsertBinding(templateEvent.project, { slotId: 'slot_J', keyId: overlayEvent.key.keyId, cspCellName: 'J_01', materialState: 'missing-ok' })
    project = upsertBinding(project, { slotId: 'slot_A', keyId: templateEvent.key.keyId, cspCellName: 'A_01', materialState: 'missing-ok' })
    project = createStackGuideLabel(project, { label: 'BG', gapIndex: 1, insertAfterPaperTrack: 'J', displayRole: 'cell' }).project

    const deleted = deleteOverlayPaperTrack(project, 'J')

    expect(deleted.logicalSheet.paperTracks.some(track => track.paperTrack === 'J')).toBe(false)
    expect(deleted.cspTrackSlots.some(slot => slot.paperTrack === 'J')).toBe(false)
    expect(deleted.logicalSheet.keys.some(key => key.keyId === overlayEvent.key.keyId)).toBe(false)
    expect(deleted.logicalSheet.events.some(event => event.paperTrack === 'J' || event.keyId === overlayEvent.key.keyId)).toBe(false)
    expect(deleted.bindings.some(binding => binding.keyId === overlayEvent.key.keyId)).toBe(false)
    expect(deleted.logicalSheet.keys.find(key => key.keyId === templateEvent.key.keyId)?.paperTrack).toBe('A')
    expect(deleted.logicalSheet.events.find(event => event.keyId === templateEvent.key.keyId)?.paperTrack).toBe('A')
    expect(deleted.bindings.find(binding => binding.keyId === templateEvent.key.keyId)?.slotId).toBe('slot_A')
    expect(deleted.stackGuideLabels.map(label => label.label)).toEqual(['BG'])
    expect(() => deleteOverlayPaperTrack(deleted, 'A')).toThrow(/not an overlay track/)
  })

  it('keeps the bundled template underlay separate from imported sheet sources', () => {
    const project = createDefaultProject()
    expect(standardA3SheetTemplate.defaultUnderlay).toMatchObject({
      sourceId: 'sheet_source_standard_a3_default_underlay',
      imageRef: { assetPath: 'templates/standard-a3/timesheet.png' },
    })
    expect(standardA3SheetTemplate.style?.bgBookLabel).toMatchObject({
      labelHeightMm: 2.37,
      fontSizePt: 5.04,
      laneGapMm: 1.35,
    })
    expect(standardA3SheetTemplate.style?.gridHeader).toMatchObject({
      labelOverrides: {
        sound: '',
      },
    })
    expect(standardA3SheetTemplate.style?.secondCounter).toEqual({ visible: true })
    expect(standardA3SheetTemplate.style?.bottomTrackLabels).toEqual({ visible: true })
    expect(project.sheetView.sources).toEqual([])
    expect(project.sheetView.pages[0].sourceId).toBeUndefined()
  })

  it('updates generated bindings when a key label changes', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    let project = upsertBinding(created.project, { slotId: 'slot_A', keyId: created.key.keyId, cspCellName: 'A1', materialState: 'missing-ok' })
    project = upsertBinding(project, { slotId: 'slot_enshutsu_A', keyId: created.key.keyId, cspCellName: 'A1', materialState: 'missing-ok' })
    const updated = updateKey(project, created.key.keyId, { displayLabel: '1.5' })
    expect(updated.bindings.filter(binding => binding.keyId === created.key.keyId).map(binding => binding.cspCellName)).toEqual(['A1.5', 'A1.5'])
  })

  it('moves a key binding to another correction layer while preserving material data', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const asset = registerAsset(created.project, { name: 'A1.png', size: 100, lastModified: 1, path: 'D:\\cut\\A1.png' }, { role: 'cell-material' })
    const bound = upsertBinding(asset.project, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      cspCellName: 'A1_custom',
      assetId: asset.asset.assetId,
      materialState: 'assigned',
    })

    const moved = moveBindingToCorrectionLayer(bound, {
      keyId: created.key.keyId,
      sourceSlotId: 'slot_A',
      targetCorrectionLayerId: 'layer_enshutsu',
    })

    expect(moved.bindings.find(binding => binding.slotId === 'slot_A' && binding.keyId === created.key.keyId)).toBeUndefined()
    expect(moved.bindings.find(binding => binding.slotId === 'slot_enshutsu_A' && binding.keyId === created.key.keyId)).toMatchObject({
      cspCellName: 'A1_custom',
      assetId: asset.asset.assetId,
      materialState: 'assigned',
    })
  })

  it('registers multiple assets as unplaced cards in source order and skips duplicates in the same CSP track', () => {
    const firstAsset = registerAsset(createDefaultProject(), { name: 'A1.png', size: 100, lastModified: 1 }, { role: 'cell-material' })
    const secondAsset = registerAsset(firstAsset.project, { name: 'A2.png', size: 101, lastModified: 2 }, { role: 'cell-material' })

    const registered = registerAssetsToCspTrack(secondAsset.project, {
      slotId: 'slot_A',
      assetIds: [firstAsset.asset.assetId, secondAsset.asset.assetId, firstAsset.asset.assetId],
    })

    expect(registered.addedKeyIds).toHaveLength(2)
    expect(registered.duplicateKeyIds).toEqual([])
    expect(registered.project.logicalSheet.events).toEqual([])
    expect(registered.project.bindings.filter(binding => binding.slotId === 'slot_A').map(binding => binding.assetId))
      .toEqual([firstAsset.asset.assetId, secondAsset.asset.assetId])
    expect(registered.project.logicalSheet.keys.filter(key => registered.addedKeyIds.includes(key.keyId)).map(key => key.displayLabel))
      .toEqual(['', ''])
    expect(registered.project.logicalSheet.keys.filter(key => registered.addedKeyIds.includes(key.keyId)).map(key => key.sheetRole))
      .toEqual([undefined, undefined])

    const repeated = registerAssetsToCspTrack(registered.project, {
      slotId: 'slot_A',
      assetIds: [secondAsset.asset.assetId],
    })
    expect(repeated.addedKeyIds).toEqual([])
    expect(repeated.duplicateKeyIds).toEqual([registered.addedKeyIds[1]])
    expect(repeated.project.bindings).toHaveLength(registered.project.bindings.length)
  })

  it('creates an unplaced CSP card without a sheet label, event, or material', () => {
    const project = createDefaultProject()

    expect(suggestUnplacedCspCellName(project, 'slot_enshutsu_A', 'action')).toBe('A_01_e')
    const created = createUnplacedCspCard(project, {
      slotId: 'slot_enshutsu_A',
      cspCellName: 'A_01_e',
      sheetRole: 'action',
    })

    expect(created.key).toMatchObject({ paperTrack: 'A', displayLabel: '', paperToken: '', createdFrom: 'manual' })
    expect(created.binding).toMatchObject({
      slotId: 'slot_enshutsu_A',
      keyId: created.key.keyId,
      cspCellName: 'A_01_e',
      materialState: 'unassigned',
    })
    expect(created.binding.assetId).toBeUndefined()
    expect(created.project.logicalSheet.events).toEqual([])
    expect(suggestUnplacedCspCellName(created.project, 'slot_enshutsu_A', 'action')).toBe('A_02_e')
    expect(() => createUnplacedCspCard(created.project, {
      slotId: 'slot_enshutsu_A',
      cspCellName: 'a_01_E',
      sheetRole: 'action',
    })).toThrow('CSP cell name already exists')
  })

  it('keeps process cards unlinked even when the same asset is registered in another correction layer', () => {
    const asset = registerAsset(createDefaultProject(), { name: 'A1.png', size: 100, lastModified: 1 }, { role: 'cell-material' })
    const sakuga = registerAssetsToCspTrack(asset.project, { slotId: 'slot_A', assetIds: [asset.asset.assetId] })
    const enshutsu = registerAssetsToCspTrack(sakuga.project, { slotId: 'slot_enshutsu_A', assetIds: [asset.asset.assetId] })

    expect(enshutsu.addedKeyIds).toHaveLength(1)
    expect(enshutsu.addedKeyIds[0]).not.toBe(sakuga.addedKeyIds[0])
    expect(enshutsu.project.logicalSheet.keys.map(key => key.displayLabel)).toEqual(['', ''])
    expect(enshutsu.project.bindings.map(binding => [binding.slotId, binding.keyId])).toEqual([
      ['slot_A', sakuga.addedKeyIds[0]],
      ['slot_enshutsu_A', enshutsu.addedKeyIds[0]],
    ])
  })

  it('merges a process-specific key into the existing logical cell when its sheet label is corrected', () => {
    const base = createKey(createDefaultProject(), 'A', '1', 'asset-drop', undefined, 'action')
    const correction = createKey(base.project, 'A', '6', 'asset-drop', undefined, 'action')
    let project = upsertBinding(correction.project, { slotId: 'slot_A', keyId: base.key.keyId, cspCellName: 'A1', materialState: 'assigned', assetId: 'asset_base' })
    project = upsertBinding(project, { slotId: 'slot_enshutsu_A', keyId: correction.key.keyId, cspCellName: 'A1_e', materialState: 'assigned', assetId: 'asset_correction' })
    project = setEvent(project, 'A', 1, correction.key.keyId, 'action')

    const merged = updateOrMergeTimingKeyDisplayLabel(project, correction.key.keyId, '1')

    expect(merged).toMatchObject({ keyId: base.key.keyId, merged: true })
    expect(merged.project.logicalSheet.keys.map(key => [key.keyId, key.displayLabel])).toEqual([[base.key.keyId, '1']])
    expect(merged.project.logicalSheet.events[0]?.keyId).toBe(base.key.keyId)
    expect(merged.project.bindings.map(binding => [binding.slotId, binding.keyId])).toEqual([
      ['slot_A', base.key.keyId],
      ['slot_enshutsu_A', base.key.keyId],
    ])
  })

  it('removes only one process binding and prunes an otherwise unused logical cell', () => {
    const asset = registerAsset(createDefaultProject(), { name: 'A1.png', size: 100, lastModified: 1 }, { role: 'cell-material' })
    const base = registerAssetsToCspTrack(asset.project, { slotId: 'slot_A', assetIds: [asset.asset.assetId] })
    const correction = registerAssetsToCspTrack(base.project, { slotId: 'slot_enshutsu_A', assetIds: [asset.asset.assetId] })
    const correctionBinding = correction.project.bindings.find(binding => binding.slotId === 'slot_enshutsu_A')!
    const withoutCorrection = removeCellBinding(correction.project, correctionBinding.bindingId)

    expect(withoutCorrection.logicalSheet.keys).toHaveLength(1)
    expect(withoutCorrection.bindings.map(binding => binding.slotId)).toEqual(['slot_A'])

    const baseBinding = withoutCorrection.bindings[0]!
    const withoutLastBinding = removeCellBinding(withoutCorrection, baseBinding.bindingId)
    expect(withoutLastBinding.logicalSheet.keys).toEqual([])
    expect(withoutLastBinding.bindings).toEqual([])
  })

  it('requires overwrite when moving a binding into an occupied correction layer', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    let project = upsertBinding(created.project, { slotId: 'slot_A', keyId: created.key.keyId, cspCellName: 'A1', materialState: 'assigned', assetId: 'asset_base' })
    project = upsertBinding(project, { slotId: 'slot_enshutsu_A', keyId: created.key.keyId, cspCellName: 'A1_e', materialState: 'assigned', assetId: 'asset_enshutsu' })

    expect(() => moveBindingToCorrectionLayer(project, {
      keyId: created.key.keyId,
      sourceSlotId: 'slot_A',
      targetCorrectionLayerId: 'layer_enshutsu',
    })).toThrow(/target binding already exists/)

    const overwritten = moveBindingToCorrectionLayer(project, {
      keyId: created.key.keyId,
      sourceSlotId: 'slot_A',
      targetCorrectionLayerId: 'layer_enshutsu',
      overwrite: true,
    })
    expect(overwritten.bindings).toHaveLength(1)
    expect(overwritten.bindings[0]).toMatchObject({
      slotId: 'slot_enshutsu_A',
      cspCellName: 'A1',
      assetId: 'asset_base',
    })
  })

  it('keeps import stack output limited to populated process slots', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const plan = buildExportPlan(created.project, { profileId: 'import-stack' })
    expect(plan.tracks.map(track => ({ name: track.name, dummy: track.dummy ?? false, slotId: track.slotId }))).toEqual([
      { name: '===== XSHEET IMPORT START =====', dummy: true, slotId: undefined },
      { name: '===== 作画 =====', dummy: true, slotId: undefined },
      { name: 'A', dummy: false, slotId: 'slot_A' },
      { name: '===== XSHEET IMPORT END =====', dummy: true, slotId: undefined },
    ])
    expect(plan.cspInstructions.map(instruction => instruction.message).join('\n')).toContain('同名アニメーションフォルダー')
    expect(plan.cspInstructions.map(instruction => instruction.message).join('\n')).toContain('非表示')
    expect(plan.cspInstructions.every(instruction => instruction.level === 'info')).toBe(true)
  })

  it('exports import stack tracks by process while keeping animation folder names unchanged', () => {
    const first = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const second = createOrSetEvent(first.project, 'A', 5, 'action')
    let project = upsertBinding(second.project, { slotId: 'slot_A', keyId: first.key.keyId, cspCellName: 'A3', materialState: 'assigned', assetId: 'asset_sakuga_a3' })
    project = upsertBinding(project, { slotId: 'slot_enshutsu_A', keyId: second.key.keyId, cspCellName: 'A4_e', materialState: 'assigned', assetId: 'asset_enshutsu_a4' })
    project = {
      ...project,
      assets: [
        { assetId: 'asset_sakuga_a3', binId: 'asset_bin_root', originalFileName: 'A3.jpg', displayName: 'A3.jpg', role: 'cell-material', source: { kind: 'unresolved' } },
        { assetId: 'asset_enshutsu_a4', binId: 'asset_bin_root', originalFileName: 'A4_e.jpg', displayName: 'A4_e.jpg', role: 'cell-material', source: { kind: 'unresolved' } },
      ],
    }

    const plan = buildExportPlan(project, { profileId: 'import-stack' })
    expect(plan.tracks.map(track => [track.trackNo, track.name, track.slotId ?? null, track.dummy ?? false])).toEqual([
      [0, '===== XSHEET IMPORT START =====', null, true],
      [1, '===== 作画 =====', null, true],
      [2, 'A', 'slot_A', false],
      [3, '===== 演出 =====', null, true],
      [4, 'A', 'slot_enshutsu_A', false],
      [5, '===== XSHEET IMPORT END =====', null, true],
    ])
    expect(plan.tracks.find(track => track.slotId === 'slot_A')?.frames).toEqual([
      { frame: 0, value: 'A3' },
      { frame: 4, value: null },
    ])
    expect(plan.tracks.find(track => track.slotId === 'slot_enshutsu_A')?.frames).toEqual([
      { frame: 4, value: 'A4_e' },
    ])
  })

  it('inserts static stack guide labels between cell tracks in import stack output', () => {
    const c = createOrSetEvent(createDefaultProject(), 'C', 1, 'action')
    const d = createOrSetEvent(c.project, 'D', 1, 'action')
    const book23 = createStackGuideLabel(d.project, {
      label: 'BOOK2,3',
      gapIndex: 3,
      insertAfterPaperTrack: 'C',
    })
    const book4 = createStackGuideLabel(book23.project, {
      label: 'BOOK4',
      gapIndex: 3,
      insertAfterPaperTrack: 'C',
    })
    const customized = updateStackGuideLabel(book4.project, book4.label.labelId, { cspCellName: 'BOOK4_CELL' })
    const plan = buildExportPlan(customized, { profileId: 'import-stack' })

    expect(plan.tracks.map(track => [track.name, track.slotId ?? null, track.stackGuideLabelId ?? null, track.dummy ?? false])).toEqual([
      ['===== XSHEET IMPORT START =====', null, null, true],
      ['===== 作画 =====', null, null, true],
      ['C', 'slot_C', null, false],
      ['BOOK2,3', null, book23.label.labelId, false],
      ['BOOK4', null, book4.label.labelId, false],
      ['D', 'slot_D', null, false],
      ['===== XSHEET IMPORT END =====', null, null, true],
    ])
    expect(plan.tracks.find(track => track.stackGuideLabelId === book23.label.labelId)?.frames).toEqual([{ frame: 0, value: 'BOOK2,3' }])
    expect(plan.tracks.find(track => track.stackGuideLabelId === book4.label.labelId)?.frames).toEqual([{ frame: 0, value: 'BOOK4_CELL' }])
  })

  it('exports auxiliary tracks even when legacy data has static-cell export disabled', () => {
    const legacyBg = createStackGuideLabel(createDefaultProject(), {
      label: 'BG',
      gapIndex: 1,
      insertAfterPaperTrack: 'A',
      exportAsStaticCell: false,
    })
    const plan = buildExportPlan(legacyBg.project, { profileId: 'import-stack' })

    expect(plan.tracks.find(track => track.stackGuideLabelId === legacyBg.label.labelId)).toMatchObject({
      name: 'BG',
      frames: [{ frame: 0, value: 'BG' }],
    })
  })

  it('exports auxiliary static tracks per correction layer with fixed upper bands', () => {
    const a1 = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const a2 = createOrSetEvent(a1.project, 'A', 2, 'action')
    const bg = createStackGuideLabel(a2.project, { label: 'BG', gapIndex: 1, insertAfterPaperTrack: 'A' })
    const sl = createStackGuideLabel(bg.project, { label: 'SL1', kind: 'camera-note', gapIndex: 9, correctionLayerId: 'layer_enshutsu' })
    const memo = createStackGuideLabel(sl.project, { label: 'MEMO1', kind: 'memo', gapIndex: 9, correctionLayerId: 'layer_enshutsu' })
    const sakugaBgAsset = registerAsset(memo.project, { name: 'bg_layout.png', size: 100, lastModified: 1 }, { role: 'cell-material' })
    const enshutsuBgAsset = registerAsset(sakugaBgAsset.project, { name: 'bg_fix_e.png', size: 100, lastModified: 1 }, { role: 'cell-material' })
    const slAsset = registerAsset(enshutsuBgAsset.project, { name: 'sl_reference.png', size: 100, lastModified: 1 }, { role: 'cell-material' })
    let project = assignAssetToStackGuideLabel(slAsset.project, bg.label.labelId, sakugaBgAsset.asset.assetId, 'layer_sakuga')
    project = assignAssetToStackGuideLabel(project, bg.label.labelId, enshutsuBgAsset.asset.assetId, 'layer_enshutsu')
    project = assignAssetToStackGuideLabel(project, sl.label.labelId, slAsset.asset.assetId, 'layer_enshutsu')

    const plan = buildExportPlan(project, { profileId: 'import-stack' })
    expect(plan.tracks.map(track => [
      track.name,
      track.slotId ?? null,
      track.stackGuideLabelId ?? null,
      track.stackGuideRegistrationId ?? null,
      track.frames,
    ])).toEqual([
      ['===== XSHEET IMPORT START =====', null, null, null, [{ frame: 0, value: null }]],
      ['===== 作画 =====', null, null, null, [{ frame: 0, value: null }]],
      ['A', 'slot_A', null, null, [{ frame: 0, value: 'A1' }, { frame: 1, value: 'A2' }]],
      ['BG', null, bg.label.labelId, 'stack_reg_0001', [{ frame: 0, value: 'bg_layout' }]],
      ['===== 演出 =====', null, null, null, [{ frame: 0, value: null }]],
      ['BG', null, bg.label.labelId, 'stack_reg_0002', [{ frame: 0, value: 'bg_fix_e' }]],
      ['SL1', null, sl.label.labelId, 'stack_reg_0001', [{ frame: 0, value: 'sl_reference' }]],
      ['MEMO1', null, memo.label.labelId, 'stack_reg_0001', [{ frame: 0, value: 'MEMO1' }]],
      ['===== XSHEET IMPORT END =====', null, null, null, [{ frame: 0, value: null }]],
    ])
  })

  it('exports an auxiliary-only correction layer group without matching cell slots', () => {
    const base = createDefaultProject()
    const projectWithoutSakkanSlots = {
      ...base,
      cspTrackSlots: base.cspTrackSlots.filter(slot => slot.correctionLayerId !== 'layer_sakkan'),
    }
    const bg = createStackGuideLabel(projectWithoutSakkanSlots, {
      label: 'BG2',
      gapIndex: 1,
      insertAfterPaperTrack: 'A',
      correctionLayerId: 'layer_sakkan',
    })
    const asset = registerAsset(bg.project, { name: 'bg2_sakkan.png', size: 100, lastModified: 1 }, { role: 'cell-material' })
    const project = assignAssetToStackGuideLabel(asset.project, bg.label.labelId, asset.asset.assetId, 'layer_sakkan')

    const plan = buildExportPlan(project, { profileId: 'import-stack' })
    expect(plan.tracks.map(track => [track.name, track.slotId ?? null, track.stackGuideLabelId ?? null, track.frames])).toEqual([
      ['===== XSHEET IMPORT START =====', null, null, [{ frame: 0, value: null }]],
      ['===== 作監 =====', null, null, [{ frame: 0, value: null }]],
      ['BG2', null, bg.label.labelId, [{ frame: 0, value: 'bg2_sakkan' }]],
      ['===== XSHEET IMPORT END =====', null, null, [{ frame: 0, value: null }]],
    ])
  })

  it('normalizes auxiliary track CSP cell names and material filenames per correction layer', () => {
    const bg = createStackGuideLabel(createDefaultProject(), { label: 'BG', gapIndex: 1, insertAfterPaperTrack: 'A' })
    const sl = createStackGuideLabel(bg.project, { label: 'SL1', kind: 'camera-note', correctionLayerId: 'layer_enshutsu', gapIndex: 9 })
    const sakugaBgAsset = registerAsset(sl.project, { name: 'bg_layout.png', size: 100, lastModified: 1, path: 'D:\\cut\\bg_layout.png' }, { role: 'cell-material' })
    const enshutsuBgAsset = registerAsset(sakugaBgAsset.project, { name: 'bg_fix_e.png', size: 100, lastModified: 1, path: 'D:\\cut\\bg_fix_e.png' }, { role: 'cell-material' })
    const slAsset = registerAsset(enshutsuBgAsset.project, { name: 'slide_fix.png', size: 100, lastModified: 1, path: 'D:\\cut\\slide_fix.png' }, { role: 'cell-material' })
    let project = assignAssetToStackGuideLabel(slAsset.project, bg.label.labelId, sakugaBgAsset.asset.assetId, 'layer_sakuga')
    project = assignAssetToStackGuideLabel(project, bg.label.labelId, enshutsuBgAsset.asset.assetId, 'layer_enshutsu')
    project = assignAssetToStackGuideLabel(project, sl.label.labelId, slAsset.asset.assetId, 'layer_enshutsu')

    const plan = buildNameNormalizationPlan(project, { sheetRole: 'action', includeStackGuides: true, includeAssetFiles: true })
    expect(plan.items.map(item => [item.targetType, item.paperTrack, item.processLabel, item.currentCspCellName, item.nextCspCellName])).toEqual([
      ['stack-guide', 'BG', '作画', 'bg_layout', 'BG_01'],
      ['stack-guide', 'BG', '演出', 'bg_fix_e', 'BG_01_e'],
      ['stack-guide', 'SL1', '演出', 'slide_fix', 'SL1_01_e'],
    ])
    expect(plan.assetRenames.map(rename => [rename.currentFileName, rename.nextFileName])).toEqual([
      ['bg_fix_e.png', 'BG_01_e.png'],
      ['bg_layout.png', 'BG_01.png'],
      ['slide_fix.png', 'SL1_01_e.png'],
    ])

    const enshutsuOnly = buildNameNormalizationPlan(project, {
      sheetRole: 'action',
      correctionLayerIds: ['layer_enshutsu'],
      includeStackGuides: true,
      includeAssetFiles: true,
    })
    expect(enshutsuOnly.items.map(item => [item.paperTrack, item.processLabel])).toEqual([
      ['BG', '演出'],
      ['SL1', '演出'],
    ])
    expect(enshutsuOnly.assetRenames.map(rename => rename.currentFileName)).toEqual(['bg_fix_e.png', 'slide_fix.png'])

    const applied = applyNameNormalizationPlan(project, plan, plan.assetRenames.map(rename => ({
      assetId: rename.assetId,
      renamed: true,
      nextPath: rename.nextPath,
      nextFileName: rename.nextFileName,
    })))
    const appliedPlan = buildNameNormalizationPlan(applied, { sheetRole: 'action', includeStackGuides: true })
    expect(appliedPlan.items.map(item => [item.paperTrack, item.processLabel, item.currentCspCellName])).toEqual([
      ['BG', '作画', 'BG_01'],
      ['BG', '演出', 'BG_01_e'],
      ['SL1', '演出', 'SL1_01_e'],
    ])
    expect(applied.assets.map(asset => asset.displayName).sort()).toEqual(['BG_01.png', 'BG_01_e.png', 'SL1_01_e.png'])
  })

  it('normalizes registered cells, overlay cells, BG/BOOK, camera notes, memo notes, and material filenames together', () => {
    const overlay = addOverlayPaperTrack(createDefaultProject(), { paperTrack: 'J', insertAfterPaperTrack: 'A', snapIndex: 1, sheetRole: 'action' })
    const a = createOrSetEvent(overlay.project, 'A', 1, 'action')
    const j = createOrSetEvent(a.project, 'J', 2, 'action')
    const bg = createStackGuideLabel(j.project, { label: 'BG', kind: 'background', gapIndex: 1, insertAfterPaperTrack: 'A' })
    const book = createStackGuideLabel(bg.project, { label: 'BOOK1', kind: 'book', gapIndex: 2, insertAfterPaperTrack: 'A' })
    const camera = createStackGuideLabel(book.project, { label: 'SL1', kind: 'camera-note', correctionLayerId: 'layer_enshutsu', gapIndex: 9 })
    const memo = createStackGuideLabel(camera.project, { label: 'MEMO1', kind: 'memo', correctionLayerId: 'layer_sakkan', gapIndex: 10 })

    const aAsset = registerAsset(memo.project, { name: 'a_old.png', size: 100, lastModified: 1, path: 'D:\\cut\\a_old.png' }, { role: 'cell-material' })
    const jAsset = registerAsset(aAsset.project, { name: 'j_old.png', size: 101, lastModified: 2, path: 'D:\\cut\\j_old.png' }, { role: 'cell-material' })
    const bgAsset = registerAsset(jAsset.project, { name: 'bg_old.png', size: 102, lastModified: 3, path: 'D:\\cut\\bg_old.png' }, { role: 'cell-material' })
    const bookAsset = registerAsset(bgAsset.project, { name: 'book_old.png', size: 103, lastModified: 4, path: 'D:\\cut\\book_old.png' }, { role: 'cell-material' })
    const cameraAsset = registerAsset(bookAsset.project, { name: 'camera_old.png', size: 104, lastModified: 5, path: 'D:\\cut\\camera_old.png' }, { role: 'cell-material' })
    const memoAsset = registerAsset(cameraAsset.project, { name: 'memo_old.png', size: 105, lastModified: 6, path: 'D:\\cut\\memo_old.png' }, { role: 'cell-material' })
    let project = upsertBinding(memoAsset.project, { slotId: 'slot_A', keyId: a.key.keyId, cspCellName: 'a_old', materialState: 'assigned', assetId: aAsset.asset.assetId })
    project = upsertBinding(project, { slotId: 'slot_J', keyId: j.key.keyId, cspCellName: 'j_old', materialState: 'assigned', assetId: jAsset.asset.assetId })
    project = assignAssetToStackGuideLabel(project, bg.label.labelId, bgAsset.asset.assetId, 'layer_sakuga')
    project = assignAssetToStackGuideLabel(project, book.label.labelId, bookAsset.asset.assetId, 'layer_sakuga')
    project = assignAssetToStackGuideLabel(project, camera.label.labelId, cameraAsset.asset.assetId, 'layer_enshutsu')
    project = assignAssetToStackGuideLabel(project, memo.label.labelId, memoAsset.asset.assetId, 'layer_sakkan')

    const plan = buildNameNormalizationPlan(project, { sheetRole: 'action', includeStackGuides: true, includeAssetFiles: true })
    expect(plan.items.map(item => [item.targetType ?? 'binding', item.paperTrack, item.processLabel, item.currentCspCellName, item.nextCspCellName])).toEqual(expect.arrayContaining([
      ['binding', 'A', '作画', 'a_old', 'A_01'],
      ['binding', 'J', '作画', 'j_old', 'J_01'],
      ['stack-guide', 'BG', '作画', 'bg_old', 'BG_01'],
      ['stack-guide', 'BOOK1', '作画', 'book_old', 'BOOK1_01'],
      ['stack-guide', 'SL1', '演出', 'camera_old', 'SL1_01_e'],
      ['stack-guide', 'MEMO1', '作監', 'memo_old', 'MEMO1_01_s'],
    ]))
    expect(plan.assetRenames.map(rename => [rename.currentFileName, rename.nextFileName, rename.canRename])).toEqual([
      ['a_old.png', 'A_01.png', true],
      ['bg_old.png', 'BG_01.png', true],
      ['book_old.png', 'BOOK1_01.png', true],
      ['camera_old.png', 'SL1_01_e.png', true],
      ['j_old.png', 'J_01.png', true],
      ['memo_old.png', 'MEMO1_01_s.png', true],
    ])

    const applied = applyNameNormalizationPlan(project, plan, plan.assetRenames.map(rename => ({
      assetId: rename.assetId,
      renamed: true,
      nextPath: rename.nextPath,
      nextFileName: rename.nextFileName,
    })))
    expect(applied.bindings.map(binding => [binding.slotId, binding.cspCellName])).toEqual(expect.arrayContaining([
      ['slot_A', 'A_01'],
      ['slot_J', 'J_01'],
    ]))
    const appliedPlan = buildNameNormalizationPlan(applied, { sheetRole: 'action', includeStackGuides: true, includeAssetFiles: true })
    expect(appliedPlan.items.every(item => !item.cspCellNameChanged)).toBe(true)
    expect(applied.assets.map(asset => asset.displayName).sort()).toEqual([
      'A_01.png',
      'BG_01.png',
      'BOOK1_01.png',
      'J_01.png',
      'MEMO1_01_s.png',
      'SL1_01_e.png',
    ])
  })

  it('exports canonical AE keyframe data from a target slot', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const text = buildAeRemapText(created.project, 'slot_A')
    expect(text).toContain('Adobe After Effects 9.0 Keyframe Data')
    expect(text).toContain('Time Remap\r\n\tFrame\tseconds\t')
    expect(text).toContain('\r\n\t0\t0\t\r\n')
  })

  it('plans CSP and material filename normalization with process suffixes and densest-column ownership', () => {
    const firstA = createOrSetEvent(createDefaultProject(), 'A', 1, 'cell')
    const secondA = createOrSetEvent(firstA.project, 'A', 12, 'cell')
    const firstB = createOrSetEvent(secondA.project, 'B', 1, 'cell')
    const shared = registerAsset(firstB.project, { name: 'rough.png', size: 100, lastModified: 1, path: 'D:\\cut\\rough.png' }, { role: 'cell-material' })
    const enshutsu = registerAsset(shared.project, { name: 'rough_e.png', size: 101, lastModified: 2, path: 'D:\\cut\\rough_e.png' }, { role: 'cell-material' })
    let project = upsertBinding(enshutsu.project, { slotId: 'slot_A', keyId: firstA.key.keyId, cspCellName: 'rough_A', materialState: 'assigned', assetId: shared.asset.assetId })
    project = upsertBinding(project, { slotId: 'slot_B', keyId: firstB.key.keyId, cspCellName: 'rough_B', materialState: 'assigned', assetId: shared.asset.assetId })
    project = upsertBinding(project, { slotId: 'slot_enshutsu_A', keyId: secondA.key.keyId, cspCellName: 'rough_E', materialState: 'assigned', assetId: enshutsu.asset.assetId })

    const plan = buildNameNormalizationPlan(project, { sheetRole: 'cell', includeAssetFiles: true })
    expect(plan.items.map(item => [item.slotId, item.nextCspCellName])).toEqual([
      ['slot_A', 'A_01'],
      ['slot_enshutsu_A', 'A_02_e'],
      ['slot_B', 'B_01'],
    ])
    expect(plan.assetRenames.find(rename => rename.assetId === shared.asset.assetId)).toMatchObject({
      currentFileName: 'rough.png',
      nextFileName: 'A_01.png',
      representativePaperTrack: 'A',
      representativeReason: 'A列 2件',
      canRename: true,
    })
    expect(plan.assetRenames.find(rename => rename.assetId === shared.asset.assetId)?.warnings[0]).toContain('A_01')

    const applied = applyNameNormalizationPlan(project, plan, [{
      assetId: shared.asset.assetId,
      renamed: true,
      nextPath: 'D:\\cut\\A_01.png',
      nextFileName: 'A_01.png',
    }])
    expect(applied.bindings.map(binding => [binding.slotId, binding.cspCellName])).toEqual([
      ['slot_A', 'A_01'],
      ['slot_B', 'B_01'],
      ['slot_enshutsu_A', 'A_02_e'],
    ])
    expect(applied.assets.find(asset => asset.assetId === shared.asset.assetId)).toMatchObject({
      displayName: 'A_01.png',
      source: { kind: 'external-file', absolutePath: 'D:\\cut\\A_01.png' },
    })
  })

  it('keeps missing-ok bindings non-blocking', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const project = upsertBinding(created.project, { slotId: 'slot_enshutsu_A', keyId: created.key.keyId, cspCellName: 'A1', materialState: 'missing-ok' })
    const correctionBinding = project.bindings.find(binding => binding.slotId === 'slot_enshutsu_A')
    expect(correctionBinding?.materialState).toBe('missing-ok')
    expect(validateProject(project).some(issue => issue.severity === 'error')).toBe(false)
  })

  it('supports project history undo and redo', () => {
    const initial = createProjectHistory(createDefaultProject())
    const created = createOrSetEvent(initial.present, 'A', 1)
    const committed = { past: [...initial.past, initial.present], present: created.project, future: [] }
    expect(undoHistory(committed).present.logicalSheet.events).toHaveLength(0)
    expect(redoHistory(undoHistory(committed)).present.logicalSheet.events).toHaveLength(1)
  })

  it('migrates partial project JSON into a current project shape', () => {
    const migrated = migrateProject({ projectId: 'old', logicalSheet: { ...createDefaultProject().logicalSheet, keys: [], events: [] } })
    expect(migrated.memos).toEqual([])
    expect(migrated.timedRangeCues).toEqual([])
    expect(migrated.productionStages).toHaveLength(1)
  })

  it('rejects obsolete single-cut project files', () => {
    expect(() => parseProjectDocument(createDefaultProject())).toThrow('対応していないプロジェクトファイル')
  })

  it('round-trips timeline memo anchors, canvas placement, and ink with the active cut', () => {
    const source = createDefaultProject()
    const withMemo = addTimelineMemo(source, {
      kind: 'timeline',
      memoId: 'timeline_memo_1',
      anchor: { role: 'action', frame: 70, paperTrack: 'A' },
      placement: { frameOffset: 0, crossOffsetUnits: 1, widthUnits: 10, heightFrames: 8 },
      strokes: [{ strokeId: 'stroke_1', color: '#123456', widthUnits: 0.2, points: [{ x: 1, y: 1 }, { x: 8, y: 7 }] }],
      order: 1,
    })
    const restored = activeCutProjectFromDocument(parseProjectDocument(createProjectDocumentFromCutProject(withMemo)))
    expect(timelineMemos(restored)).toEqual(timelineMemos(withMemo))
  })

  it('preserves inactive cuts while keeping production metadata canonical', () => {
    const first = createOrSetEvent({ ...createDefaultProject(), cut: { title: 'SAMPLE', episode: '05', scene: '1', cut: '237' } }, 'A', 1).project
    let document = createProjectDocumentFromCutProject(first, { cutId: 'cut_237' })
    document = addBlankSharedCutToProjectDocument(document, first, { cut: { scene: '1', cut: '238' } })
    const second = createOrSetEvent(activeCutProjectFromDocument(document), 'C', 24).project
    document = updateActiveCutProjectInDocument(document, second)
    const switched = switchActiveCutInProjectDocument(document, second, 'cut_237')
    const updatedFirst = createOrSetEvent({
      ...activeCutProjectFromDocument(switched),
      cut: { ...activeCutProjectFromDocument(switched).cut, title: 'RENAMED' },
    }, 'B', 8).project
    const updatedDocument = updateActiveCutProjectInDocument(switched, updatedFirst)
    expect(updatedDocument.cuts).toHaveLength(2)
    expect(updatedDocument.production).toMatchObject({ title: 'RENAMED', episode: '05' })
    expect(activeCutProjectFromDocument({ ...updatedDocument, activeCutId: 'cut_237' }).logicalSheet.events).toEqual(updatedFirst.logicalSheet.events)
    expect(activeCutProjectFromDocument({ ...updatedDocument, activeCutId: document.activeCutId }).logicalSheet.events).toEqual(second.logicalSheet.events)
    expect(activeCutProjectFromDocument({ ...updatedDocument, activeCutId: document.activeCutId }).cut.title).toBe('RENAMED')
  })

  it('adds blank shared cuts while sharing registered cells and stack guide labels', () => {
    const created = createOrSetEvent({ ...createDefaultProject(), cut: { title: 'SAMPLE', episode: '05', cut: '237' } }, 'A', 1).project
    const withLabel = createStackGuideLabel(created, { label: 'BG', displayRole: 'action', gapIndex: 1, insertAfterPaperTrack: 'A' }).project
    const document = createProjectDocumentFromCutProject(withLabel)
    const withSharedCut = addBlankSharedCutToProjectDocument(document, withLabel, { cut: { cut: '238' } })
    const activeCut = activeCutProjectFromDocument(withSharedCut)

    expect(withSharedCut.cuts).toHaveLength(2)
    expect(withSharedCut.sheetTemplate.templateId).toBe(withLabel.sheetTemplateId)
    expect('keys' in withSharedCut.cuts[0]!.revisions[0]!.logicalSheet).toBe(false)
    expect('bindings' in withSharedCut.cuts[0]!).toBe(false)
    expect('stackGuideLabels' in withSharedCut.cuts[0]!).toBe(false)
    expect('exportProfiles' in withSharedCut.cuts[0]!).toBe(false)
    expect(activeCut.cut).toMatchObject({ title: 'SAMPLE', episode: '05', cut: '238' })
    expect(activeCut.logicalSheet.events).toHaveLength(0)
    expect(activeCut.sheetView.sources).toHaveLength(0)
    expect(activeCut.logicalSheet.keys).toEqual(withLabel.logicalSheet.keys)
    expect(activeCut.bindings).toEqual(withLabel.bindings)
    expect(activeCut.stackGuideLabels.map(label => label.label)).toEqual(['BG'])
  })

  it('keeps stack guide placements per shared cut when switching active cuts', () => {
    const created = createStackGuideLabel({ ...createDefaultProject(), cut: { title: 'SAMPLE', episode: '05', cut: '237' } }, {
      label: 'BOOK',
      displayRole: 'action',
      gapIndex: 1,
      insertAfterPaperTrack: 'A',
      viewSnapIndex: 2,
    }).project
    const document = createProjectDocumentFromCutProject(created)
    const added = addBlankSharedCutToProjectDocument(document, created, { cut: { cut: '238' } })
    const sharedCut = activeCutProjectFromDocument(added)
    const movedSharedCut = updateStackGuideLabel(sharedCut, sharedCut.stackGuideLabels[0]!.labelId, {
      displayRole: 'cell',
      gapIndex: 4,
      insertAfterPaperTrack: 'D',
      viewSnapIndex: 5,
      orderInGap: 2,
    })
    const switchedToFirst = switchActiveCutInProjectDocument(added, movedSharedCut, 'cut_1')
    const firstCut = activeCutProjectFromDocument(switchedToFirst)

    expect(firstCut.cut.cut).toBe('237')
    expect(firstCut.stackGuideLabels[0]).toMatchObject({
      displayRole: 'action',
      gapIndex: 1,
      insertAfterPaperTrack: 'A',
      viewSnapIndex: 2,
      orderInGap: 0,
    })

    const switchedBack = switchActiveCutInProjectDocument(switchedToFirst, firstCut, added.activeCutId)
    const secondCut = activeCutProjectFromDocument(switchedBack)
    expect(secondCut.cut.cut).toBe('238')
    expect(secondCut.stackGuideLabels[0]).toMatchObject({
      displayRole: 'cell',
      gapIndex: 4,
      insertAfterPaperTrack: 'D',
      viewSnapIndex: 5,
      orderInGap: 2,
    })
  })

  it('migrates legacy annotations as view-surface strokes', () => {
    const migrated = migrateProject({
      projectId: 'old-annotations',
      sheetTemplateId: digitalStandardSheetTemplate.templateId,
      annotations: [{
        annotationId: 'anno_legacy',
        pageId: 'page_1',
        tool: 'pen',
        color: '#d52b2b',
        width: 0.004,
        points: [{ x: 0.1, y: 0.2 }],
      }],
    })
    expect(sheetAnnotations(migrated)[0]).toMatchObject({
      coordinateSpace: 'view-surface',
      anchor: {
        kind: 'view-surface',
        templateId: digitalStandardSheetTemplate.templateId,
        pageId: 'page_1',
      },
    })
  })

  it('erases only the touched part of annotation strokes', () => {
    const project = addAnnotation(createDefaultProject(), {
        annotationId: 'anno_1',
        pageId: 'page_1',
        tool: 'pen' as const,
        color: '#d52b2b',
        width: 0.01,
        points: [
          { x: 0, y: 0.5 },
          { x: 0.25, y: 0.5 },
          { x: 0.5, y: 0.5 },
          { x: 0.75, y: 0.5 },
          { x: 1, y: 0.5 },
        ],
      })

    const erased = eraseAnnotations(project, {
      pageId: 'page_1',
      width: 0.12,
      points: [
        { x: 0.5, y: 0.35 },
        { x: 0.5, y: 0.65 },
      ],
    })

    expect(sheetAnnotations(erased)).toHaveLength(2)
    const erasedStrokes = sheetAnnotations(erased).filter((annotation): annotation is AnnotationStroke => annotation.kind !== 'text')
    expect(erasedStrokes.map(stroke => stroke.points)).toEqual([
      [
        { x: 0, y: 0.5 },
        { x: 0.25, y: 0.5 },
      ],
      [
        { x: 0.75, y: 0.5 },
        { x: 1, y: 0.5 },
      ],
    ])
  })

  it('clears annotations only on the selected page', () => {
    const project = [
        {
          annotationId: 'anno_page_1',
          pageId: 'page_1',
          tool: 'pen' as const,
          color: '#d52b2b',
          width: 0.01,
          points: [{ x: 0.1, y: 0.2 }],
        },
        {
          annotationId: 'anno_page_2',
          pageId: 'page_2',
          tool: 'pen' as const,
          color: '#d52b2b',
          width: 0.01,
          points: [{ x: 0.3, y: 0.4 }],
        },
      ].reduce((current, annotation) => addAnnotation(current, annotation), createDefaultProject())

    const cleared = clearAnnotationsForPage(project, 'page_1')

    expect(sheetAnnotations(cleared)).toEqual([expect.objectContaining({ annotationId: 'anno_page_2', pageId: 'page_2' })])
  })

  it('clears free annotations without deleting anchored timeline memos', () => {
    let project = addAnnotation(createDefaultProject(), {
      annotationId: 'anno_1',
      pageId: 'page_1',
      tool: 'pen',
      color: '#000',
      width: 0.01,
      points: [{ x: 0.1, y: 0.1 }],
    })
    project = addTimelineMemo(project, {
      kind: 'timeline',
      memoId: 'memo_1',
      anchor: { role: 'action', frame: 1, paperTrack: 'A' },
      placement: { frameOffset: 0, crossOffsetUnits: 0, widthUnits: 8, heightFrames: 8 },
      strokes: [],
      order: 1,
    })

    const cleared = clearAnnotations(project)
    expect(sheetAnnotations(cleared)).toEqual([])
    expect(timelineMemos(cleared)).toEqual(timelineMemos(project))
  })

  it('keeps cell materials and timesheet scans as separate asset roles', () => {
    const material = registerAsset(createDefaultProject(), { name: 'scan.png', size: 100, lastModified: 1 }, { role: 'cell-material' })
    const timesheet = registerAsset(material.project, { name: 'scan.png', size: 100, lastModified: 1 }, { role: 'timesheet-scan' })
    expect(timesheet.project.assets).toHaveLength(2)
    expect(timesheet.project.assets.map(asset => asset.assetId)).toEqual(['asset_0001', 'asset_0002'])
    expect(timesheet.project.assets.map(asset => asset.role)).toEqual(['cell-material', 'timesheet-scan'])
  })

  it('reuses a direct-dropped asset when the same file is later registered with folder metadata', () => {
    const dropped = registerAsset(createDefaultProject(), {
      name: 'A1.png',
      size: 100,
      lastModified: 1,
      contentHash: 'sha256:a1',
    }, { role: 'cell-material' })
    const imported = registerAsset(dropped.project, {
      name: 'A1.png',
      size: 100,
      lastModified: 1,
      path: 'D:\\cut\\A1.png',
      relativePath: 'A1.png',
      contentHash: 'sha256:a1',
    }, { role: 'cell-material' })
    expect(imported.project.assets).toHaveLength(1)
    expect(imported.asset.assetId).toBe(dropped.asset.assetId)
    expect(imported.asset).toMatchObject({
      source: { kind: 'external-file', absolutePath: 'D:\\cut\\A1.png' },
      contentHash: 'sha256:a1',
    })
  })

  it('repairs blank asset-drop bindings whose CSP names drifted away from their material file names', () => {
    const created = createKey(createDefaultProject(), 'C', 'temp', 'asset-drop', 'temp', 'action')
    const blankKeyProject = {
      ...created.project,
      logicalSheet: {
        ...created.project.logicalSheet,
        keys: created.project.logicalSheet.keys.map(key => key.keyId === created.key.keyId
          ? { ...key, displayLabel: '', paperToken: '' }
          : key),
      },
    }
    const rootedProject = { ...blankKeyProject, assetRoot: { label: 'C001', path: 'D:\\cuts\\C001', handleKind: 'directory' as const } }
    const asset = registerAsset(rootedProject, {
      name: 'scan_007.jpg',
      path: 'D:\\cuts\\C001\\scan_007.jpg',
      relativePath: 'scan_007.jpg',
    }, {
      role: 'cell-material',
      relativePath: 'scan_007.jpg',
    })
    const withEvent = setEvent(asset.project, 'C', 1, created.key.keyId, 'action')
    const drifted = upsertBinding(withEvent, {
      slotId: 'slot_C',
      keyId: created.key.keyId,
      cspCellName: 'scan_004',
      assetId: asset.asset.assetId,
      materialState: 'assigned',
    })

    const rawDocument = createProjectDocumentFromCutProject(drifted)
    const rawRegisteredBinding = rawDocument.registeredCells.bindings.find(binding => binding.keyId === created.key.keyId)
    if (rawRegisteredBinding) rawRegisteredBinding.cspCellName = 'scan_004'

    const document = parseProjectDocument(rawDocument)
    const migrated = activeCutProjectFromDocument(document)
    const repairedBinding = migrated.bindings.find(binding => binding.keyId === created.key.keyId)
    const packageBuild = buildCspImportPackage(document)

    expect(repairedBinding?.cspCellName).toBe('scan_007')
    expect(packageBuild.issues.map(issue => issue.code)).not.toContain('cspImport.asset.stemMismatch')
  })

  it('updates metadata for the same absolute asset path without creating another browser item', () => {
    const first = registerAsset(createDefaultProject(), {
      name: 'A1.png',
      size: 100,
      lastModified: 1,
      path: 'D:\\cut\\A1.png',
      contentHash: 'sha256:old',
    }, { role: 'cell-material' })
    const second = registerAsset(first.project, {
      name: 'A1.png',
      size: 120,
      lastModified: 2,
      path: 'd:/cut/A1.png',
      contentHash: 'sha256:new',
    }, { role: 'cell-material' })
    expect(second.project.assets).toHaveLength(1)
    expect(second.asset.assetId).toBe(first.asset.assetId)
    expect(second.asset).toMatchObject({
      fileSize: 120,
      modifiedAt: new Date(2).toISOString(),
      contentHash: 'sha256:new',
    })
  })

  it('does not merge different asset paths only because their content hash matches', () => {
    const first = registerAsset(createDefaultProject(), {
      name: 'A1.png',
      size: 100,
      lastModified: 1,
      path: 'D:\\cut\\A1.png',
      contentHash: 'sha256:same',
    }, { role: 'cell-material' })
    const second = registerAsset(first.project, {
      name: 'A1_copy.png',
      size: 100,
      lastModified: 1,
      path: 'D:\\other\\A1_copy.png',
      contentHash: 'sha256:same',
    }, { role: 'cell-material' })
    expect(second.project.assets).toHaveLength(2)
  })

  it('keeps a direct-dropped file outside the primary root as an external source', () => {
    const rooted = registerAssetRoot(createDefaultProject(), {
      label: 'C001',
      path: 'D:\\cuts\\C001',
    })
    const registered = registerAsset(rooted.project, {
      name: 'A1.png',
      path: 'E:\\references\\A1.png',
      rootPath: 'E:\\references',
      relativePath: 'A1.png',
    }, { role: 'cell-material' })

    expect(registered.asset.source).toEqual({
      kind: 'external-file',
      absolutePath: 'E:\\references\\A1.png',
    })
  })

  it('preserves root-relative asset identity when the cut folder moves', () => {
    const firstRoot = registerAssetRoot(createDefaultProject(), { label: 'C001', path: 'D:\\cuts\\C001' })
    const registered = registerAsset(firstRoot.project, {
      name: 'A1.png',
      path: 'D:\\cuts\\C001\\A1.png',
    }, { role: 'cell-material' })
    const changedRoot = registerAssetRoot(registered.project, { label: 'C002', path: 'D:\\cuts\\C002' })

    expect(changedRoot.project.assets[0]?.source).toEqual({
      kind: 'root-relative',
      relativePath: 'A1.png',
    })
    expect(assetAbsolutePath(changedRoot.project.assets[0]!, changedRoot.root)).toBe('D:\\cuts\\C002\\A1.png')
  })

  it('adopts an external asset as root-relative when its containing root is registered and scanned', () => {
    const external = registerAsset(createDefaultProject(), {
      name: 'A1.png',
      path: 'D:\\cuts\\C001\\A1.png',
    }, { role: 'cell-material' })
    const rooted = registerAssetRoot(external.project, { label: 'C001', path: 'D:\\cuts\\C001' })
    const rescanned = registerAsset(rooted.project, {
      name: 'A1.png',
      path: 'D:\\cuts\\C001\\A1.png',
      rootPath: 'D:\\cuts\\C001',
      relativePath: 'A1.png',
    }, { role: 'cell-material' })

    expect(rescanned.project.assets).toHaveLength(1)
    expect(rescanned.asset.source).toEqual({ kind: 'root-relative', relativePath: 'A1.png' })
  })

  it('synchronizes a root scan with relative folder paths', () => {
    const synchronized = synchronizeAssetRoot(createDefaultProject(), {
      label: 'C001',
      path: 'D:\\cuts\\C001',
    }, [
      { name: 'A1.png', path: 'D:\\cuts\\C001\\LO\\A\\A1.png', relativePath: 'LO\\A\\A1.png' },
      { name: 'BG1.png', path: 'D:\\cuts\\C001\\BG\\BG1.png', relativePath: 'BG/BG1.png' },
    ])

    expect(synchronized.project.assets.map(asset => asset.source)).toEqual([
      { kind: 'root-relative', relativePath: 'LO/A/A1.png' },
      { kind: 'root-relative', relativePath: 'BG/BG1.png' },
    ])
  })

  it('keeps missing root assets unresolved and restores their identity when they reappear', () => {
    const first = synchronizeAssetRoot(createDefaultProject(), {
      label: 'C001',
      path: 'D:\\cuts\\C001',
    }, [{ name: 'A1.png', path: 'D:\\cuts\\C001\\A\\A1.png', relativePath: 'A/A1.png' }])
    const assetId = first.assetIds[0]

    const missing = synchronizeAssetRoot(first.project, {
      label: 'C001',
      path: 'D:\\cuts\\C001',
    }, [])
    expect(missing.project.assets).toHaveLength(1)
    expect(missing.project.assets[0]?.source).toEqual({
      kind: 'unresolved',
      lastKnownPath: 'D:\\cuts\\C001\\A\\A1.png',
    })

    const restored = synchronizeAssetRoot(missing.project, {
      label: 'C001',
      path: 'D:\\cuts\\C001',
    }, [{ name: 'A1.png', path: 'D:\\cuts\\C001\\A\\A1.png', relativePath: 'A/A1.png' }])
    expect(restored.project.assets).toHaveLength(1)
    expect(restored.assetIds).toEqual([assetId])
    expect(restored.project.assets[0]?.source).toEqual({ kind: 'root-relative', relativePath: 'A/A1.png' })
  })

  it('creates the root project-material bin in the current project schema', () => {
    const migrated = migrateProject(createDefaultProject())
    expect(migrated.assetRoot).toBeUndefined()
    expect(migrated.assetBins).toEqual([{ binId: 'asset_bin_root', name: 'プロジェクト素材', order: 0 }])
  })

  it('derives CSP slot metadata from the global process and paper-track structure', () => {
    const project = createDefaultProject()
    const sourceSlot = project.cspTrackSlots.find(slot => slot.paperTrack === 'A' && slot.correctionLayerId === 'layer_sakuga')
    if (!sourceSlot) throw new Error('A/sakuga slot not found')
    const migrated = migrateProject({
      ...project,
      cspTrackSlots: project.cspTrackSlots.map(slot => slot.slotId === sourceSlot.slotId
        ? {
            ...slot,
            displayPath: '監督/Aだけ特別',
            xdtsName: 'A_director_only',
            trackNo: 999,
            occurrenceIndex: 999,
            stageId: 'stage_invalid',
          }
        : slot),
    })

    expect(migrated.cspTrackSlots.find(slot => slot.slotId === sourceSlot.slotId)).toMatchObject({
      paperTrack: 'A',
      stageId: 'stage_lo',
      correctionLayerId: 'layer_sakuga',
      displayPath: '作画/A',
      xdtsName: 'A',
      trackNo: 0,
      occurrenceIndex: 0,
    })
  })

  it('roundtrips project JSON through migration without losing operational data', () => {
    const created = createOrSetEvent(createDefaultProject(), 'B', 12)
    let project = upsertBinding(created.project, { slotId: 'slot_B', keyId: created.key.keyId, cspCellName: 'B12_custom', materialState: 'assigned' })
    project = updateSheetViewState(project, { viewMode: 'spread', activePageId: 'page_2' })
    const registered = registerSheetSource(project, { name: 'sheet-page-2.png', size: 1200, contentHash: 'sha256:test' })
    project = assignSheetSourceToPage(registered.project, 'page_2', registered.source.sourceId)
    project = updateSheetPageViewState(project, 'page_2', {
      alignment: {
        opacity: 0.7,
        x: 0.01,
        levelCorrection: {
          enabled: true,
          inputBlack: 2,
          inputWhite: 248,
          gamma: 0.75,
        },
      },
    })
    const roundTripped = migrateProject(JSON.parse(JSON.stringify(project)))
    expect(roundTripped.logicalSheet.keys).toEqual(project.logicalSheet.keys)
    expect(roundTripped.logicalSheet.events).toEqual(project.logicalSheet.events)
    expect(roundTripped.bindings).toEqual(project.bindings)
    expect(roundTripped.cspTrackSlots).toEqual(project.cspTrackSlots)
    expect(roundTripped.sheetView).toEqual(project.sheetView)
  })

  it('migrates old project JSON with default sheet view state', () => {
    const oldJson = { ...createDefaultProject(), sheetView: undefined }
    const migrated = migrateProject(oldJson)
    expect(migrated.sheetView.templateId).toBe('standard-a3-timesheet-v2')
    expect(migrated.sheetView.viewMode).toBe('continuous')
    expect(migrated.sheetView.metadataDisplay).toEqual({ sharedCutNumbers: true })
    expect(migrated.sheetView.pages[0].alignment.corners.br).toEqual({ x: 1, y: 1 })
  })

  it('preserves an explicit shared cut number display preference', () => {
    const project = createDefaultProject()
    project.sheetView.metadataDisplay.sharedCutNumbers = false
    const migrated = migrateProject(JSON.parse(JSON.stringify(project)))
    expect(migrated.sheetView.metadataDisplay).toEqual({ sharedCutNumbers: false })
  })

  it('migrates legacy per-page image refs into sheet sources', () => {
    const legacy = updateSheetPageViewState(createDefaultProject(), 'page_2', {
      imageRef: { name: 'legacy-page-2.png', size: 2048, lastModified: 100 },
    })
    const migrated = migrateProject(JSON.parse(JSON.stringify(legacy)))
    const migratedSource = migrated.sheetView.sources.find(source => source.imageRef.name === 'legacy-page-2.png')
    expect(migrated.sheetView.sources).toHaveLength(1)
    expect(migrated.sheetView.sources.some(source => source.kind === 'template-underlay')).toBe(false)
    expect(migratedSource).toBeTruthy()
    expect(migrated.sheetView.pages.find(page => page.pageId === 'page_2')?.sourceId).toBe(migratedSource?.sourceId)
  })

  it('registers and assigns sheet sources to pages', () => {
    const registered = registerSheetSource(createDefaultProject(), { name: 'page-1.png', size: 4096, lastModified: 200 })
    const assigned = assignSheetSourceToPage(registered.project, 'page_1', registered.source.sourceId)
    expect(assigned.sheetView.sources.find(source => source.sourceId === registered.source.sourceId)).toMatchObject({ sourceId: registered.source.sourceId, assignedPageId: 'page_1' })
    expect(assigned.sheetView.pages[0].sourceId).toBe(registered.source.sourceId)
    expect(validateProject(assigned).some(issue => issue.code === 'sheet.source.missing')).toBe(false)
  })

  it('blocks events after the cut duration', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 145)
    const shortened = updateLogicalSheetSettings(created.project, { durationFrames: 144 })
    expect(validateProject(shortened).some(issue => issue.code === 'event.frame.afterDuration')).toBe(true)
  })

  it('validates timed range cue bounds', () => {
    const project = {
      ...createDefaultProject(),
      timedRangeCues: [{
        cueId: 'cue_camera_1',
        role: 'camera' as const,
        frameStart: 48,
        frameEnd: 24,
        laneId: 'camera_lane_1',
        label: 'OL',
        text: 'OL',
      }],
    }
    expect(validateProject(project).some(issue => issue.code === 'cue.range.invalid')).toBe(true)
  })
})

describe('sheet template hit testing', () => {
  it('keeps SAMPLE ACTION grids aligned to the A-I columns without the side gutters', () => {
    expect(hitTestSheetTemplate(standardA3SheetTemplate, { x: 0.025, y: 0.29 }, { role: 'action' })).toBeNull()
    expect(hitTestSheetTemplate(standardA3SheetTemplate, { x: 0.04, y: 0.29 }, { role: 'action' })).toMatchObject({ paperTrack: 'A', frame: 1 })
    expect(hitTestSheetTemplate(standardA3SheetTemplate, { x: 0.515, y: 0.29 }, { role: 'action' })).toBeNull()
    expect(hitTestSheetTemplate(standardA3SheetTemplate, { x: 0.53, y: 0.29 }, { role: 'action' })).toMatchObject({ paperTrack: 'A', frame: 73 })
  })

  it('keeps the SAMPLE calibration target aligned to the printed lower grid outer frame', () => {
    expect(standardA3SheetTemplate.calibration?.targetRect).toEqual({
      x: 35 / 1754,
      y: 637 / 2481,
      w: 1683 / 1754,
      h: 1772 / 2481,
    })
  })

  it('maps normalized points to CELL tracks and frames', () => {
    const hit = hitTestSheetTemplate(standardA3SheetTemplate, { x: 0.255, y: 0.29 }, { onlyXdtsEligible: true, role: 'cell' })
    expect(hit).toMatchObject({ paperTrack: 'A', frame: 1, role: 'cell' })
  })

  it('resolves ACTION and CELL hits for the same track/frame in their own regions', () => {
    expect(timingHitForFrame(standardA3SheetTemplate, 'action', 'A', 1)).toMatchObject({
      regionId: 'left_action_grid',
      role: 'action',
      paperTrack: 'A',
      frame: 1,
    })
    expect(timingHitForFrame(standardA3SheetTemplate, 'cell', 'A', 1)).toMatchObject({
      regionId: 'left_cell_grid',
      role: 'cell',
      paperTrack: 'A',
      frame: 1,
    })
  })

  it('treats SAMPLE ACTION and CELL left/right grids as continuous timed flows', () => {
    const actionRegions = standardA3SheetTemplate.regions.filter(region => region.grid?.role === 'action')
    expect(actionRegions.map(region => [region.regionId, region.flowGroupId, region.grid?.frameStart, region.grid?.frameEnd])).toEqual([
      ['left_action_grid', 'main_action', 1, 72],
      ['right_action_grid', 'main_action', 73, 144],
    ])

    const cellRegions = standardA3SheetTemplate.regions.filter(region => region.grid?.role === 'cell')
    expect(cellRegions.map(region => [region.regionId, region.flowGroupId, region.grid?.frameStart, region.grid?.frameEnd])).toEqual([
      ['left_cell_grid', 'main_cell', 1, 72],
      ['right_cell_grid', 'main_cell', 73, 144],
    ])
  })

  it('treats the SAMPLE center strips as SOUND timed range regions', () => {
    const soundRegions = standardA3SheetTemplate.regions.filter(region => region.grid?.role === 'sound')
    expect(soundRegions.map(region => [region.regionId, region.label, region.inputMode, region.flowGroupId, region.grid?.frameStart, region.grid?.frameEnd])).toEqual([
      ['left_sound_grid', 'SOUND 1-72', 'timed-range', 'main_sound', 1, 72],
      ['right_sound_grid', 'SOUND 73-144', 'timed-range', 'main_sound', 73, 144],
    ])
    expect(soundRegions.map(region => region.grid?.columns.map(column => [column.columnId, column.label]))).toEqual([
      [
        ['sound_1', 'S1'],
        ['sound_2', 'S2'],
        ['sound_3', 'S3'],
        ['sound_4', 'S4'],
      ],
      [
        ['sound_1', 'S1'],
        ['sound_2', 'S2'],
        ['sound_3', 'S3'],
        ['sound_4', 'S4'],
      ],
    ])
    const leftSoundRegion = soundRegions[0]
    const leftSoundGrid = leftSoundRegion.grid
    if (!leftSoundGrid) throw new Error('Expected left SOUND grid')
    const firstFrameY = leftSoundRegion.rect.y + leftSoundRegion.rect.h / leftSoundGrid.rowCount / 2
    const columnHits = leftSoundGrid.columns.map((_, index) => hitTestSheetTemplate(standardA3SheetTemplate, {
      x: leftSoundRegion.rect.x + (leftSoundRegion.rect.w * (index + 0.5)) / leftSoundGrid.columns.length,
      y: firstFrameY,
    }, { role: 'sound' })?.columnId)
    expect(columnHits).toEqual(['sound_1', 'sound_2', 'sound_3', 'sound_4'])
  })

  it('marks SAMPLE CAMERA grids as timed range instruction regions', () => {
    const cameraRegions = standardA3SheetTemplate.regions.filter(region => region.grid?.role === 'camera')
    expect(cameraRegions.map(region => [region.regionId, region.inputMode, region.flowGroupId])).toEqual([
      ['left_camera_grid', 'timed-range', 'main_camera'],
      ['right_camera_grid', 'timed-range', 'main_camera'],
    ])
  })

  it('derives hit testing columns from configurable paper tracks', () => {
    const template = withSheetTemplatePaperTracks(standardA3SheetTemplate, ['A', 'B', 'C', 'D', 'E'])
    expect(getSheetTemplatePaperTracks(template)).toEqual(['A', 'B', 'C', 'D', 'E'])

    const leftCellRegion = template.regions.find(region => region.regionId === 'left_cell_grid')
    const columns = leftCellRegion?.grid ? resolveSheetTemplateGridColumns(template, leftCellRegion.grid) : []
    expect(columns).toHaveLength(9)
    expect(columns.map(column => column.paperTrack)).toEqual(['A', 'B', 'C', 'D', 'E', undefined, undefined, undefined, undefined])

    const eColumnPoint = leftCellRegion && columns.length > 0
      ? {
          x: leftCellRegion.rect.x + (leftCellRegion.rect.w * 4.5) / columns.length,
          y: leftCellRegion.rect.y + leftCellRegion.rect.h * 0.01,
        }
      : { x: 0, y: 0 }
    const hit = hitTestSheetTemplate(template, eColumnPoint, { onlyXdtsEligible: true, role: 'cell' })
    expect(hit).toMatchObject({ paperTrack: 'E', frame: 1, role: 'cell' })
  })

  it('keeps SAMPLE display slots fixed when logical paper tracks overflow the paper template', () => {
    const labels = createAlphabeticTrackLabels(26)
    const template = withSheetTemplatePaperTracks(standardA3SheetTemplate, labels)
    const leftCellRegion = template.regions.find(region => region.regionId === 'left_cell_grid')
    const columns = leftCellRegion?.grid ? resolveSheetTemplateGridColumns(template, leftCellRegion.grid) : []

    expect(getSheetTemplatePaperTracks(template)).toEqual(labels)
    expect(leftCellRegion?.grid?.columns).toHaveLength(9)
    expect(columns.map(column => column.paperTrack)).toEqual(labels.slice(0, 9))
    expect(getSheetTemplateVisiblePaperTracks(template)).toEqual(labels.slice(0, 9))
    expect(getSheetTemplateHiddenPaperTracks(template)).toEqual(labels.slice(9))
    expect(cellHitForFrame(template, 'I', 1)).toMatchObject({ paperTrack: 'I', columnIndex: 8 })
    expect(cellHitForFrame(template, 'J', 1)).toBeNull()
  })

  it('creates repeated paper pages for cuts longer than one six-second sheet', () => {
    expect(getSheetViewLayout(standardA3SheetTemplate)).toMatchObject({
      type: 'paged',
      framesPerPage: 144,
      defaultViewMode: 'continuous',
      frameAxis: {
        type: 'paged',
        framesPerPage: 144,
        overflow: 'paginate',
      },
      trackAxis: {
        type: 'fixed-slots',
        overflow: 'hidden',
      },
      surface: {
        type: 'fixed-page',
      },
    })
    expect(createSheetPages(standardA3SheetTemplate, 168).map(page => [page.frameStart, page.frameEnd])).toEqual([
      [1, 144],
      [145, 168],
    ])
    expect(cellHitForFrame(standardA3SheetTemplate, 'A', 145, 168)).toMatchObject({
      pageId: 'page_2',
      pageIndex: 1,
      localFrame: 1,
      rowIndex: 0,
      regionId: 'left_cell_grid',
    })
  })

  it('exposes A3 standard and digital standard sheet presets', () => {
    expect(standardA3SheetTemplate.name).toBe('A3標準')
    expect(sheetTemplatePresets.map(preset => preset.name)).toEqual(['A3標準', 'デジタル標準'])
    expect(sheetTemplatePresetsForImageCorrection().map(preset => preset.name)).toEqual(['A3標準'])
    expect(sheetTemplatePresetSupportsCapability(sheetTemplatePresets[0], 'image-correction')).toBe(true)
    expect(sheetTemplatePresetSupportsCapability(sheetTemplatePresets[1], 'image-correction')).toBe(false)
    expect(standardA3SheetTemplate.regions.flatMap(region =>
      region.binding?.target === 'cut-metadata' ? [region.binding.field] : [],
    )).toEqual(['title', 'episode', 'cut', 'duration', 'worker', 'page'])
    expect(digitalStandardSheetTemplate).toMatchObject({
      name: 'デジタル標準',
      templateKind: 'digital-native',
      viewLayout: {
        frameAxis: { type: 'infinite', overflow: 'scroll' },
        trackAxis: { type: 'logical-width', overflow: 'scroll' },
        surface: { type: 'continuous-canvas' },
      },
    })
    expect(digitalStandardSheetTemplate.fields?.flatMap(field =>
      field.builtinBinding?.target === 'cut-metadata' ? [field.builtinBinding.field] : [],
    )).toEqual(['title', 'episode', 'scene', 'cut', 'duration', 'worker'])
  })

  it('lets the digital standard view follow logical tracks and duration', () => {
    const labels = createAlphabeticTrackLabels(26)
    const template = withSheetTemplatePaperTracks(digitalStandardSheetTemplate, labels)
    const actionRegion = template.regions.find(region => region.regionId === 'digital_action_grid')
    const cellRegion = template.regions.find(region => region.regionId === 'digital_cell_grid')
    const actionColumns = actionRegion?.grid ? resolveSheetTemplateGridColumns(template, actionRegion.grid) : []
    const columns = cellRegion?.grid ? resolveSheetTemplateGridColumns(template, cellRegion.grid) : []
    const frames = cellRegion?.grid ? resolveSheetTemplateGridFrames(template, cellRegion.grid, 168, 1) : null

    expect(actionColumns.map(column => column.paperTrack)).toEqual(labels)
    expect(columns.map(column => column.paperTrack)).toEqual(labels)
    expect(actionColumns.map(column => column.paperTrack)).toEqual(columns.map(column => column.paperTrack))
    expect(getSheetTemplateHiddenPaperTracks(template)).toEqual([])
    expect(frames).toEqual({ frameStart: 1, frameEnd: 168, rowCount: 168 })
    expect(timingHitForFrame(template, 'cell', 'Z', 168, 168, 1, labels)).toMatchObject({
      paperTrack: 'Z',
      frame: 168,
      rowIndex: 167,
      columnIndex: 25,
    })
  })

  it('expands the digital standard canvas without compressing logical frame grids', () => {
    const cellRegion = digitalStandardSheetTemplate.regions.find(region => region.regionId === 'digital_cell_grid')
    expect(cellRegion?.grid).toBeTruthy()
    if (!cellRegion?.grid) return

    const baseSize = resolveSheetTemplatePageSize(digitalStandardSheetTemplate, 144)
    const longSize = resolveSheetTemplatePageSize(digitalStandardSheetTemplate, 288)
    const longRect = resolveSheetTemplateRegionRect(digitalStandardSheetTemplate, cellRegion, 288)

    expect(baseSize).toEqual({ widthPx: 1920, heightPx: 3600 })
    expect(longSize).toEqual({ widthPx: 1920, heightPx: 6480 })
    expect(Math.round(longRect.y * longSize.heightPx)).toBe(620)
    expect(Math.round(longRect.h * longSize.heightPx)).toBe(5760)
  })

  it('normalizes legacy and digital-native view layout shapes into explicit axes', () => {
    expect(getSheetViewLayout({
      pageModel: { type: 'paged-repeat', framesPerPage: 96, defaultViewMode: 'single-page' },
    })).toMatchObject({
      type: 'paged',
      framesPerPage: 96,
      frameAxis: { type: 'paged', framesPerPage: 96, overflow: 'paginate' },
      trackAxis: { type: 'fixed-slots', overflow: 'hidden' },
      surface: { type: 'fixed-page' },
    })

    expect(getSheetViewLayout({
      viewLayout: { type: 'infinite', defaultViewMode: 'continuous' },
    })).toMatchObject({
      type: 'infinite',
      frameAxis: { type: 'infinite', overflow: 'scroll' },
      trackAxis: { type: 'logical-width', overflow: 'scroll' },
      surface: { type: 'continuous-canvas' },
    })
  })
})
