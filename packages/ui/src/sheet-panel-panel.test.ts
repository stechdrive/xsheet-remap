import { createDefaultProject, standardA3SheetTemplate } from '@xsheet-remap/core'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  isSelectedTextMemoTargetUnavailable,
  resolveSelectedTemplateRegionAnnotationTarget,
  templateRegionAnnotationTargetIdentity,
  useCurrentTemplateMemoTargetGeometries,
} from './sheet-panel-panel'

describe('SheetPanel template-region annotation selection', () => {
  it('stores only target identity and resolves the current geometry by logical target', () => {
    const identity = templateRegionAnnotationTargetIdentity({
      kind: 'template-region',
      pageId: 'page_1',
      templateId: standardA3SheetTemplate.templateId,
      regionId: 'top_memo_area',
      logicalTargetId: 'memo:main',
      rect: { x: 0.02, y: 0.1, w: 0.5, h: 0.2 },
      label: 'old label',
    })
    expect(identity).not.toHaveProperty('rect')
    expect(identity).not.toHaveProperty('label')

    const movedRect = { x: 0.31, y: 0.24, w: 0.42, h: 0.18 }
    const resolved = resolveSelectedTemplateRegionAnnotationTarget(
      identity,
      'page_1',
      standardA3SheetTemplate,
      [{
        regionId: 'replacement_memo_area',
        logicalTargetId: 'memo:main',
        label: 'current label',
        rect: movedRect,
      }],
    )

    expect(resolved).toEqual({
      unavailable: false,
      target: expect.objectContaining({
        pageId: 'page_1',
        regionId: 'replacement_memo_area',
        logicalTargetId: 'memo:main',
        rect: movedRect,
      }),
    })
  })

  it('marks a missing target unavailable only while its original page and template remain active', () => {
    const identity = templateRegionAnnotationTargetIdentity({
      kind: 'template-region',
      pageId: 'page_1',
      templateId: standardA3SheetTemplate.templateId,
      regionId: 'top_memo_area',
      logicalTargetId: 'memo:main',
      rect: { x: 0.02, y: 0.1, w: 0.5, h: 0.2 },
      label: 'MEMO',
    })

    expect(resolveSelectedTemplateRegionAnnotationTarget(
      identity,
      'page_1',
      standardA3SheetTemplate,
      [],
    )).toEqual({ target: null, unavailable: true })
    expect(resolveSelectedTemplateRegionAnnotationTarget(
      identity,
      'page_2',
      standardA3SheetTemplate,
      [],
    )).toEqual({ target: null, unavailable: false })
  })

  it('reuses target geometry across memo-only project renders', () => {
    const project = createDefaultProject()
    const { result, rerender } = renderHook(
      ({ currentProject }) => useCurrentTemplateMemoTargetGeometries(
        standardA3SheetTemplate,
        currentProject,
      ),
      { initialProps: { currentProject: project } },
    )
    const initialGeometries = result.current
    const memoOnlyProject = {
      ...project,
      memos: [{
        kind: 'page' as const,
        memoId: 'memo_test',
        target: { kind: 'page' as const, pageId: 'page_1' },
        strokes: [],
        texts: [],
        order: 0,
      }],
    }

    rerender({ currentProject: memoOnlyProject })

    expect(result.current).toBe(initialGeometries)
  })

  it('blocks a selected target-relative text memo only while its target is unavailable', () => {
    expect(isSelectedTextMemoTargetUnavailable(
      'text_1',
      { coordinateSpace: 'memo-target' },
      null,
    )).toBe(true)
    expect(isSelectedTextMemoTargetUnavailable(
      'text_1',
      { coordinateSpace: 'memo-target' },
      { regionId: 'top_memo_area' },
    )).toBe(false)
    expect(isSelectedTextMemoTargetUnavailable(
      'text_1',
      { coordinateSpace: 'view-surface' },
      null,
    )).toBe(false)
  })
})
