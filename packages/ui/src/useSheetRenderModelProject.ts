import { useMemo } from 'react'
import type { CutProject } from '@xsheet-remap/core'

export function useSheetRenderModelProject(project: CutProject): CutProject {
  return useMemo(
    () => project,
    // Annotation memos are not read by sheetRenderModel.ts and must not
    // invalidate the sheet geometry model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      project.cut,
      project.logicalSheet,
      project.sheetFormData,
      project.sheetView,
      project.stackGuideLabels,
    ],
  )
}
