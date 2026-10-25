import { SheetSvgText } from './SheetSvgText'
import type { SheetTemplateBranding } from './sheetTemplateBranding'
import type { SheetSvgPageSize } from './sheetSvgTextGeometry'

export function SheetBrandingLayer({ model, pageSize }: { model: SheetTemplateBranding; pageSize: SheetSvgPageSize }) {
  const { qrRect, name } = model
  return <g className="sheetTemplateBranding" pointerEvents="none" aria-hidden="true">
    <rect x={qrRect.x} y={qrRect.y} width={qrRect.w} height={qrRect.h} fill="#fff" stroke="none" />
    <path d={model.qrPath} fill="#000" stroke="none" />
    <SheetSvgText className="sheetBrandingName" x={name.x} y={name.y} fontSizePx={name.fontSizePx}
      pageSize={pageSize} fontWeight={400} textAnchor="end" dominantBaseline="alphabetic" fill={name.color}>
      {name.text}
    </SheetSvgText>
  </g>
}
