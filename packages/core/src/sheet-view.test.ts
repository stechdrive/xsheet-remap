import { describe, expect, it } from 'vitest'
import {
  assignSheetSourceToPage,
  createDefaultProject,
  migrateProject,
  registerAsset,
  registerSheetSource,
  removeSheetSource,
  type SheetSource,
  updateSheetPageViewState,
  validateProject,
} from './index'

describe('sheet view defaults', () => {
  it('shows ACTION continuation lines by default while preserving an explicit saved choice', () => {
    const project = createDefaultProject()
    expect(project.sheetView.continuationDisplay).toEqual({ action: true, cell: true })

    const missingActionPreference = JSON.parse(JSON.stringify(project))
    delete missingActionPreference.sheetView.continuationDisplay.action
    expect(migrateProject(missingActionPreference).sheetView.continuationDisplay.action).toBe(true)

    const disabled = migrateProject({
      ...project,
      sheetView: {
        ...project.sheetView,
        continuationDisplay: { action: false, cell: true },
      },
    })
    expect(disabled.sheetView.continuationDisplay.action).toBe(false)
  })
})

describe('sheet source page assignments', () => {
  it('keeps distinct registered files as separate sources even when their content hashes match', () => {
    const firstAsset = registerAsset(createDefaultProject(), {
      name: 'blank_1.png', size: 12, lastModified: 1, contentHash: 'sha256:same-blank',
    }, { role: 'timesheet-scan' })
    const firstSource = registerSheetSource(firstAsset.project, {
      name: 'blank_1.png', size: 12, lastModified: 1, contentHash: 'sha256:same-blank',
    }, { assetId: firstAsset.asset.assetId })
    const secondAsset = registerAsset(firstSource.project, {
      name: 'blank_2.png', size: 12, lastModified: 2, contentHash: 'sha256:same-blank',
    }, { role: 'timesheet-scan' })
    const secondSource = registerSheetSource(secondAsset.project, {
      name: 'blank_2.png', size: 12, lastModified: 2, contentHash: 'sha256:same-blank',
    }, { assetId: secondAsset.asset.assetId })

    expect(secondAsset.asset.assetId).not.toBe(firstAsset.asset.assetId)
    expect(secondSource.source.sourceId).not.toBe(firstSource.source.sourceId)
    expect(secondSource.project.sheetView.sources).toHaveLength(2)
  })

  it('refreshes an existing asset source reference without losing its correction', () => {
    const asset = registerAsset(createDefaultProject(), {
      name: 'paper.png', path: 'D:\\old\\paper.png', size: 10, lastModified: 1,
    }, { role: 'timesheet-scan' })
    let registered = registerSheetSource(asset.project, {
      name: 'paper.png', path: 'D:\\old\\paper.png', size: 10, lastModified: 1,
    }, { assetId: asset.asset.assetId })
    registered = {
      ...registered,
      project: updateSheetPageViewState(assignSheetSourceToPage(registered.project, 'page_1', registered.source.sourceId), 'page_1', {
        alignment: { opacity: 0.38 },
      }),
    }

    const refreshed = registerSheetSource(registered.project, {
      name: 'paper.png', path: 'E:\\moved\\paper.png', size: 10, lastModified: 2,
    }, { assetId: asset.asset.assetId })

    expect(refreshed.source.sourceId).toBe(registered.source.sourceId)
    expect(refreshed.source.imageRef.path).toBe('E:\\moved\\paper.png')
    expect(refreshed.source.alignment.opacity).toBe(0.38)
  })

  it('reconnects a strongly matching legacy source to its asset and preserves correction', () => {
    const legacyRegistered = registerSheetSource(createDefaultProject(), {
      name: 'legacy.png', size: 20, lastModified: 4, contentHash: 'sha256:legacy',
    })
    const corrected = updateSheetPageViewState(
      assignSheetSourceToPage(legacyRegistered.project, 'page_1', legacyRegistered.source.sourceId),
      'page_1',
      { alignment: { opacity: 0.44 } },
    )
    const asset = registerAsset(corrected, {
      name: 'legacy.png', size: 20, lastModified: 4, contentHash: 'sha256:legacy',
    }, { role: 'timesheet-scan' })

    const reconnected = registerSheetSource(asset.project, {
      name: 'legacy.png', size: 20, lastModified: 4, contentHash: 'sha256:legacy',
    }, { assetId: asset.asset.assetId })

    expect(reconnected.source.sourceId).toBe(legacyRegistered.source.sourceId)
    expect(reconnected.source.assetId).toBe(asset.asset.assetId)
    expect(reconnected.source.alignment.opacity).toBe(0.44)
    expect(reconnected.project.sheetView.sources).toHaveLength(1)
  })

  it('moves a source off its previous page when it is assigned elsewhere', () => {
    const first = registerSheetSource(createDefaultProject(), { name: 'first.png' })
    const second = registerSheetSource(first.project, { name: 'second.png' })
    let project = assignSheetSourceToPage(second.project, 'page_1', first.source.sourceId)
    project = updateSheetPageViewState(project, 'page_1', {
      alignment: {
        opacity: 0.42,
        x: 0.13,
        levelCorrection: { enabled: true, inputBlack: 8, inputWhite: 242, gamma: 0.8 },
      },
    })
    project = assignSheetSourceToPage(project, 'page_2', second.source.sourceId)

    const moved = assignSheetSourceToPage(project, 'page_3', first.source.sourceId)

    expect(moved.sheetView.pages.find(page => page.pageId === 'page_1')?.sourceId).toBeUndefined()
    expect(moved.sheetView.pages.find(page => page.pageId === 'page_2')?.sourceId).toBe(second.source.sourceId)
    expect(moved.sheetView.pages.find(page => page.pageId === 'page_3')?.sourceId).toBe(first.source.sourceId)
    expect(moved.sheetView.sources.find(source => source.sourceId === first.source.sourceId)?.assignedPageId).toBe('page_3')
    expect(moved.sheetView.sources.find(source => source.sourceId === first.source.sourceId)?.alignment).toMatchObject({
      opacity: 0.42,
      x: 0.13,
      levelCorrection: { enabled: true, inputBlack: 8, inputWhite: 242, gamma: 0.8 },
    })
    expect(moved.sheetView.pages.find(page => page.pageId === 'page_3')?.alignment).toEqual(
      moved.sheetView.sources.find(source => source.sourceId === first.source.sourceId)?.alignment,
    )
    expect(sheetSourceValidationIssues(moved)).toEqual([])
  })

  it('retains source correction while unassigned and restores it on another page', () => {
    const registered = registerSheetSource(createDefaultProject(), { name: 'corrected.png' })
    let project = assignSheetSourceToPage(registered.project, 'page_1', registered.source.sourceId)
    project = updateSheetPageViewState(project, 'page_1', {
      alignment: {
        scale: 1.12,
        corners: {
          tl: { x: 0.04, y: 0.03 },
          tr: { x: 1, y: 0 },
          br: { x: 1, y: 1 },
          bl: { x: 0, y: 1 },
        },
      },
    })

    const unassigned = assignSheetSourceToPage(project, 'page_1', null)
    const reassigned = assignSheetSourceToPage(unassigned, 'page_4', registered.source.sourceId)

    expect(unassigned.sheetView.sources[0]?.alignment).toMatchObject({ scale: 1.12, corners: { tl: { x: 0.04, y: 0.03 } } })
    expect(reassigned.sheetView.pages.find(page => page.pageId === 'page_4')?.alignment).toMatchObject({
      scale: 1.12,
      corners: { tl: { x: 0.04, y: 0.03 } },
    })
  })

  it('clears one page while preserving assigned pages on both sides of the gap', () => {
    const first = registerSheetSource(createDefaultProject(), { name: 'first.png' })
    const second = registerSheetSource(first.project, { name: 'second.png' })
    const third = registerSheetSource(second.project, { name: 'third.png' })
    let project = assignSheetSourceToPage(third.project, 'page_1', first.source.sourceId)
    project = assignSheetSourceToPage(project, 'page_2', second.source.sourceId)
    project = assignSheetSourceToPage(project, 'page_3', third.source.sourceId)

    const cleared = assignSheetSourceToPage(project, 'page_2', null)

    expect(cleared.sheetView.pages.find(page => page.pageId === 'page_1')?.sourceId).toBe(first.source.sourceId)
    expect(cleared.sheetView.pages.find(page => page.pageId === 'page_2')?.sourceId).toBeUndefined()
    expect(cleared.sheetView.pages.find(page => page.pageId === 'page_3')?.sourceId).toBe(third.source.sourceId)
    expect(cleared.sheetView.sources.find(source => source.sourceId === second.source.sourceId)?.assignedPageId).toBeUndefined()
    expect(sheetSourceValidationIssues(cleared)).toEqual([])
  })

  it('deletes a registered source and clears every page reference to it', () => {
    const assetRegistered = registerAsset(createDefaultProject(), { name: 'duplicate.png' }, { role: 'timesheet-scan' })
    const registered = registerSheetSource(assetRegistered.project, { name: 'duplicate.png' }, { assetId: assetRegistered.asset.assetId })
    let project = assignSheetSourceToPage(registered.project, 'page_1', registered.source.sourceId)
    project = duplicateSheetSourceOnPage(project, 'page_3', registered.source.sourceId)
    expect(sheetSourceValidationIssues(project).map(issue => issue.code)).toContain('sheet.source.duplicatePageAssignment')

    const removed = removeSheetSource(project, registered.source.sourceId)

    expect(removed.sheetView.sources.some(source => source.sourceId === registered.source.sourceId)).toBe(false)
    expect(removed.sheetView.pages.find(page => page.pageId === 'page_1')?.sourceId).toBeUndefined()
    expect(removed.sheetView.pages.find(page => page.pageId === 'page_3')?.sourceId).toBeUndefined()
    expect(removed.assets).toEqual(project.assets)
    expect(sheetSourceValidationIssues(removed)).toEqual([])
  })

  it('lifts legacy page correction into its assigned source during migration', () => {
    const registered = registerSheetSource(createDefaultProject(), { name: 'legacy.png' })
    let legacy = assignSheetSourceToPage(registered.project, 'page_1', registered.source.sourceId)
    legacy = updateSheetPageViewState(legacy, 'page_1', { alignment: { opacity: 0.37, y: -0.08 } })
    legacy = {
      ...legacy,
      sheetView: {
        ...legacy.sheetView,
        sources: legacy.sheetView.sources.map(source => {
          const oldSource: Partial<SheetSource> = { ...source }
          delete oldSource.alignment
          return oldSource as unknown as SheetSource
        }),
      },
    }

    const migrated = migrateProject(JSON.parse(JSON.stringify(legacy)))

    expect(migrated.sheetView.sources[0]?.alignment).toMatchObject({ opacity: 0.37, y: -0.08 })
    expect(migrated.sheetView.pages[0]?.alignment).toEqual(migrated.sheetView.sources[0]?.alignment)
  })

  it('preserves duplicate legacy page assignments by cloning the source per page', () => {
    const registered = registerSheetSource(createDefaultProject(), { name: 'duplicated.png' })
    const sourceId = registered.source.sourceId
    const assigned = assignSheetSourceToPage(registered.project, 'page_1', sourceId)
    const legacy = duplicateSheetSourceOnPage(assigned, 'page_3', sourceId)
    legacy.sheetView.sources[0]!.assignedPageId = 'page_3'

    const migrated = migrateProject(JSON.parse(JSON.stringify(legacy)))

    const migratedPage1SourceId = migrated.sheetView.pages.find(page => page.pageId === 'page_1')?.sourceId
    expect(migratedPage1SourceId).toBeTruthy()
    expect(migratedPage1SourceId).not.toBe(sourceId)
    expect(migrated.sheetView.pages.find(page => page.pageId === 'page_3')?.sourceId).toBe(sourceId)
    expect(migrated.sheetView.sources).toHaveLength(2)
    expect(migrated.sheetView.sources.find(source => source.sourceId === sourceId)?.assignedPageId).toBe('page_3')
    expect(migrated.sheetView.sources.find(source => source.sourceId === migratedPage1SourceId)?.assignedPageId).toBe('page_1')
    expect(sheetSourceValidationIssues(migrated)).toEqual([])
  })
})

function sheetSourceValidationIssues(project: ReturnType<typeof createDefaultProject>) {
  return validateProject(project).filter(issue => issue.code.startsWith('sheet.source.'))
}

function duplicateSheetSourceOnPage(project: ReturnType<typeof createDefaultProject>, pageId: string, sourceId: string) {
  const assignedPage = project.sheetView.pages.find(page => page.sourceId === sourceId)
  if (!assignedPage) throw new Error('assigned source page not found')
  return {
    ...project,
    sheetView: {
      ...project.sheetView,
      pages: [...project.sheetView.pages.filter(page => page.pageId !== pageId), { ...assignedPage, pageId }],
    },
  }
}
