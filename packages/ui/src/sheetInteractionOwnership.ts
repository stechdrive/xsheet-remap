import type { EditMode } from './appTypes'

export type SheetInteractionOwner =
  | 'sheet'
  | 'page-annotation'
  | 'page-text-editor'
  | 'timeline-memo'
  | 'calibration'

export function isDirectAnnotationMode(editMode: EditMode): boolean {
  return editMode === 'pen' || editMode === 'eraser' || editMode === 'text'
}

export function resolveSheetInteractionOwner({
  editMode,
  selectedTimelineMemoId,
  editingTextAnnotationId,
}: {
  editMode: EditMode
  selectedTimelineMemoId: string | null
  editingTextAnnotationId: string | null
}): SheetInteractionOwner {
  if (editMode === 'calibrate') return 'calibration'
  if (!isDirectAnnotationMode(editMode)) return 'sheet'
  if (selectedTimelineMemoId) return 'timeline-memo'
  if (editMode === 'text' && editingTextAnnotationId) return 'page-text-editor'
  return 'page-annotation'
}

export function suppressSheetTooltips(editMode: EditMode): boolean {
  return isDirectAnnotationMode(editMode)
}
