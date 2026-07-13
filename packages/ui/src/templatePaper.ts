export type TemplatePaperFormat = 'A3' | 'A4' | 'B4' | 'B5'
export type TemplatePaperOrientation = 'portrait' | 'landscape'

export const TEMPLATE_PAPER_FORMATS: Record<TemplatePaperFormat, { widthMm: number; heightMm: number }> = {
  A3: { widthMm: 297, heightMm: 420 },
  A4: { widthMm: 210, heightMm: 297 },
  B4: { widthMm: 257, heightMm: 364 },
  B5: { widthMm: 182, heightMm: 257 },
}

export function templatePaperPixelSize(format: TemplatePaperFormat, orientation: TemplatePaperOrientation, ppi: number) {
  const paper = TEMPLATE_PAPER_FORMATS[format]
  const density = Math.max(1, ppi)
  const portrait = {
    widthPx: Math.max(1, Math.round((paper.widthMm / 25.4) * density)),
    heightPx: Math.max(1, Math.round((paper.heightMm / 25.4) * density)),
  }
  return orientation === 'portrait'
    ? portrait
    : { widthPx: portrait.heightPx, heightPx: portrait.widthPx }
}
