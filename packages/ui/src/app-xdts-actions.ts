import type { Dispatch, SetStateAction } from 'react'
import {
  buildExportPlan,
  DEFAULT_EXPORT_TIMING_ROLE,
  type CutGroupProjectDocument,
  type CutProject,
  type SheetTimingRole,
} from '@xsheet-remap/core'
import {
  exportProjectXdts,
  importXdtsIntoProject,
  parseXdts,
  type ProjectXdtsExportOptions,
  type XdtsImportOptions,
} from '@xsheet-remap/xdts'
import type { TimingExportDialogState, XdtsImportDialogState } from './appTypes'
import { sheetXdtsFileName } from './outputFileNames'
import {
  errorMessage,
  exportCutProjectsFromDocument,
  fileDialogInitialDirectory,
  saveTextOutputs,
} from './app-foundation'
import { uiText } from './i18n'

interface AppXdtsActionsOptions {
  project: CutProject
  getProject: () => CutProject
  projectDocument: CutGroupProjectDocument
  exportProfileId: string
  timingExportDialog: TimingExportDialogState | null
  setTimingExportDialog: Dispatch<SetStateAction<TimingExportDialogState | null>>
  xdtsImportDialog: XdtsImportDialogState | null
  setXdtsImportDialog: Dispatch<SetStateAction<XdtsImportDialogState | null>>
  commitProject: (project: CutProject) => void
  clearSelection: () => void
  saveCspImportPackage: (role: SheetTimingRole) => void | Promise<void>
}

export function createAppXdtsActions(options: AppXdtsActionsOptions) {
  function openTimingExportDialog(kind: TimingExportDialogState['kind']) {
    options.setTimingExportDialog({
      kind,
      timingSourceRole: DEFAULT_EXPORT_TIMING_ROLE,
      includeSound: kind === 'xdts',
      includeCamera: kind === 'xdts',
    })
  }

  function updateTimingExportRole(timingSourceRole: SheetTimingRole) {
    options.setTimingExportDialog(current => current ? { ...current, timingSourceRole } : current)
  }

  function updateTimingExportOptions(updates: Partial<Pick<TimingExportDialogState, 'includeSound' | 'includeCamera'>>) {
    options.setTimingExportDialog(current => current ? { ...current, ...updates } : current)
  }

  function confirmTimingExport() {
    const current = options.timingExportDialog
    if (!current) return
    options.setTimingExportDialog(null)
    if (current.kind === 'csp-import') {
      void options.saveCspImportPackage(current.timingSourceRole)
      return
    }
    void handleSaveXdts(current.timingSourceRole, {
      includeSound: current.includeSound,
      includeCamera: current.includeCamera,
    })
  }

  async function handleSaveXdts(
    timingSourceRole: SheetTimingRole = DEFAULT_EXPORT_TIMING_ROLE,
    exportOptions: ProjectXdtsExportOptions = {},
  ) {
    try {
      const outputs = exportCutProjectsFromDocument(options.projectDocument).map((cutProject, index) => ({
        fileName: sheetXdtsFileName(cutProject),
        contents: exportProjectXdts(buildExportPlan(cutProject, {
          profileId: options.exportProfileId,
          timingSourceRole,
          sheetTemplate: options.projectDocument.sheetTemplate,
          fallbackCutId: options.projectDocument.cuts[index]?.cutId,
        }), cutProject, exportOptions),
      }))
      await saveTextOutputs(outputs, 'text/plain;charset=utf-8', {
        filterName: 'XDTS',
        extensions: ['xdts'],
        defaultExtension: 'xdts',
        initialDirectory: fileDialogInitialDirectory(options.project),
      })
    } catch (error) {
      window.alert(uiText.export.saveFailed(errorMessage(error)))
    }
  }

  async function handleLoadXdts(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    try {
      const data = parseXdts(await file.text())
      if (data.timeTables.length === 0) throw new Error('タイムテーブルがありません。')
      const table = data.timeTables[0]!
      options.setXdtsImportDialog({
        fileName: file.name,
        data,
        tableIndex: 0,
        targetRole: 'action',
        includeSound: table.dialogueCues.length > 0,
        includeCamera: table.cameraCues.length > 0,
        conflictMode: 'replace',
        applyCutIdentity: false,
        expandDuration: true,
      })
    } catch (error) {
      window.alert(`XDTSを読み込めませんでした。\n${errorMessage(error)}`)
    }
  }

  function updateXdtsImportDialog(updates: Partial<XdtsImportDialogState>) {
    options.setXdtsImportDialog(current => current ? { ...current, ...updates } : current)
  }

  function confirmXdtsImport() {
    const current = options.xdtsImportDialog
    if (!current) return
    try {
      const importOptions: XdtsImportOptions = {
        tableIndex: current.tableIndex,
        targetRole: current.targetRole,
        includeSound: current.includeSound,
        includeCamera: current.includeCamera,
        conflictMode: current.conflictMode,
        applyCutIdentity: current.applyCutIdentity,
        expandDuration: current.expandDuration,
      }
      const result = importXdtsIntoProject(options.getProject(), current.data, importOptions)
      options.commitProject(result.project)
      options.clearSelection()
      options.setXdtsImportDialog(null)
      const skipped = result.skippedCount > 0 ? `既存データと競合した ${result.skippedCount} 件をスキップしました。` : null
      if (result.warnings.length > 0 || skipped) {
        window.alert([...result.warnings, skipped].filter((message): message is string => Boolean(message)).join('\n'))
      }
    } catch (error) {
      window.alert(`XDTSを読み込めませんでした。\n${errorMessage(error)}`)
    }
  }

  return {
    openTimingExportDialog,
    updateTimingExportRole,
    updateTimingExportOptions,
    confirmTimingExport,
    handleSaveXdts,
    handleLoadXdts,
    updateXdtsImportDialog,
    confirmXdtsImport,
  }
}
