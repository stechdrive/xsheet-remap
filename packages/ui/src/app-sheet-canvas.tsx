import { useSheetCanvasController, type SheetCanvasProps } from './app-sheet-canvas-controller'
import { SheetCanvasView } from './app-sheet-canvas-view'

export type { SheetCanvasProps } from './app-sheet-canvas-controller'

export function SheetCanvas(props: SheetCanvasProps) {
  return <SheetCanvasView controller={useSheetCanvasController(props)} />
}
