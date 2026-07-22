export type PositionedMultilineTextLine = {
  index: number
  text: string
  xPx: number
  yPx: number
}

export function positionMultilineTextLines(
  lines: readonly string[],
  xPx: number,
  yPx: number,
  lineHeightPx: number,
): PositionedMultilineTextLine[] {
  return lines.map((text, index) => ({
    index,
    text,
    xPx,
    yPx: yPx + index * lineHeightPx,
  }))
}
