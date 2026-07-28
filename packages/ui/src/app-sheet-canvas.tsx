import { forwardRef, useImperativeHandle } from 'react'
import { useSheetCanvasController } from './app-sheet-canvas-controller'
import type { SheetCanvasProps } from './app-sheet-canvas-types'
import { SheetCanvasView } from './app-sheet-canvas-view'

export type { SheetCanvasProps } from './app-sheet-canvas-types'

export interface SheetCanvasHandle {
  openSelectionContextMenu: (clientX: number, clientY: number) => boolean
}

export const SheetCanvas = forwardRef<SheetCanvasHandle, SheetCanvasProps>(function SheetCanvas(props, ref) {
  const controller = useSheetCanvasController(props)
  useImperativeHandle(ref, () => ({
    openSelectionContextMenu: controller.openSelectionContextMenu,
  }), [controller.openSelectionContextMenu])
  return <SheetCanvasView controller={controller} />
})
