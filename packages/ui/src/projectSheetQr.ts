import { timelineMemos, type CutProject, type NormalizedRect, type SheetPage } from '@xsheet-remap/core'
import { sheetQrCandidates, sheetQrRuns, SHEET_LINK_PREFIX, type SheetQrCandidate } from '@xsheet-remap/adapters'
import { annotationTextLines, annotationVerticalLayout, resolveAnnotationTextFontSizePx } from './annotationTextLayout'
import { indexSheetPageMemosByPage, pageMemoCanvasRenderItemsForIndexedPage, templateMemoTargetGeometries } from './pageMemoProjection'
import { metadataTextRenderItemsForPage, type SheetRenderModelContext } from './sheetRenderModel'
import type { SheetTemplateBranding } from './sheetTemplateBranding'
import type { TemplateChromeRenderModel } from './templateEditorGeometry'
import { sharedTextMeasurementProvider, SHEET_TEXT_FONT_FAMILY } from './textMetrics'
import { timelineMemoSegmentsForPage } from './timelineMemoGeometry'

type Rect = NormalizedRect
type Size = { widthPx: number; heightPx: number }
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
const px = (r: Rect, s: Size) => ({ x: r.x * s.widthPx, y: r.y * s.heightPx, w: r.w * s.widthPx, h: r.h * s.heightPx })
const normalize = (r: Rect, s: Size) => ({ x: r.x / s.widthPx, y: r.y / s.heightPx, w: r.w / s.widthPx, h: r.h / s.heightPx })

/** Measure the same lines, projected pen paths and memo panels that are printed. All
 * collision tests use page pixels and include a small clearance outside the quiet zone. */
function occupiedMemoRects(context: SheetRenderModelContext, project: CutProject, page: SheetPage, body: Rect) {
  const size = context.pageSize, occupied: Rect[] = []
  const add = (x: number, y: number, w: number, h: number) => {
    const rect = { x: x - 3, y: y - 3, w: w + 6, h: h + 6 }
    if (intersects(body, rect)) occupied.push(rect)
  }
  const width = (line: string, sizePx: number, weight: number) =>
    sharedTextMeasurementProvider.measure(line, { family: SHEET_TEXT_FONT_FAMILY, sizePx, weight }).widthPx
  for (const item of metadataTextRenderItemsForPage(context, page)) {
    for (const [i, line] of item.lines.entries()) {
      if (!line.trim()) continue
      const w = width(line, item.fontSizePx, item.fontWeight), h = item.fontSizePx * 1.15
      const x = item.x * size.widthPx - (item.textAnchor === 'end' ? w : item.textAnchor === 'middle' ? w / 2 : 0)
      const y = item.y * size.heightPx + i * item.lineHeightPx - (item.dominantBaseline === 'text-after-edge' ? h : item.dominantBaseline === 'central' ? h / 2 : 0)
      add(x, y, w, h)
    }
  }
  if (!project.memos.length) return occupied
  const options = { paperTracks: context.paperTracks, timelineLanes: context.timelineLanes, layoutOverrides: project.sheetView.layoutOverrides }
  const targets = templateMemoTargetGeometries(context.template, { ...options, durationFrames: context.displayDurationFrames })
  const items = pageMemoCanvasRenderItemsForIndexedPage(indexSheetPageMemosByPage(project), page, targets)
  for (const { points, projectionOffset, stroke } of items.strokes) {
    const radius = Math.max(1, stroke.width * Math.min(size.widthPx, size.heightPx)) / 2
    for (let i = 0; i < points.length; i++) {
      const a = points[Math.max(0, i - 1)]!, b = points[i]!
      add((Math.min(a.x, b.x) + projectionOffset.x) * size.widthPx - radius, (Math.min(a.y, b.y) + projectionOffset.y) * size.heightPx - radius,
        Math.abs(a.x - b.x) * size.widthPx + 2 * radius, Math.abs(a.y - b.y) * size.heightPx + 2 * radius)
    }
  }
  for (const item of items.texts) {
    const a = item.annotation, font = resolveAnnotationTextFontSizePx(a, size)
    if (a.writingMode === 'vertical') {
      for (const glyph of annotationVerticalLayout(a, size, item).glyphs) add(glyph.xPx - font / 2, glyph.yPx - font, font, font * 1.15)
    } else {
      for (const [i, line] of annotationTextLines(a.text).entries()) if (line.trim()) {
        add(item.x * size.widthPx, item.y * size.heightPx + i * font * 1.25, width(line, font, 700), font * 1.2)
      }
    }
  }
  for (const memo of timelineMemos(project)) {
    for (const segment of timelineMemoSegmentsForPage(context.template, page, memo, options)) {
      const r = px(segment.rect, size)
      add(r.x, r.y, r.w, r.h)
    }
  }
  return occupied
}

