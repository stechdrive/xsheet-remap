import { describe, expect, it } from 'vitest'
import { resolveSheetInteractionOwner, suppressSheetTooltips } from './sheetInteractionOwnership'

describe('sheet interaction ownership', () => {
  it('gives a page annotation tool exclusive ownership only while it is placing or drawing', () => {
    expect(resolveSheetInteractionOwner({
      editMode: 'pen',
      selectedTimelineMemoId: null,
      editingTextAnnotationId: null,
    })).toBe('page-annotation')
    expect(resolveSheetInteractionOwner({
      editMode: 'text',
      selectedTimelineMemoId: null,
      editingTextAnnotationId: null,
    })).toBe('page-annotation')
  })

  it('keeps timeline memo and page text editing as distinct input owners', () => {
    expect(resolveSheetInteractionOwner({
      editMode: 'pen',
      selectedTimelineMemoId: 'memo_1',
      editingTextAnnotationId: null,
    })).toBe('timeline-memo')
    expect(resolveSheetInteractionOwner({
      editMode: 'text',
      selectedTimelineMemoId: null,
      editingTextAnnotationId: 'annotation_1',
    })).toBe('page-text-editor')
  })

  it('suppresses transient sheet tooltips for every direct annotation mode', () => {
    expect(suppressSheetTooltips('new')).toBe(false)
    expect(suppressSheetTooltips('pen')).toBe(true)
    expect(suppressSheetTooltips('eraser')).toBe(true)
    expect(suppressSheetTooltips('text')).toBe(true)
    expect(suppressSheetTooltips('calibrate')).toBe(false)
  })
})
