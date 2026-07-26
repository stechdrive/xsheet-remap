import type { SheetCalibrationPointPair, SheetPage } from '@xsheet-remap/core'
import type { PointerEvent } from 'react'
import type { SheetImageSettings } from './appTypes'
import type { CalibrationPointKind } from './app-foundation'
import { clampPoint, viewportToRawImagePoint } from './sheetImages'
import { usePointerDragSession } from './usePointerDragSession'

type CalibrationDragSession = {
  pointerId: number
  page: SheetPage
  settings: SheetImageSettings
  pointIndex: number
  pointKind: CalibrationPointKind
  basePoints: SheetCalibrationPointPair[]
  latestPoints: SheetCalibrationPointPair[]
  svgRect: { left: number; top: number; width: number; height: number }
}

function calibrationDragPoint(
  current: CalibrationDragSession,
  clientX: number,
  clientY: number,
): CalibrationDragSession {
  const viewportPoint = {
    x: (clientX - current.svgRect.left) / Math.max(1, current.svgRect.width),
    y: (clientY - current.svgRect.top) / Math.max(1, current.svgRect.height),
  }
  return {
    ...current,
    latestPoints: current.basePoints.map((calibrationPoint, index) => {
      if (index !== current.pointIndex) return calibrationPoint
      return current.pointKind === 'source'
        ? { ...calibrationPoint, source: viewportToRawImagePoint(viewportPoint, current.settings) }
        : { ...calibrationPoint, target: clampPoint(viewportPoint) }
    }),
  }
}

export function useSheetCalibrationDrag({
  onPreview,
  onCommit,
  onClear,
}: {
  onPreview: (pageId: string, points: SheetCalibrationPointPair[]) => void
  onCommit: (page: SheetPage, points: SheetCalibrationPointPair[]) => void
  onClear: () => void
}) {
  const drag = usePointerDragSession<CalibrationDragSession>({
    onUpdate: (current, point) => {
      const next = calibrationDragPoint(current, point.clientX, point.clientY)
      onPreview(next.page.pageId, next.latestPoints)
      return next
    },
    onFinish: (current, finish) => {
      if (!finish.cancelled) onCommit(current.page, current.latestPoints)
      onClear()
    },
  })

  function begin(
    event: PointerEvent<SVGElement>,
    page: SheetPage,
    settings: SheetImageSettings,
    pointIndex: number,
    pointKind: CalibrationPointKind,
    basePoints: SheetCalibrationPointPair[],
  ) {
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const box = svg.getBoundingClientRect()
    const initial = calibrationDragPoint({
      pointerId: event.pointerId,
      page,
      settings,
      pointIndex,
      pointKind,
      basePoints,
      latestPoints: basePoints,
      svgRect: { left: box.left, top: box.top, width: box.width, height: box.height },
    }, event.clientX, event.clientY)
    onPreview(page.pageId, initial.latestPoints)
    drag.begin(initial, event.currentTarget)
  }

  return { begin }
}
