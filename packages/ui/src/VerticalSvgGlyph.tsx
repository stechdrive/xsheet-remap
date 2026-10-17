import type { SVGProps } from 'react'
import { verticalGlyph } from './verticalTextLayout'

export function VerticalSvgGlyph({ value, xPx, yPx, size, weight = 700, ...props }: {
  value: string; xPx: number; yPx: number; size: number; weight?: number
} & SVGProps<SVGGElement>) {
  const glyph = verticalGlyph(value, weight)
  return <g {...props} data-vertical-glyph={value} aria-label={value}>
    {glyph
      ? <path d={glyph.path} transform={`translate(${xPx - glyph.advance * size / 2} ${yPx}) scale(${size})`} vectorEffect="non-scaling-stroke" />
      : <text x={xPx} y={yPx} fontSize={size} textAnchor="middle" dominantBaseline="alphabetic">{value}</text>}
  </g>
}
