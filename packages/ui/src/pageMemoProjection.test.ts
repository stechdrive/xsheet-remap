import { describe, expect, it } from 'vitest'
import {
  addAnnotation,
  createAlphabeticTrackLabels,
  createDefaultProject,
  createSheetPages,
  digitalStandardSheetTemplate,
  logicalSheetDisplayDurationFrames,
  standardA3SheetTemplate,
} from '@xsheet-remap/core'
import {
  pageMemoRenderItemsForPage,
  resolveTemplateMemoTargetGeometry,
  templateMemoTargetGeometries,
} from './pageMemoProjection'

const defaultOptions = {
  paperTracks: createDefaultProject().logicalSheet.paperTracks.map(track => track.paperTrack),
  durationFrames: 144,
}

describe('page memo projection', () => {
  it('projects logical metadata and memo targets onto the active template', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144)[0]!
    const a3Targets = templateMemoTargetGeometries(standardA3SheetTemplate, defaultOptions)
    const digitalTargets = templateMemoTargetGeometries(digitalStandardSheetTemplate, defaultOptions)
    const a3Memo = targetByLogicalId(a3Targets, 'memo:main')
    const digitalMemo = targetByLogicalId(digitalTargets, 'memo:main')
    const a3Title = targetByLogicalId(a3Targets, 'metadata:title')
    const digitalTitle = targetByLogicalId(digitalTargets, 'metadata:title')
    let project = createDefaultProject()
    project = addAnnotation(project, {
      annotationId: 'memo_ink',
      pageId: page.pageId,
      tool: 'pen',
      color: '#123456',
      width: 0.004,
      coordinateSpace: 'memo-target',
      anchor: {
        kind: 'view-surface',
        pageId: page.pageId,
        templateId: standardA3SheetTemplate.templateId,
        regionId: a3Memo.regionId,
        targetId: a3Memo.targetId,
        logicalTargetId: a3Memo.logicalTargetId,
      },
      points: [{ x: -0.02, y: 0.03 }, { x: 0.08, y: 0.06 }],
    })
    project = addAnnotation(project, {
      annotationId: 'title_text',
      pageId: page.pageId,
      kind: 'text',
      text: 'CHECK',
      x: 0.01,
      y: 0.02,
      color: '#123456',
      fontSizePx: 18,
      coordinateSpace: 'memo-target',
      anchor: {
        kind: 'view-surface',
        pageId: page.pageId,
        templateId: standardA3SheetTemplate.templateId,
        regionId: a3Title.regionId,
        targetId: a3Title.targetId,
        logicalTargetId: a3Title.logicalTargetId,
      },
    })

    const a3 = pageMemoRenderItemsForPage(project, page, a3Targets)
    const digital = pageMemoRenderItemsForPage(project, page, digitalTargets)

    expect(a3.strokes[0]?.points[0]).toMatchObject({
      x: a3Memo.rect.x - 0.02,
      y: a3Memo.rect.y + 0.03,
    })
    expect(digital.strokes[0]?.points[0]).toMatchObject({
      x: digitalMemo.rect.x - 0.02,
      y: digitalMemo.rect.y + 0.03,
    })
    expect(a3.texts[0]).toMatchObject({
      x: a3Title.rect.x + 0.01,
      y: a3Title.rect.y + 0.02,
    })
    expect(digital.texts[0]).toMatchObject({
      x: digitalTitle.rect.x + 0.01,
      y: digitalTitle.rect.y + 0.02,
    })
    expect(digital.strokes[0]?.target?.regionId).toBe('digital_memo_area')
    expect(digital.texts[0]?.target?.regionId).toBe('digital_metadata_form')
  })

  it('leaves page-target annotations fixed while template geometry changes', () => {
    const project = createDefaultProject()
    const page = createSheetPages(
      standardA3SheetTemplate,
      logicalSheetDisplayDurationFrames(project.logicalSheet),
    )[0]!
    const withPageInk = addAnnotation(project, {
      annotationId: 'page_ink',
      pageId: page.pageId,
      tool: 'pen',
      color: '#111111',
      width: 0.004,
      coordinateSpace: 'view-surface',
      anchor: { kind: 'view-surface', pageId: page.pageId },
      points: [{ x: 0.25, y: 0.35 }, { x: 0.5, y: 0.6 }],
    })

    const a3 = pageMemoRenderItemsForPage(
      withPageInk,
      page,
      templateMemoTargetGeometries(standardA3SheetTemplate, defaultOptions),
    )
    const digital = pageMemoRenderItemsForPage(
      withPageInk,
      page,
      templateMemoTargetGeometries(digitalStandardSheetTemplate, defaultOptions),
    )

    expect(a3.strokes[0]?.points).toEqual(withPageInk.memos[0]?.kind === 'page'
      ? withPageInk.memos[0].strokes[0]?.points
      : undefined)
    expect(digital.strokes[0]?.points).toEqual(a3.strokes[0]?.points)
    expect(digital.strokes[0]?.target).toBeNull()
  })

  it('resolves current dynamic form geometry without changing target identity', () => {
    const compact = templateMemoTargetGeometries(digitalStandardSheetTemplate, defaultOptions)
    const wide = templateMemoTargetGeometries(digitalStandardSheetTemplate, {
      ...defaultOptions,
      paperTracks: createAlphabeticTrackLabels(12),
    })
    const source = targetByLogicalId(compact, 'metadata:worker')
    const resolved = resolveTemplateMemoTargetGeometry({
      kind: 'template-region',
      templateId: standardA3SheetTemplate.templateId,
      regionId: 'top_worker_field',
      logicalTargetId: 'metadata:worker',
    }, wide)

    expect(resolved?.logicalTargetId).toBe('metadata:worker')
    expect(resolved?.regionId).toBe('digital_metadata_form')
    expect(resolved?.rect.x).not.toBe(source.rect.x)
  })

  it('does not paint a template target that the active template cannot resolve', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144)[0]!
    const project = addAnnotation(createDefaultProject(), {
      annotationId: 'missing_target',
      pageId: page.pageId,
      tool: 'pen',
      color: '#111111',
      width: 0.004,
      coordinateSpace: 'memo-target',
      anchor: {
        kind: 'view-surface',
        pageId: page.pageId,
        logicalTargetId: 'missing:target',
        regionId: 'missing_region',
      },
      points: [{ x: 0, y: 0 }],
    })

    expect(pageMemoRenderItemsForPage(
      project,
      page,
      templateMemoTargetGeometries(standardA3SheetTemplate, defaultOptions),
    ).strokes).toEqual([])
  })
})

function targetByLogicalId<T extends { logicalTargetId: string }>(
  targets: readonly T[],
  logicalTargetId: string,
): T {
  const target = targets.find(candidate => candidate.logicalTargetId === logicalTargetId)
  if (!target) throw new Error(`memo target not found: ${logicalTargetId}`)
  return target
}
