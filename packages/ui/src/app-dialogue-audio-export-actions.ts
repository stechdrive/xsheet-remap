import type { CutProject } from '@xsheet-remap/core'
import type { ExportOperationNotice } from './appTypes'
import { errorMessage, preferredSaveDirectory, saveBinaryOutputs } from './app-foundation'
import { createDialogueAudioTrackExports, type DialogueAudioTrackExportFormat } from './dialogueAudioExport'
import { uiText } from './i18n'

export interface DialogueAudioTrackExportResult {
  trackCount: number
  saved: boolean
}

export async function saveDialogueAudioTrackExports(
  project: CutProject,
  format: DialogueAudioTrackExportFormat,
): Promise<DialogueAudioTrackExportResult> {
  const outputs = await createDialogueAudioTrackExports(project, format)
  if (outputs.length === 0) return { trackCount: 0, saved: false }
  const saved = await saveBinaryOutputs(outputs, {
    filterName: `音声トラック (${format.toUpperCase()})`,
    extensions: [format],
    defaultExtension: format,
    initialDirectory: preferredSaveDirectory(project),
  })
  return { trackCount: outputs.length, saved }
}

export function createAppDialogueAudioExportAction(
  project: CutProject,
  setExportOperationNotice: (notice: ExportOperationNotice) => void,
) {
  return async (format: DialogueAudioTrackExportFormat) => {
    try {
      const result = await saveDialogueAudioTrackExports(project, format)
      if (result.trackCount === 0) {
        window.alert(uiText.actions.dialogueAudioExportEmpty)
      } else if (result.saved) {
        setExportOperationNotice({
          message: uiText.actions.dialogueAudioExportSucceeded(format.toUpperCase(), result.trackCount),
        })
      }
    } catch (error) {
      window.alert(uiText.actions.dialogueAudioExportFailed(errorMessage(error)))
    }
  }
}
