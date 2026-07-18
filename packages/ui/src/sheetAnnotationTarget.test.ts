import { createDefaultProject, createSheetPages, createTimedRangeCue, standardA3SheetTemplate } from '@xsheet-remap/core'
import { describe, expect, it } from 'vitest'
import { resolveSheetAnnotationTarget } from './sheetAnnotationTarget'

const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!

describe('sheet annotation target resolution', () => {
  it('prefers an existing SOUND/CAMERA cue over page and region targets', () => {
    const created = createTimedRangeCue(createDefaultProject(), {
      role: 'sound', laneId: 'sound_lane_1', frameStart: 10, frameEnd: 15, label: '話者',
    })
    const target = resolveSheetAnnotationTarget({
      activeMemo: null,
      selectedCue: created.cue,
      selectedHit: null,
      rangeSelection: null,
      selectedRegion: { kind: 'template-region', pageId: page.pageId, templateId: standardA3SheetTemplate.templateId, regionId: 'top_memo_area', label: 'MEMO' },
      activePage: page,
      cues: created.project.timedRangeCues,
    })
    expect(target).toMatchObject({ kind: 'timed-cue', label: 'SOUND「話者」 10-15F' })
  })

  it('uses a selected template region before the page fallback', () => {
    const target = resolveSheetAnnotationTarget({
      activeMemo: null,
      selectedCue: null,
      selectedHit: null,
      rangeSelection: null,
      selectedRegion: { kind: 'template-region', pageId: page.pageId, templateId: standardA3SheetTemplate.templateId, regionId: 'top_memo_area', label: 'MEMO' },
      activePage: page,
      cues: [],
    })
    expect(target).toMatchObject({ kind: 'template-region', label: 'MEMO' })
  })
})
