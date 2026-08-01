import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  buildAeKeyframeDataText,
  buildAeRemapJsx,
  buildAeRemapJsxConfig,
  buildAeRemapPlan,
  type AeRemapDiagnostic,
  type AeRemapPlan,
  type CutProject,
  type SheetTimingRole,
} from '@xsheet-remap/core'
import { isTauriHost, saveTextFile, sendAfterEffectsRemap, writeClipboardText } from '@xsheet-remap/adapters'
import type { ExportOperationNotice } from './appTypes'
import { errorMessage, preferredSaveDirectory } from './app-foundation'
import { uiText } from './i18n'
import { aeRemapJsxFileName } from './outputFileNames'

interface AppAfterEffectsActionsOptions {
  project: CutProject
  resolveProject: () => CutProject
  setExportOperationNotice: Dispatch<SetStateAction<ExportOperationNotice | null>>
  onSendAccepted: () => void
}

export function useAppAfterEffectsActions(options: AppAfterEffectsActionsOptions) {
  const [afterEffectsSending, setAfterEffectsSending] = useState(false)
  const sendInFlightRef = useRef(false)
  const canSendToAfterEffects = isWindowsTauriAfterEffectsHost()

  async function handleCopyAeKeyframeData(paperTrack: string, sheetRole: SheetTimingRole, locale: 'ja' | 'en' = 'ja') {
    try {
      const plan = buildAeRemapPlan(options.resolveProject(), { paperTracks: [paperTrack], sheetRole })
      const column = plan.columns.find(item => item.paperTrack === paperTrack)
      if (!column) throw new Error(`AEリマップ列が見つかりません: ${paperTrack}`)
      const text = buildAeKeyframeDataText(plan, column.columnId, { locale })
      if (!confirmAeRemapDiagnostics(plan)) return
      await writeClipboardText(text)
      options.setExportOperationNotice({ message: uiText.afterEffects.copySucceeded(column.name) })
    } catch (error) {
      window.alert(uiText.afterEffects.copyFailed(errorMessage(error)))
    }
  }

  async function handleSaveAeJsx(sheetRole: SheetTimingRole) {
    try {
      const project = options.resolveProject()
      const plan = buildAeRemapPlan(project, { sheetRole })
      const script = buildAeRemapJsx(plan)
      if (!confirmAeRemapDiagnostics(plan)) return
      const result = await saveTextFile(script, aeRemapJsxFileName(project), 'text/javascript;charset=utf-8', {
        filterName: 'After Effects JSX',
        extensions: ['jsx'],
        defaultExtension: 'jsx',
        initialDirectory: preferredSaveDirectory(options.project),
      })
      if (result.saved) options.setExportOperationNotice({ message: uiText.afterEffects.jsxSaved })
    } catch (error) {
      window.alert(uiText.afterEffects.jsxSaveFailed(errorMessage(error)))
    }
  }

  async function handleSendAfterEffects(sheetRole: SheetTimingRole) {
    if (!canSendToAfterEffects || sendInFlightRef.current) return
    sendInFlightRef.current = true
    setAfterEffectsSending(true)
    try {
      const plan = buildAeRemapPlan(options.resolveProject(), { sheetRole })
      const config = buildAeRemapJsxConfig(plan)
      if (!confirmAeRemapDiagnostics(plan)) return
      await sendAfterEffectsRemap(config)
      options.setExportOperationNotice({ message: uiText.afterEffects.sendSucceeded })
      options.onSendAccepted()
    } catch (error) {
      window.alert(uiText.afterEffects.sendFailed(errorMessage(error)))
    } finally {
      sendInFlightRef.current = false
      setAfterEffectsSending(false)
    }
  }

  return {
    canSendToAfterEffects,
    afterEffectsSending,
    handleCopyAeKeyframeData,
    handleSaveAeJsx,
    handleSendAfterEffects,
  }
}

export function confirmAeRemapDiagnostics(plan: AeRemapPlan): boolean {
  if (plan.diagnostics.length === 0) return true
  const shown = plan.diagnostics.slice(0, 8).map(aeDiagnosticText)
  const hiddenCount = plan.diagnostics.length - shown.length
  const invalidColumns = [...new Set(plan.diagnostics
    .filter(diagnostic => diagnostic.severity === 'error')
    .map(diagnostic => diagnostic.paperTrack))]
  const lines = [uiText.afterEffects.diagnosticsConfirmTitle, '', ...shown]
  if (hiddenCount > 0) lines.push(uiText.afterEffects.diagnosticsRemaining(hiddenCount))
  if (invalidColumns.length > 0) lines.push('', uiText.afterEffects.diagnosticsSkippedColumns(invalidColumns.join('、')))
  lines.push('', uiText.afterEffects.diagnosticsContinue)
  return window.confirm(lines.join('\n'))
}

function aeDiagnosticText(diagnostic: AeRemapDiagnostic): string {
  const position = `${diagnostic.paperTrack} ${diagnostic.sheetFrame}F`
  if (diagnostic.code === 'ae-remap.binding-number-fallback') {
    return `${position}: 表示名「${diagnostic.value ?? ''}」の代わりに、素材割り当て末尾のセル番号を使います。`
  }
  if (diagnostic.code === 'ae-remap.special-hold') {
    const kind = diagnostic.value === 'reverse' ? '逆シート記号' : '中割記号'
    return `${position}: ${kind}は直前の値をHOLDします。`
  }
  if (diagnostic.code === 'ae-remap.ambiguous-binding-cell-number') {
    return `${position}: 素材割り当てから複数のセル番号が見つかりました。`
  }
  if (diagnostic.code === 'ae-remap.missing-timing-key') {
    return `${position}: 参照するセルキーが見つかりません。`
  }
  return `${position}: 「${diagnostic.value ?? ''}」を正のセル番号として解釈できません。`
}

export function isWindowsTauriAfterEffectsHost(): boolean {
  if (!isTauriHost()) return false
  const navigatorWithClientHints = globalThis.navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = navigatorWithClientHints.userAgentData?.platform
    || navigatorWithClientHints.platform
    || navigatorWithClientHints.userAgent
  return /win/i.test(platform)
}
