import { positionMultilineTextLines } from './multilineTextLayout'

export function SvgMultilineTspans({
  lines,
  xPx,
  yPx,
  lineHeightPx,
  keyPrefix = 'line',
}: {
  lines: readonly string[]
  xPx: number
  yPx: number
  lineHeightPx: number
  keyPrefix?: string
}) {
  return positionMultilineTextLines(lines, xPx, yPx, lineHeightPx).map(line => (
    <tspan key={`${keyPrefix}:${line.index}`} x={line.xPx} y={line.yPx}>
      {line.text}
    </tspan>
  ))
}
