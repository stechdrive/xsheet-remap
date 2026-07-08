import type { AnnotationText } from '@xsheet-remap/core'
import { clampTextFontSizePx } from './sheetTextLayout'

export type AnnotationTextPageSize = {
  widthPx: number
  heightPx: number
}

export type AnnotationTextSheetLayout = {
  xPx: number
  yPx: number
  fontSizePx: number
  maxWidthPx: number
  editorWidthPx: number
  editorHeightPx: number
}

export type AnnotationTextCssLayout = {
  leftPx: number
  topPx: number
  fontSizePx: number
  maxWidthPx: number
  editorWidthPx: number
  editorHeightPx: number
}

const ANNOTATION_TEXT_MIN_BOX_WIDTH_PX = 140
const ANNOTATION_TEXT_MAX_BOX_WIDTH_PX = 360
const ANNOTATION_TEXT_BOX_WIDTH_RATIO = 0.28
const ANNOTATION_TEXT_MIN_EDITOR_HEIGHT_PX = 52
const ANNOTATION_TEXT_MAX_EDITOR_HEIGHT_PX = 180
const ANNOTATION_TEXT_EDITOR_HEIGHT_RATIO = 2.8

export function annotationTextLines(text: string): string[] {
  if (!text.trim()) return []
  return text.replace(/\r\n/g, '\n').split('\n')
}

export function resolveAnnotationTextFontSizePx(annotation: AnnotationText, pageSize: AnnotationTextPageSize): number {
  const fontSizePx = clampTextFontSizePx(annotation.fontSizePx)
  const surfaceSize = annotation.anchor?.kind === 'view-surface' ? annotation.anchor.surfaceSize : undefined
  if (!isFinitePositive(surfaceSize?.heightPx) || !isFinitePositive(pageSize.heightPx)) return fontSizePx
  return clampTextFontSizePx(fontSizePx * (pageSize.heightPx / surfaceSize.heightPx))
}

export function annotationTextSheetLayout(
  annotation: AnnotationText,
  pageSize: AnnotationTextPageSize,
  position: { x: number; y: number } = annotation,
): AnnotationTextSheetLayout {
  const safeWidth = Math.max(1, pageSize.widthPx)
  const safeHeight = Math.max(1, pageSize.heightPx)
  const fontSizePx = resolveAnnotationTextFontSizePx(annotation, pageSize)
  const maxWidthPx = annotationTextBoxWidthPx(safeWidth)
  const editorWidthPx = maxWidthPx
  const editorHeightPx = annotationTextEditorHeightPx(fontSizePx)
  return {
    xPx: clampNumber(position.x * safeWidth, 0, safeWidth),
    yPx: clampNumber(position.y * safeHeight, 0, safeHeight),
    fontSizePx,
    maxWidthPx,
    editorWidthPx,
    editorHeightPx,
  }
}

export function annotationTextCssLayout(
  annotation: AnnotationText,
  pageSize: AnnotationTextPageSize,
  zoom: number,
  position: { x: number; y: number } = annotation,
): AnnotationTextCssLayout {
  const scale = isFinitePositive(zoom) ? zoom : 1
  const layout = annotationTextSheetLayout(annotation, pageSize, position)
  return {
    leftPx: layout.xPx * scale,
    topPx: layout.yPx * scale,
    fontSizePx: layout.fontSizePx * scale,
    maxWidthPx: layout.maxWidthPx * scale,
    editorWidthPx: layout.editorWidthPx * scale,
    editorHeightPx: layout.editorHeightPx * scale,
  }
}

export function annotationTextSvgFontSize(annotation: AnnotationText, pageSize: AnnotationTextPageSize): number {
  return resolveAnnotationTextFontSizePx(annotation, pageSize) / Math.max(1, pageSize.heightPx)
}

export function annotationTextAnchorSurfaceSize(annotation: AnnotationText): AnnotationTextPageSize | null {
  const surfaceSize = annotation.anchor?.kind === 'view-surface' ? annotation.anchor.surfaceSize : undefined
  if (!isFinitePositive(surfaceSize?.widthPx) || !isFinitePositive(surfaceSize?.heightPx)) return null
  return surfaceSize
}

function annotationTextBoxWidthPx(pageWidthPx: number): number {
  return Math.min(
    ANNOTATION_TEXT_MAX_BOX_WIDTH_PX,
    Math.max(ANNOTATION_TEXT_MIN_BOX_WIDTH_PX, pageWidthPx * ANNOTATION_TEXT_BOX_WIDTH_RATIO),
  )
}

function annotationTextEditorHeightPx(fontSizePx: number): number {
  return Math.min(
    ANNOTATION_TEXT_MAX_EDITOR_HEIGHT_PX,
    Math.max(ANNOTATION_TEXT_MIN_EDITOR_HEIGHT_PX, fontSizePx * ANNOTATION_TEXT_EDITOR_HEIGHT_RATIO),
  )
}

function isFinitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}
