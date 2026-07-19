import { describe, expect, it } from 'vitest'
import {
  activeCutProjectFromDocument,
  addBlankSharedCutToProjectDocument,
  createDefaultProject,
  createOrSetEvent,
  createProjectDocumentFromCutProject,
  deleteSharedCutFromProjectDocument,
} from './project'

describe('shared cut project documents', () => {
  it('deletes a shared cut while preserving the remaining cut order and active edits', () => {
    const first = createOrSetEvent({ ...createDefaultProject(), cut: { title: 'SAMPLE', cut: '001' } }, 'A', 1).project
    let document = createProjectDocumentFromCutProject(first)
    document = addBlankSharedCutToProjectDocument(document, first, { cut: { cut: '002' } })
    const secondCutId = document.activeCutId
    const second = createOrSetEvent(activeCutProjectFromDocument(document), 'B', 12).project
    document = addBlankSharedCutToProjectDocument(document, second, { cut: { cut: '003' } })
    const thirdCutId = document.activeCutId
    const third = createOrSetEvent(activeCutProjectFromDocument(document), 'C', 24).project

    const withoutSecond = deleteSharedCutFromProjectDocument(document, third, secondCutId)
    expect(withoutSecond.cuts.map(cut => [cut.metadata.cut, cut.order])).toEqual([['001', 0], ['003', 1]])
    expect(withoutSecond.activeCutId).toBe(thirdCutId)
    expect(activeCutProjectFromDocument(withoutSecond).logicalSheet.events.some(event => event.paperTrack === 'C' && event.frame === 24)).toBe(true)

    const withoutThird = deleteSharedCutFromProjectDocument(withoutSecond, activeCutProjectFromDocument(withoutSecond), thirdCutId)
    expect(withoutThird.cuts.map(cut => cut.metadata.cut)).toEqual(['001'])
    expect(withoutThird.activeCutId).toBe(withoutThird.cuts[0]!.cutId)
    expect(() => deleteSharedCutFromProjectDocument(withoutThird, activeCutProjectFromDocument(withoutThird), withoutThird.activeCutId))
      .toThrow('最後の兼用カットは削除できません。')
  })
})
