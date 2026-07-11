export type SheetSvgPageSize = {
  widthPx: number
  heightPx: number
}

export type SheetSvgTextGeometry = {
  x: number
  y: number
  fontSize: number
  transform: string
}

export function sheetSvgTextGeometry(
  x: number,
  y: number,
  fontSizePx: number,
  pageSize: SheetSvgPageSize,
): SheetSvgTextGeometry {
  const widthPx = Math.max(1, pageSize.widthPx)
  const heightPx = Math.max(1, pageSize.heightPx)
  return {
    x: x * widthPx,
    y: y * heightPx,
    fontSize: fontSizePx,
    transform: `scale(${1 / widthPx} ${1 / heightPx})`,
  }
}

export function sheetSvgTextX(x: number, pageSize: SheetSvgPageSize): number {
  return x * Math.max(1, pageSize.widthPx)
}
