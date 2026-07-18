import { describe, expect, it } from 'vitest'
import { addAnnotation } from './annotations'
import { createDefaultProject } from './project-model'
import { createProjectDocumentFromCutProject, migrateProject, parseProjectDocument } from './project-documents'
import {
  memoAnchorPresentation,
  sheetAnnotations,
  sheetPageMemos,
  timelineMemos,
} from './sheet-memo'
import { addTimelineMemo } from './timeline-memo'

describe('sheet memo model', () => {
  it('keeps page ink and text in one page-target memo', () => {
    const pageInk = {
      annotationId: 'ink_1', pageId: 'page_1', kind: 'stroke' as const, tool: 'pen' as const,
      color: '#111', width: 0.004, points: [{ x: 0.1, y: 0.2 }],
    }
    const pageText = {
      annotationId: 'text_1', pageId: 'page_1', kind: 'text' as const, text: 'NOTE',
      x: 0.2, y: 0.3, color: '#111', fontSizePx: 18,
    }
    const project = addAnnotation(addAnnotation(createDefaultProject(), pageInk), pageText)

    expect(sheetPageMemos(project)).toHaveLength(1)
    expect(sheetPageMemos(project)[0]).toMatchObject({
      kind: 'page',
      target: { kind: 'page', pageId: 'page_1' },
      strokes: [{ annotationId: 'ink_1' }],
      texts: [{ annotationId: 'text_1' }],
    })
    expect(sheetAnnotations(project).map(annotation => annotation.annotationId)).toEqual(['ink_1', 'text_1'])
  })

  it('migrates legacy arrays on read and writes only the canonical memos field', () => {
    const migrated = migrateProject({
      projectId: 'legacy_memos',
      annotations: [{
        annotationId: 'legacy_ink', pageId: 'page_1', tool: 'pen', color: '#111', width: 0.004,
        points: [{ x: 0.1, y: 0.2 }],
      }],
      timelineMemos: [{
        memoId: 'legacy_timeline',
        anchor: { role: 'camera', frame: 12, laneId: 'camera_lane_1' },
        placement: { frameOffset: 0, crossOffsetUnits: 0, widthUnits: 8, heightFrames: 8 },
        strokes: [],
        order: 2,
      }],
    })
    const document = parseProjectDocument(createProjectDocumentFromCutProject(migrated))
    const revision = document.cuts[0]!.revisions[0]!

    expect(revision.memos).toHaveLength(2)
    expect('annotations' in revision).toBe(false)
    expect('timelineMemos' in revision).toBe(false)
    expect(timelineMemos(migrated)[0]?.kind).toBe('timeline')
  })

  it('derives anchor visuals from the target instead of persisting a connector flag', () => {
    const base = createDefaultProject()
    const action = addTimelineMemo(base, {
      kind: 'timeline', memoId: 'action_note', anchor: { role: 'action', frame: 1, paperTrack: 'A' },
      placement: { frameOffset: 0, crossOffsetUnits: 0, widthUnits: 8, heightFrames: 8 }, strokes: [], order: 1,
    })
    const camera = addTimelineMemo(action, {
      kind: 'timeline', memoId: 'camera_note', anchor: { role: 'camera', frame: 1, laneId: 'camera_lane_1' },
      placement: { frameOffset: 0, crossOffsetUnits: 0, widthUnits: 8, heightFrames: 8 }, strokes: [], order: 2,
    })

    expect(memoAnchorPresentation(sheetPageMemos(addAnnotation(base, {
      annotationId: 'page_ink', pageId: 'page_1', tool: 'pen', color: '#111', width: 0.004, points: [{ x: 0, y: 0 }],
    }))[0]!)).toBe('none')
    expect(memoAnchorPresentation(timelineMemos(camera)[0]!)).toBe('marker')
    expect(memoAnchorPresentation(timelineMemos(camera)[1]!)).toBe('camera-connector')
  })
})
