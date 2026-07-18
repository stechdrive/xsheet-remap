import { useSheetCanvasController } from './app-sheet-canvas-controller'
import type { SheetCanvasProps } from './app-sheet-canvas-types'
import { SheetCanvasView } from './app-sheet-canvas-view'

export type { SheetCanvasProps } from './app-sheet-canvas-types'

export function SheetCanvas(props: SheetCanvasProps) {
  return <SheetCanvasView controller={useSheetCanvasController(props)} />
}
