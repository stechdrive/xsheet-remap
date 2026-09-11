import type { NormalizedRect } from '@xsheet-remap/core'
import type { TemplateChromeRenderModel, TemplateGridOverlayRenderModel } from './templateEditorGeometry'
import type { DirectPaperModel, PaperPrimitive, PaperStyleSample } from './canvasKitDirectModel'

const rect = (r: NormalizedRect): PaperPrimitive['shape'] => ({ kind: 'rect', rect: { x: r.x, y: r.y, width: r.w, height: r.h }, rx: 0, ry: 0 })
const lineStyle = (style: { color: string; widthPx: number; dashPx: number[] }) => ({
  fill: 'none', stroke: style.color, strokeWidth: `${style.widthPx}px`,
  strokeDasharray: style.dashPx.length ? style.dashPx.map(value => `${value}px`).join(' ') : undefined,
  vectorEffect: 'non-scaling-stroke' as const,
})

export function templateChromePaperModel(model: TemplateChromeRenderModel, showLines: boolean, showLabels: boolean): DirectPaperModel {
  const styles: Record<string, PaperStyleSample> = {
    outer: { tag: 'rect', className: 'templateOuterFrame', style: { stroke: model.theme.ink.lines.outer } },
    reference: { tag: 'rect', className: 'templateReferenceBox', style: { stroke: model.theme.ink.reference } },
    header: { tag: 'rect', className: 'templateHeaderBox', style: { fill: 'none', stroke: model.theme.ink.lines.outer } },
    thin: { tag: 'path', className: 'templateThinLine', style: { stroke: model.theme.ink.lines.thin } },
    label: { tag: 'text', className: 'templateFormLabel', style: { fill: model.theme.ink.text } },
    title: { tag: 'text', className: 'templateHeaderText', style: { fill: model.theme.ink.text } },
    column: { tag: 'text', className: 'templateColumnText', style: { fill: model.theme.ink.text } },
  }
  const primitives: PaperPrimitive[] = []
  if (showLines) {
    if (model.showOuterFrame) primitives.push({ style: 'outer', shape: rect({ x: 0.02, y: 0.019, w: 0.96, h: 0.952 }) })
    for (const region of model.referenceRegions) primitives.push({ style: 'reference', shape: rect(region.rect) })
    // Several form boxes share the same pen; keep the style samples proportional to distinct pens.
    for (const box of model.formBoxes) {
      const key = `box:${JSON.stringify(box.style)}`
      styles[key] = { tag: 'rect', className: 'templateFormBox', style: lineStyle(box.style) }
      primitives.push({ style: key, shape: rect(box.rect) })
    }
  }
  if (showLabels) for (const label of model.formLabels) primitives.push({ style: 'label', text: {
    value: label.text, x: label.x, y: label.y, size: label.fontSizePx, weight: label.fontWeight,
    anchor: label.textAnchor, baseline: label.dominantBaseline,
  } })
  for (const header of model.headers) {
    if (showLines) {
      primitives.push({ style: 'header', shape: rect(header.rect) })
      if (header.columnHeaderRect.h > 0) {
        primitives.push({ style: 'header', shape: rect(header.columnHeaderRect) })
        primitives.push({ style: 'thin', shape: { kind: 'path', d: header.columnBoundaries.map(x => `M ${x} ${header.columnHeaderRect.y} V ${header.columnHeaderRect.y + header.columnHeaderRect.h}`).join(' ') } })
      }
    }
    if (showLabels && header.label) primitives.push({ style: 'title', text: {
      value: header.label, x: header.labelX, y: header.labelY, size: header.labelFontSizePx, anchor: 'middle', baseline: 'middle',
    } })
    if (showLabels) for (const column of header.columns) primitives.push({ style: 'column', text: {
      value: column.label, x: column.x, y: column.y, size: column.fontSizePx, anchor: 'middle', baseline: column.dominantBaseline,
    } })
  }
  return { pageSize: model.pageSize, styles, primitives }
}

export function gridOverlayPaperModel(model: TemplateGridOverlayRenderModel, showLines: boolean, showLabels: boolean): DirectPaperModel {
  const styles: Record<string, PaperStyleSample> = {
    band: { tag: 'rect', className: 'gridSecondBand' },
    label: { tag: 'text', className: 'gridRowGuideLabel', style: { fill: model.theme.ink.text } },
    frame: { tag: 'text', className: 'gridActionFrameNumber', style: { fill: model.theme.ink.text } },
    second: { tag: 'text', className: 'gridSecondCounter', style: { fill: model.theme.ink.text } },
    track: { tag: 'text', className: 'gridBottomTrackLabel', style: { fill: model.theme.ink.text } },
  }
  const primitives: PaperPrimitive[] = []
  if (showLines) {
    for (const band of model.backgroundBands) primitives.push({ style: 'band', shape: rect(band.rect), paint: { fill: band.color }, opacity: band.opacity })
    for (const path of [...model.rowPaths, ...(model.columnPath ? [model.columnPath] : [])]) {
      const key = `line:${path.className}:${JSON.stringify(path.style)}`
      styles[key] = { tag: 'path', className: path.className, style: path.style ? lineStyle(path.style) : undefined }
      primitives.push({ style: key, shape: { kind: 'path', d: path.d } })
    }
  }
  if (showLabels) {
    for (const label of model.labels) primitives.push({ style: 'label', text: {
      value: label.text, x: label.x, y: label.y, size: label.fontSizePx, anchor: label.textAnchor, baseline: 'central',
    } })
    for (const [key, items] of [['frame', model.frameNumbers], ['second', model.secondCounters]] as const) {
      for (const item of items) primitives.push({ style: key, text: {
        value: item.text, x: item.x, y: item.y, size: item.fontSizePx, anchor: item.textAnchor, baseline: 'text-after-edge',
      } })
    }
    for (const item of model.bottomTrackLabels) primitives.push({ style: 'track', opacity: item.opacity, text: {
      value: item.text, x: item.x, y: item.y, size: item.fontSizePx, anchor: 'middle', baseline: 'text-after-edge',
    } })
  }
  return { pageSize: model.pageSize, styles, primitives }
}
