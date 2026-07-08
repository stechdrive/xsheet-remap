import { describe, expect, it } from 'vitest'
import type { AnnotationText } from '@xsheet-remap/core'
import {
  annotationTextCssLayout,
  annotationTextSheetLayout,
  annotationTextSvgFontSize,
  resolveAnnotationTextFontSizePx,
} from './annotationTextLayout'

function textAnnotation(input: Partial<AnnotationText> = {}): AnnotationText {
  return {
    annotationId: 'anno_text_1',
    pageId: 'page_1',
    kind: 'text',
    text: 'memo',
    x: 0.25,
    y: 0.4,
    color: '#234536',
    fontSizePx: 20,
    coordinateSpace: 'view-surface',
    anchor: {
      kind: 'view-surface',
      templateId: 'source-template',
      pageId: 'page_1',
      surfaceSize: { widthPx: 1000, heightPx: 2000 },
    },
    ...input,
  }
}

describe('annotation text layout', () => {
  it('resolves stored font size through the annotation surface anchor', () => {
    const annotation = textAnnotation()

    expect(resolveAnnotationTextFontSizePx(annotation, { widthPx: 1000, heightPx: 2000 })).toBe(20)
    expect(resolveAnnotationTextFontSizePx(annotation, { widthPx: 2000, heightPx: 4000 })).toBe(40)
    expect(annotationTextSvgFontSize(annotation, { widthPx: 2000, heightPx: 4000 })).toBeCloseTo(40 / 4000)
  })

  it('keeps sheet layout separate from viewport zoom', () => {
    const annotation = textAnnotation()
    const pageSize = { widthPx: 1000, heightPx: 2000 }

    const sheetLayout = annotationTextSheetLayout(annotation, pageSize)
    const cssAt100 = annotationTextCssLayout(annotation, pageSize, 1)
    const cssAt200 = annotationTextCssLayout(annotation, pageSize, 2)

    expect(sheetLayout).toMatchObject({ xPx: 250, yPx: 800, fontSizePx: 20 })
    expect(cssAt100).toMatchObject({ leftPx: 250, topPx: 800, fontSizePx: 20 })
    expect(cssAt200).toMatchObject({ leftPx: 500, topPx: 1600, fontSizePx: 40 })
    expect(cssAt200.maxWidthPx).toBe(cssAt100.maxWidthPx * 2)
  })
})
