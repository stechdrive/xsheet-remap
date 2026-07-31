import type {
  AnnotationCoordinateSpace,
  NormalizedPoint,
  SheetPageMemoTarget,
} from '@xsheet-remap/core'
import { clampNumber } from './sheetInteraction'

type PageMemoInputTarget = Pick<SheetPageMemoTarget, 'kind' | 'targetRect'>

export function pageMemoTargetOffset(target: PageMemoInputTarget): NormalizedPoint {
  return target.kind === 'template-region'
    ? { x: target.targetRect?.x ?? 0, y: target.targetRect?.y ?? 0 }
    : { x: 0, y: 0 }
}

export function pageMemoInputPosition(
  point: NormalizedPoint,
  target: PageMemoInputTarget,
): { point: NormalizedPoint; coordinateSpace: AnnotationCoordinateSpace } {
  const offset = pageMemoTargetOffset(target)
  const isTargetRelative = target.kind === 'template-region'
  const minimum = isTargetRelative ? -1 : 0
  const maximum = isTargetRelative ? 2 : 1
  return {
    point: {
      x: clampNumber(point.x - offset.x, minimum, maximum),
      y: clampNumber(point.y - offset.y, minimum, maximum),
    },
    coordinateSpace: isTargetRelative ? 'memo-target' : 'view-surface',
  }
}
