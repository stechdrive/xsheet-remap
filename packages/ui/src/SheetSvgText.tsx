import type { ReactNode, SVGProps } from 'react'
import { sheetSvgTextGeometry, type SheetSvgPageSize } from './sheetSvgTextGeometry'

type SheetSvgTextProps = Omit<SVGProps<SVGTextElement>, 'x' | 'y' | 'fontSize' | 'transform'> & {
  x: number
  y: number
  fontSizePx: number
  pageSize: SheetSvgPageSize
  children?: ReactNode
}

export function SheetSvgText({ x, y, fontSizePx, pageSize, children, ...props }: SheetSvgTextProps) {
  const geometry = sheetSvgTextGeometry(x, y, fontSizePx, pageSize)
  return (
    <text
      {...props}
      x={geometry.x}
      y={geometry.y}
      fontSize={geometry.fontSize}
      transform={geometry.transform}
    >
      {children}
    </text>
  )
}
