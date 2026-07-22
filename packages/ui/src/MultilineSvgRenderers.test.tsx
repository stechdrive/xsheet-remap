import { createDefaultProject, standardA3SheetTemplate, updateSheetFormField, type AnnotationText } from '@xsheet-remap/core'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createSheetRenderModelContext } from './sheetRenderModel'
import { MetadataTextLayer } from './sheet-layers-calibration-render'
import { AnnotationSvgText } from './sheet-panel-annotation'

describe('multiline SVG renderers', () => {
  it('keeps a blank line in a template-defined A3 multiline field', () => {
    const memo = { fieldId: 'memo.body', scope: 'page' as const, valueType: 'multiline' as const }
    const project = updateSheetFormField(createDefaultProject(), memo, 'first\n\nthird', 'page_1')
    const context = createSheetRenderModelContext(project, standardA3SheetTemplate)
    const { container } = render(
      <svg>
        <MetadataTextLayer context={context} page={context.pages[0]!} />
      </svg>,
    )
    const memoText = [...container.querySelectorAll<SVGTextElement>('.metadataFieldText')]
      .find(text => text.textContent === 'firstthird')
    const lines = [...(memoText?.querySelectorAll('tspan') ?? [])]
    const positions = lines.map(line => Number(line.getAttribute('y')))

    expect(lines.map(line => line.textContent)).toEqual(['first', '', 'third'])
    expect(positions[1] - positions[0]).toBeGreaterThan(0)
    expect(positions[2] - positions[1]).toBeCloseTo(positions[1] - positions[0])
  })

  it('keeps a blank line in annotation SVG rendering', () => {
    const annotation: AnnotationText = {
      annotationId: 'annotation_1',
      pageId: 'page_1',
      kind: 'text',
      text: 'first\n\nthird',
      x: 0.2,
      y: 0.3,
      color: '#123456',
      fontSizePx: 20,
    }
    const { container } = render(
      <svg>
        <AnnotationSvgText annotation={annotation} pageSize={{ widthPx: 1000, heightPx: 2000 }} />
      </svg>,
    )
    const lines = [...container.querySelectorAll('tspan')]

    expect(lines.map(line => line.textContent)).toEqual(['first', '', 'third'])
    expect(lines.map(line => line.getAttribute('y'))).toEqual(['600', '625', '650'])
  })
})
