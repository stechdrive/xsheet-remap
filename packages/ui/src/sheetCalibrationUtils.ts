import type { SheetCalibrationPointPair } from '@xsheet-remap/core'

export function calibrationPointsSignature(points: SheetCalibrationPointPair[]): string {
  return points
    .map(point => `${point.source.x},${point.source.y},${point.target.x},${point.target.y}`)
    .join('|')
}
