import { describe, expect, it } from 'vitest'
import {
  addBlankSharedCutToProjectDocument,
  activeCutProjectFromDocument,
  buildCspImportPackage,
  createDefaultProject,
  createOrSetEvent,
  createProjectDocumentFromCutProject,
  digitalStandardSheetTemplate,
  formatSheetTemplateCutNumber,
  registerAsset,
  registerAssetRoot,
  setEvent,
  updateActiveCutProjectInDocument,
  updateCorrectionLayers,
  updateProjectPaperTracks,
  upsertBinding,
  type CutProject,
  type PaperTrackName,
  standardA3SheetTemplate,
} from './index'

describe('CSP import package builder', () => {
  it('builds a flat multi-cut manifest that references shared assets from one asset root', () => {
    const created = createOrSetEvent({ ...createDefaultProject(), cut: { title: 'SAMPLE', episode: '05', cut: 'C001', cspTimelineName: '001' } }, 'A', 1, 'action')
    const withRoot = registerAssetRoot(created.project, {
      label: 'materials',
      path: 'D:\\cuts\\shared',
      handleKind: 'directory',
    })
    const withAsset = registerAsset(withRoot.project, {
      name: 'A_01.png',
      path: 'D:\\cuts\\shared\\materials\\A_01.png',
      relativePath: 'materials/A_01.png',
    }, {
      role: 'cell-material',
      relativePath: 'materials/A_01.png',
    })
    const withSecondAsset = registerAsset(withAsset.project, {
      name: 'B_01.png',
      path: 'D:\\cuts\\shared\\materials\\B_01.png',
      relativePath: 'materials/B_01.png',
    }, {
      role: 'cell-material',
      relativePath: 'materials/B_01.png',
    })
    const firstCut = upsertBinding(withSecondAsset.project, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      cspCellName: 'A_01',
      materialState: 'assigned',
      assetId: withAsset.asset.assetId,
    })
    const document = createProjectDocumentFromCutProject(firstCut)
    const withSecondCut = addBlankSharedCutToProjectDocument(document, firstCut, { cut: { title: 'SAMPLE', episode: '05', cut: 'C002', cspTimelineName: '002' } })
    const secondCutA = setEvent(activeCutProjectFromDocument(withSecondCut), 'A', 12, created.key.keyId, 'action')
    const secondCutBEvent = createOrSetEvent(secondCutA, 'B', 18, 'action')
    const secondCut = upsertBinding(secondCutBEvent.project, {
      slotId: 'slot_B',
      keyId: secondCutBEvent.key.keyId,
      cspCellName: 'B_01',
      materialState: 'assigned',
      assetId: withSecondAsset.asset.assetId,
    })
    const updatedDocument = updateActiveCutProjectInDocument(withSecondCut, secondCut)

    const result = buildCspImportPackage(updatedDocument, { appVersion: '0.1.test' })

    expect(result.assetRootPath).toBe('D:\\cuts\\shared')
    expect(result.outputDirectoryName).toBe('xsheet-csp-import')
    expect(result.manifest.schemaVersion).toBe(4)
    expect(result.manifest.createdBy).toEqual({ app: 'xsheet-remap', version: '0.1.test' })
    expect(result.manifest.assetRoot).toBe('..')
    expect(result.manifest.outputClipFileName).toBe('SAMPLE_05_001_002.clip')
    expect(result.manifest.setup).toEqual({ xdts: '_setup.xdts', purpose: 'create-union-animation-folders' })
    expect(result.setupOutput?.xdtsFileName).toBe('_setup.xdts')
    expect(result.setupOutput?.exportPlan.tracks.map(track => track.name)).toEqual([
      '===== XSHEET IMPORT START =====',
      '===== 作画 =====',
      'A',
      'B',
      '===== XSHEET IMPORT END =====',
    ])
    expect(result.cutOutputs.map(output => output.xdtsFileName)).toEqual(['C001.xdts', 'C002.xdts'])
    expect(result.manifest.cuts.map(cut => [cut.cutId, cut.cutNumber, cut.timelineName, cut.files.xdts])).toEqual([
      ['cut_1', 'C001', '001', 'C001.xdts'],
      ['cut_2', 'C002', '002', 'C002.xdts'],
    ])
    expect(result.manifest.cuts[0]?.tracks[0]).toMatchObject({
      trackId: 'slot_A',
      kind: 'cell',
      xdtsTrackName: 'A',
      targetFolderPath: ['LO', '作画'],
      cels: [{
        cspCellName: 'A_01',
        firstFrame: 0,
        material: { assetId: withAsset.asset.assetId, pathKind: 'asset-root-relative', path: 'materials/A_01.png' },
      }],
    })
    expect(result.manifest.cuts[1]?.tracks[0]?.cels[0]).toMatchObject({
      cspCellName: 'A_01',
      firstFrame: 11,
      material: { pathKind: 'asset-root-relative', path: 'materials/A_01.png' },
    })
    expect(result.manifest.cuts[1]?.tracks[1]?.cels[0]).toMatchObject({
      cspCellName: 'B_01',
      firstFrame: 17,
      material: { pathKind: 'asset-root-relative', path: 'materials/B_01.png' },
    })
    expect(result.issues.filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('omits the helper output CLIP file name when title and episode are blank', () => {
    const project = createDefaultProject()
    const result = buildCspImportPackage(createProjectDocumentFromCutProject({ ...project, cut: { cut: 'C001' } }))

    expect(result.manifest.outputClipFileName).toBeUndefined()
  })

  it('keeps cut text free-form in helper output CLIP names when the template has no prefix', () => {
    const project = createDefaultProject()
    const result = buildCspImportPackage(createProjectDocumentFromCutProject({
      ...project,
      cut: { title: 'SAMPLE', episode: '05', cut: 'C101' },
    }))

    expect(result.manifest.outputClipFileName).toBe('SAMPLE_05_C101.clip')
    expect(result.manifest.cuts[0]?.timelineName).toBe('C101')
  })

  it('uses the template cut prefix for CSP timeline and helper output CLIP names', () => {
    const project = createDefaultProject()
    const document = createProjectDocumentFromCutProject({
      ...project,
      cut: { title: 'SAMPLE', episode: '05', cut: '101' },
    }, {
      sheetTemplate: {
        ...standardA3SheetTemplate,
        naming: { cutNumberPrefix: 'C' },
      },
    })
    const result = buildCspImportPackage(document)

    expect(result.manifest.outputClipFileName).toBe('SAMPLE_05_C101.clip')
    expect(result.manifest.cuts[0]?.timelineName).toBe('C101')
  })

  it('does not add a numeric-only template cut prefix to nonnumeric cut text', () => {
    const project = createDefaultProject()
    const document = createProjectDocumentFromCutProject({
      ...project,
      cut: { title: 'SAMPLE', episode: '05', cut: 'OP' },
    }, {
      sheetTemplate: {
        ...standardA3SheetTemplate,
        naming: { cutNumberPrefix: 'C' },
      },
    })
    const result = buildCspImportPackage(document)

    expect(result.manifest.outputClipFileName).toBe('SAMPLE_05_OP.clip')
    expect(result.manifest.cuts[0]?.timelineName).toBe('OP')
  })

  it('leaves default template cut numbers unprefixed', () => {
    expect(standardA3SheetTemplate.naming?.cutNumberPrefix).toBeUndefined()
    expect(digitalStandardSheetTemplate.naming?.cutNumberPrefix).toBeUndefined()
    expect(formatSheetTemplateCutNumber(standardA3SheetTemplate, '001')).toBe('001')
    expect(formatSheetTemplateCutNumber(digitalStandardSheetTemplate, '001')).toBe('001')
  })

  it('uses scene and cut as the default timeline identity', () => {
    const project = { ...createDefaultProject(), cut: { title: 'SAMPLE', episode: '05', scene: '12', cut: '034' } }
    const result = buildCspImportPackage(createProjectDocumentFromCutProject(project))

    expect(result.manifest.cuts[0]).toMatchObject({ scene: '12', cutNumber: '034', displayName: '12-034', timelineName: '12-034' })
    expect(result.cutOutputs[0]?.exportPlan.metadata).toEqual({
      cut: '034',
      scene: '12',
      displayName: '12-034',
      timeTableName: '12-034',
    })
    expect(result.manifest.outputClipFileName).toBe('SAMPLE_05_12-034.clip')
  })

  it('blocks duplicate CSP timeline names across cut-group sheets', () => {
    const first = { ...createDefaultProject(), cut: { cut: 'C001', cspTimelineName: '001' } }
    let document = createProjectDocumentFromCutProject(first)
    document = addBlankSharedCutToProjectDocument(document, first, { cut: { cut: 'C002', cspTimelineName: '001' } })

    const result = buildCspImportPackage(document)

    expect(result.issues.map(issue => issue.code)).toContain('cspImport.timelineName.duplicate')
  })

  it('uses the latest explicitly selected cut folder as the single package root', () => {
    const firstRoot = registerAssetRoot(createDefaultProject(), { label: 'primary', path: 'D:\\cuts\\shared', handleKind: 'directory' })
    const secondRoot = registerAssetRoot(firstRoot.project, { label: 'reference', path: 'D:\\cuts\\reference', handleKind: 'directory' })
    const result = buildCspImportPackage(createProjectDocumentFromCutProject(secondRoot.project))

    expect(result.assetRootPath).toBe('D:\\cuts\\reference')
    expect(result.issues.map(issue => issue.code)).not.toContain('cspImport.assetRoot.selectionRequired')
  })

  it('keeps source file names independent from CSP cell names', () => {
    const created = createOrSetEvent({ ...createDefaultProject(), cut: { cut: 'C001' } }, 'A', 1, 'action')
    const withRoot = registerAssetRoot(created.project, {
      label: 'materials',
      path: 'D:\\cuts\\shared',
      handleKind: 'directory',
    })
    const withAsset = registerAsset(withRoot.project, {
      name: 'rough.png',
      path: 'D:\\cuts\\shared\\rough.png',
      relativePath: 'rough.png',
    }, {
      role: 'cell-material',
      relativePath: 'rough.png',
    })
    const project = upsertBinding(withAsset.project, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      cspCellName: 'A_01',
      materialState: 'assigned',
      assetId: withAsset.asset.assetId,
    })

    const result = buildCspImportPackage(createProjectDocumentFromCutProject(project))

    expect(result.issues.map(issue => issue.code)).not.toContain('cspImport.asset.stemMismatch')
    expect(result.manifest.cuts[0]?.tracks[0]?.cels[0]).toMatchObject({
      cspCellName: 'A_01',
      material: { pathKind: 'asset-root-relative', path: 'rough.png' },
    })
  })

  it('keeps key-only cells in the manifest without requiring image material', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const withRoot = registerAssetRoot(created.project, { label: 'materials', path: 'D:\\cuts\\shared' })
    const project = upsertBinding(withRoot.project, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      cspCellName: 'A_01',
      materialState: 'missing-ok',
    })

    const result = buildCspImportPackage(createProjectDocumentFromCutProject(project))

    expect(result.manifest.cuts[0]?.tracks[0]?.cels).toEqual([{ cspCellName: 'A_01', firstFrame: 0 }])
    expect(result.issues.filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('keeps an unassigned cell nonblocking and identifies its CSP target', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const withRoot = registerAssetRoot(created.project, { label: 'materials', path: 'D:\\cuts\\shared' })
    const project = upsertBinding(withRoot.project, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      cspCellName: 'A_01',
      materialState: 'unassigned',
    })

    const result = buildCspImportPackage(createProjectDocumentFromCutProject(project))

    expect(result.manifest.cuts[0]?.tracks[0]?.cels).toEqual([{ cspCellName: 'A_01', firstFrame: 0 }])
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'cspImport.asset.unassigned',
      target: expect.objectContaining({ label: '作画 / A / A_01' }),
    }))
    expect(result.issues.filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('builds setup XDTS tracks in project paper-track order across shared cuts', () => {
    const withRoot = projectWithMaterialRoot({
      ...updateProjectPaperTracks(createDefaultProject(), ['A', 'B', 'C']),
      cut: { cut: 'C001', cspTimelineName: '001' },
    })
    const firstCut = addBoundMaterial(withRoot, 'C', 'layer_sakkan', 1, 'C_01')
    let document = createProjectDocumentFromCutProject(firstCut)

    document = addBlankSharedCutToProjectDocument(document, firstCut, { cut: { cut: 'C002', cspTimelineName: '002' } })
    const secondCut = addBoundMaterial(activeCutProjectFromDocument(document), 'B', 'layer_sakkan', 1, 'B_01')
    document = updateActiveCutProjectInDocument(document, secondCut)

    document = addBlankSharedCutToProjectDocument(document, secondCut, { cut: { cut: 'C003', cspTimelineName: '003' } })
    const thirdCut = addBoundMaterial(activeCutProjectFromDocument(document), 'A', 'layer_sakkan', 1, 'A_01')
    document = updateActiveCutProjectInDocument(document, thirdCut)

    const result = buildCspImportPackage(document)

    expect(result.setupOutput?.exportPlan.tracks.map(track => track.name)).toEqual([
      '===== XSHEET IMPORT START =====',
      '===== 作監 =====',
      'A',
      'B',
      'C',
      '===== XSHEET IMPORT END =====',
    ])
    expect(result.issues.filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('builds setup XDTS when the project only has a non-default-named process', () => {
    const initial = createDefaultProject()
    const enshutsuLayer = initial.correctionLayers.find(layer => layer.layerId === 'layer_enshutsu')
    if (!enshutsuLayer) throw new Error('fixture layer not found')
    const withOnlyEnshutsuLayer = updateCorrectionLayers(initial, [{
      ...enshutsuLayer,
      order: 0,
      role: 'correction',
    }])
    const withRoot = projectWithMaterialRoot({
      ...updateProjectPaperTracks(withOnlyEnshutsuLayer, ['A', 'B']),
      cut: { cut: 'C101', cspTimelineName: '101' },
    })
    const firstCut = addBoundMaterial(withRoot, 'B', 'layer_enshutsu', 1, 'B_01')
    let document = createProjectDocumentFromCutProject(firstCut)

    document = addBlankSharedCutToProjectDocument(document, firstCut, { cut: { cut: 'C102', cspTimelineName: '102' } })
    const secondCut = addBoundMaterial(activeCutProjectFromDocument(document), 'A', 'layer_enshutsu', 1, 'A_01')
    document = updateActiveCutProjectInDocument(document, secondCut)

    const result = buildCspImportPackage(document)

    expect(result.setupOutput?.exportPlan.tracks.map(track => track.name)).toEqual([
      '===== XSHEET IMPORT START =====',
      '===== 演出 =====',
      'A',
      'B',
      '===== XSHEET IMPORT END =====',
    ])
    expect(result.manifest.cuts[0]?.tracks[0]).toMatchObject({
      stageLabel: '演出',
      targetFolderPath: ['LO', '演出'],
    })
    expect(result.issues.filter(issue => issue.severity === 'error')).toEqual([])
  })
})

function projectWithMaterialRoot(project: CutProject): CutProject {
  const registered = registerAssetRoot(project, {
    label: 'materials',
    path: 'D:\\cuts\\shared',
    handleKind: 'directory',
  })
  return registered.project
}

function addBoundMaterial(
  project: CutProject,
  paperTrack: PaperTrackName,
  correctionLayerId: string,
  frame: number,
  cspCellName: string,
): CutProject {
  const created = createOrSetEvent(project, paperTrack, frame, 'action')
  const registered = registerAsset(created.project, {
    name: `${cspCellName}.png`,
    path: `D:\\cuts\\shared\\materials\\${cspCellName}.png`,
    relativePath: `materials/${cspCellName}.png`,
  }, {
    role: 'cell-material',
    relativePath: `materials/${cspCellName}.png`,
  })
  const slot = registered.project.cspTrackSlots.find(item =>
    item.paperTrack === paperTrack && item.correctionLayerId === correctionLayerId
  )
  if (!slot) throw new Error(`slot not found: ${correctionLayerId}/${paperTrack}`)
  return upsertBinding(registered.project, {
    slotId: slot.slotId,
    keyId: created.key.keyId,
    cspCellName,
    materialState: 'assigned',
    assetId: registered.asset.assetId,
  })
}