function freeCorner(body: Rect, modules: number, occupied: Rect[], pitch: number) {
  // A finder pattern is seven modules wide. Keep it close to a whole
  // number of pixels even when the memo is too shallow for an integer pitch.
  for (let finderPixels = pitch * 7; finderPixels >= 11; finderPixels--) {
    const side = Math.round(modules * finderPixels / 7) - (finderPixels % 7 ? 1 : 0), gap = 5
    if (side + 2 * gap > Math.min(body.w, body.h)) continue
    const left = Math.ceil(body.x + gap), right = Math.floor(body.x + body.w - gap - side)
    const top = Math.ceil(body.y + gap), bottom = Math.floor(body.y + body.h - gap - side)
    for (const [x, y] of [[right, bottom], [left, bottom], [right, top], [left, top]] as const) {
      const candidate = { x, y, w: side, h: side }
      if (!occupied.some(rect => intersects(rect, candidate))) return candidate
    }
  }
}

function renderQr(candidate: SheetQrCandidate, area: Rect, size: Size, base: SheetTemplateBranding): SheetTemplateBranding {
  const unit = area.w / candidate.modules
  const edge = (i: number) => Math.round(i * unit)
  const number = (n: number) => Number(n.toFixed(9))
  const path = sheetQrRuns(candidate).map(run => {
    const x = edge(run.x), y = edge(run.y), w = number((edge(run.x + run.width) - x) / size.widthPx), h = number((edge(run.y + 1) - y) / size.heightPx)
    return 'M' + number((area.x + x) / size.widthPx) + ' ' + number((area.y + y) / size.heightPx) + 'h' + w + 'v' + h + 'h' + (-w) + 'z'
  }).join('')
  return { ...base, url: SHEET_LINK_PREFIX + candidate.digits, qrRect: normalize(area, size), qrPath: path }
}

export function withProjectSheetQr(chrome: TemplateChromeRenderModel, context: SheetRenderModelContext, project: CutProject, page: SheetPage): TemplateChromeRenderModel {
  const base = chrome.branding
  if (!base) return chrome
  const size = context.pageSize, top = px(base.qrRect, size), pitch = context.template.layoutMode === 'infinite-digital' ? 3 : 2
  const memo = chrome.formFields.find(field => field.fieldId === 'memo.body')?.rect
  const body = memo && px(memo, size)
  const sourceId = project.sheetView.pages.find(p => p.pageId === page.pageId)?.sourceId
  const scan = sourceId && project.sheetView.sources.some(s => s.sourceId === sourceId && s.kind === 'sheet-scan')
  let occupied: Rect[] | undefined, hadCandidate = false
  for (const candidates of sheetQrCandidates(project, context.template, page, context.pages.length, context.cutGroup?.activeCutId)) {
    hadCandidate = true
    for (const candidate of candidates) {
      if (top.w / candidate.modules < pitch * .75) continue
      // A3's original square is 74 px. A version 6 symbol needs 98 px to
      // keep two complete raster pixels per module, including its quiet zone.
      const stride = Math.max(2, Math.floor(top.w / candidate.modules)), side = candidate.modules * stride
      const y = Math.round(top.y + (top.h - side) / 2)
      let x = Math.round(top.x + (top.w - side) / 2)
      for (const field of chrome.formFields) {
        const r = px(field.rect, size)
        if (r.x < top.x && r.y < y + side && r.y + r.h > y) x = Math.max(x, Math.ceil(r.x + r.w + 3))
      }
      if (x + side > size.widthPx - 16 || y < 0) continue
      return { ...chrome, branding: renderQr(candidate, { x, y, w: side, h: side }, size, base) }
    }
    if (body && !scan) {
      occupied ??= occupiedMemoRects(context, project, page, body)
      for (const candidate of candidates) {
        const area = freeCorner(body, candidate.modules, occupied, pitch)
        if (area) return { ...chrome, branding: renderQr(candidate, area, size, base) }
      }
    }
  }
  return { ...chrome, branding: { ...base, url: '', qrPath: '', warning: hadCandidate ? 'QR空き不足' : 'QR容量超過' } }
}
