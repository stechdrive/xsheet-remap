import { useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { buildNameNormalizationPlan, type CutProject, type NameNormalizationOptions, type NameNormalizationPlan, type SheetHit, type SheetTemplate } from '@xsheet-remap/core'
import { uiText } from './i18n'
import { type SheetRangeSelection } from './appTypes'
import { hasPaperSheetImages, type SheetImageExportOptions } from './cleanSheetExport'
import { sortedCorrectionLayers } from './sheetAssets'
import { type TimelineFrameEditScope } from './timingEditing'
import { Tooltip, TooltipTarget } from './Tooltip'
import { FrameOperationDialogState, FrameOperationSubmit, errorMessage, formatFramePosition } from './app-foundation'
import { defaultNameNormalizationTarget, nameNormalizationOptionsForTarget, nameNormalizationTargetOptions, type NameNormalizationTarget } from './registered-cells-model'
import { createSheetRenderModelContext, metadataTextRenderItemsForPage } from './sheetRenderModel'

export function FrameOperationDialog({
  state,
  project,
  onSubmit,
  onClose,
}: {
  state: FrameOperationDialogState
  project: CutProject
  onSubmit: (input: FrameOperationSubmit) => void
  onClose: () => void
}) {
  const selectedSpanFrames = Math.max(1, state.frameEnd - state.frameStart + 1)
  const deleteUsesSelectedRange = state.kind === 'delete' && state.sourceRange !== null
  const hasPointTrackScope = (state.role === 'action' || state.role === 'cell') && state.paperTracks.length > 0
  const trackScope: TimelineFrameEditScope = state.paperTracks.length > 1 ? 'tracks' : 'track'
  const [scope, setScope] = useState<TimelineFrameEditScope>(hasPointTrackScope ? trackScope : 'cut')
  const [frameCount, setFrameCount] = useState(selectedSpanFrames)
  const title = state.kind === 'insert' ? uiText.frameOperation.dialogTitleInsert : uiText.frameOperation.dialogTitleDelete
  const hint = state.kind === 'insert' ? uiText.frameOperation.insertHint : uiText.frameOperation.deleteHint
  const sanitizedFrameCount = Math.max(1, Math.round(frameCount))

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit({
      scope,
      frameCount: sanitizedFrameCount,
    })
  }

  return createPortal(
    <div className="assetQuickPreviewBackdrop frameOperationBackdrop" role="dialog" aria-modal="true" aria-label={title} onPointerDown={onClose}>
      <form className="frameOperationDialog" onSubmit={submit} onPointerDown={event => event.stopPropagation()}>
        <header className="frameOperationHeader">
          <div>
            <strong>{title}</strong>
            <span>{hint}</span>
          </div>
          <button type="button" className="dialogIconButton" aria-label={uiText.actions.cancel} onClick={onClose}>×</button>
        </header>
        <div className="frameOperationBody">
          <div className="frameOperationSummary">
            <span>{state.sourceRange
              ? uiText.frameOperation.selectedRange(
                  formatFramePosition(project, state.frameStart),
                  formatFramePosition(project, state.frameEnd),
                  selectedSpanFrames,
                )
              : uiText.frameOperation.startFrame(formatFramePosition(project, state.frameStart))}</span>
            <span>{frameOperationRoleLabel(state.role)} {scope === 'cut' ? uiText.frameOperation.targetCut : state.paperTracks.join(', ')}</span>
          </div>
          {hasPointTrackScope && (
            <fieldset className="frameOperationFieldset">
              <legend>{uiText.frameOperation.target}</legend>
              <label>
                <input type="radio" name="frameOperationScope" value={trackScope} checked={scope === trackScope} onChange={() => setScope(trackScope)} />
                {state.paperTracks.length > 1 ? uiText.frameOperation.targetTracks : uiText.frameOperation.targetTrack}
              </label>
              <label>
                <input type="radio" name="frameOperationScope" value="cut" checked={scope === 'cut'} onChange={() => setScope('cut')} />
                {uiText.frameOperation.targetCut}
              </label>
            </fieldset>
          )}
          <label className="frameOperationInputRow">
            <span>{uiText.frameOperation.frameCount}</span>
            <input
              type="number"
              min="1"
              step="1"
              value={sanitizedFrameCount}
              disabled={deleteUsesSelectedRange}
              onChange={event => setFrameCount(Number(event.currentTarget.value))}
            />
          </label>
        </div>
        <footer className="frameOperationFooter">
          <button type="button" onClick={onClose}>{uiText.actions.cancel}</button>
          <button type="submit">{state.kind === 'insert' ? uiText.frameOperation.submitInsert : uiText.frameOperation.submitDelete}</button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}

function frameOperationRoleLabel(role: FrameOperationDialogState['role']): string {
  return uiText.sheetRoles[role]
}

export function NameNormalizationDialog({
  project,
  selectedKeyId,
  selectedHit,
  rangeSelection,
  onClose,
  onApply,
}: {
  project: CutProject
  selectedKeyId: string | null
  selectedHit: SheetHit | null
  rangeSelection: SheetRangeSelection | null
  onClose: () => void
  onApply: (plan: NameNormalizationPlan) => Promise<void>
}) {
  const [target, setTarget] = useState<NameNormalizationTarget>(defaultNameNormalizationTarget)
  const [correctionLayerId, setCorrectionLayerId] = useState('')
  const [includeAssetFiles, setIncludeAssetFiles] = useState(true)
  const [sequencePadding, setSequencePadding] = useState<number | undefined>(undefined)
  const [isApplying, setIsApplying] = useState(false)
  const targetOptions = nameNormalizationTargetOptions(project, selectedKeyId, selectedHit, rangeSelection)
  const options = useMemo<NameNormalizationOptions>(
    () => nameNormalizationOptionsForTarget(project, target, selectedKeyId, selectedHit, rangeSelection, correctionLayerId, includeAssetFiles, sequencePadding),
    [correctionLayerId, includeAssetFiles, project, rangeSelection, selectedHit, selectedKeyId, sequencePadding, target],
  )
  const plan = useMemo(() => buildNameNormalizationPlan(project, options), [options, project])
  const assetRenameByAssetId = useMemo(() => new Map(plan.assetRenames.map(rename => [rename.assetId, rename])), [plan.assetRenames])
  const cspChangeCount = plan.items.filter(item => item.cspCellNameChanged).length
  const assetRenameCount = plan.assetRenames.filter(rename => rename.currentFileName !== rename.nextFileName).length
  const canApply = !isApplying && (cspChangeCount > 0 || plan.assetRenames.some(rename => rename.canRename))

  async function handleApply() {
    if (!canApply) return
    setIsApplying(true)
    try {
      await onApply(plan)
    } catch (error) {
      window.alert(uiText.nameNormalization.applyFailed(errorMessage(error)))
      setIsApplying(false)
    }
  }

  return (
    <div className="assetQuickPreviewBackdrop nameNormalizationBackdrop" role="dialog" aria-modal="true" aria-label={uiText.nameNormalization.title}>
      <section className="nameNormalizationDialog">
        <header className="nameNormalizationHeader">
          <strong>{uiText.nameNormalization.title}</strong>
          <button onClick={onClose}>{uiText.nameNormalization.cancel}</button>
        </header>
        <div className="nameNormalizationBody">
          <p className="nameNormalizationDescription">{uiText.nameNormalization.description}</p>
          <div className="nameNormalizationControls">
            <label>
              {uiText.nameNormalization.target}
              <select value={target} onChange={event => setTarget(event.currentTarget.value as NameNormalizationTarget)}>
                {targetOptions.map(option => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              {uiText.nameNormalization.process}
              <select value={correctionLayerId} onChange={event => setCorrectionLayerId(event.currentTarget.value)}>
                <option value="">{uiText.nameNormalization.allProcesses}</option>
                {sortedCorrectionLayers(project).map(layer => <option key={layer.layerId} value={layer.layerId}>{layer.label}</option>)}
              </select>
            </label>
            <label>
              {uiText.nameNormalization.padding}
              <select value={sequencePadding === undefined ? 'auto' : String(sequencePadding)} onChange={event => setSequencePadding(event.currentTarget.value === 'auto' ? undefined : Number(event.currentTarget.value))}>
                <option value="auto">{uiText.nameNormalization.paddingAuto}</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </select>
            </label>
            <div className="nameNormalizationFileOption">
              <label className="nameNormalizationCheckbox">
                <input type="checkbox" checked={includeAssetFiles} onChange={event => setIncludeAssetFiles(event.currentTarget.checked)} />
                {uiText.nameNormalization.includeAssetFiles}
              </label>
              <small>{uiText.nameNormalization.includeAssetFilesHelp}</small>
            </div>
          </div>
          <div className="nameNormalizationSummary">
            <span>{uiText.nameNormalization.cspChanges(cspChangeCount)}</span>
            <span>{uiText.nameNormalization.assetRenames(assetRenameCount)}</span>
          </div>
          {plan.warnings.length > 0 && (
            <div className="nameNormalizationWarnings">
              {plan.warnings.slice(0, 6).map((warning, index) => <p key={`${index}-${warning}`}>{warning}</p>)}
              {plan.warnings.length > 6 && <p>{uiText.nameNormalization.moreWarnings(plan.warnings.length - 6)}</p>}
            </div>
          )}
          <div className="nameNormalizationTableWrap">
            <table className="nameNormalizationTable">
              <thead>
                <tr>
                  <th>{uiText.nameNormalization.headers.process}</th>
                  <th>{uiText.nameNormalization.headers.target}</th>
                  <th>{uiText.nameNormalization.headers.cspName}</th>
                  <th>{uiText.nameNormalization.headers.assetFileName}</th>
                  <th>{uiText.nameNormalization.headers.status}</th>
                </tr>
              </thead>
              <tbody>
                {plan.items.slice(0, 160).map(item => {
                  const rename = item.assetId ? assetRenameByAssetId.get(item.assetId) : undefined
                  const status = [
                    item.cspCellNameChanged ? uiText.nameNormalization.status.csp : '',
                    rename && rename.currentFileName !== rename.nextFileName
                      ? rename.canRename ? uiText.nameNormalization.status.file : uiText.nameNormalization.status.fileBlocked
                      : '',
                  ].filter(Boolean).join(' / ') || uiText.nameNormalization.status.noChange
                  const currentAssetFileName = rename?.currentFileName ?? item.assetDisplayName
                  const nextAssetFileName = rename?.nextFileName
                    ?? (item.assetId ? uiText.nameNormalization.fileRenameDisabled : uiText.nameNormalization.noAssetFile)
                  return (
                    <tr key={item.itemId}>
                      <td>{item.processLabel ?? '-'}</td>
                      <td className="nameNormalizationTargetCell">
                        <strong>{item.paperTrack}</strong>
                        <span>{item.displayLabel}</span>
                      </td>
                      <td>
                        <NameNormalizationChange current={item.currentCspCellName} next={item.nextCspCellName} />
                      </td>
                      <td>
                        <Tooltip label={rename?.representativeReason ?? ''}>
                          <span>
                            {currentAssetFileName
                              ? <NameNormalizationChange current={currentAssetFileName} next={nextAssetFileName} />
                              : uiText.nameNormalization.noAssetFile}
                          </span>
                        </Tooltip>
                      </td>
                      <td>{status}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {plan.items.length > 160 && <p className="muted">{uiText.nameNormalization.moreRows(plan.items.length - 160)}</p>}
          </div>
        </div>
        <footer className="nameNormalizationFooter">
          <button onClick={onClose}>{uiText.nameNormalization.cancel}</button>
          <button disabled={!canApply} onClick={() => void handleApply()}>
            {isApplying ? uiText.nameNormalization.applying : uiText.nameNormalization.apply}
          </button>
        </footer>
      </section>
    </div>
  )
}

function NameNormalizationChange({ current, next }: { current: string; next: string }) {
  if (current === next) return <span className="nameNormalizationUnchanged">{current}</span>
  return (
    <span className="nameNormalizationChange">
      <span>{current || '-'}</span>
      <span className="nameNormalizationArrow" aria-hidden="true">→</span>
      <strong>{next}</strong>
    </span>
  )
}

export function SheetImageExportDialog({
  project,
  template,
  initialOptions,
  onClose,
  onExport,
}: {
  project: CutProject
  template: SheetTemplate
  initialOptions: SheetImageExportOptions
  onClose: () => void
  onExport: (options: SheetImageExportOptions) => Promise<void>
}) {
  const hasPaper = hasPaperSheetImages(project)
  const hasTemplateImage = Boolean(template.defaultUnderlay) && template.defaultUnderlayUsage !== 'reference-only'
  const overflowingFields = useMemo(() => {
    const context = createSheetRenderModelContext(project, template)
    return context.pages.flatMap(page => metadataTextRenderItemsForPage(context, page))
      .filter(item => item.overflow)
  }, [project, template])
  const [options, setOptions] = useState(() => normalizeSheetImageExportDialogOptions(initialOptions, hasPaper, hasTemplateImage))
  const [isSaving, setIsSaving] = useState(false)

  function updateIncludePaperSheet(includePaperSheet: boolean) {
    setOptions(current => normalizeSheetImageExportDialogOptions({ ...current, includePaperSheet }, hasPaper, hasTemplateImage))
  }

  function updateTemplateImage(includeTemplateImage: boolean) {
    setOptions(current => normalizeSheetImageExportDialogOptions({ ...current, includeTemplateImage }, hasPaper, hasTemplateImage))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    try {
      await onExport(normalizeSheetImageExportDialogOptions(options, hasPaper, hasTemplateImage))
    } catch {
      setIsSaving(false)
    }
  }

  return (
    <div className="assetQuickPreviewBackdrop sheetImageExportBackdrop" role="dialog" aria-modal="true" aria-label={uiText.actions.imageExport}>
      <form className="sheetImageExportDialog" onSubmit={event => void handleSubmit(event)}>
        <header className="sheetImageExportHeader">
          <div>
            <strong>{uiText.actions.imageExportTitle(options.format.toUpperCase())}</strong>
            <span>{uiText.actions.imageExportMenuTitle}</span>
          </div>
        </header>
        <div className="sheetImageExportControls">
          {overflowingFields.length > 0 && (
            <div className="sheetImageExportWarning" role="status">
              {overflowingFields.length}件の入力文字が欄内に収まっていません。書き出しでは欄外が切り取られます。
            </div>
          )}
          <TooltipTarget label={uiText.actions.imageExportPaperSheetTitle}>
            {tooltipProps => (
              <label className="sheetImageExportCheckbox" {...tooltipProps}>
                <input
                  type="checkbox"
                  checked={options.includePaperSheet}
                  disabled={!hasPaper}
                  onChange={event => updateIncludePaperSheet(event.currentTarget.checked)}
                />
                {uiText.actions.imageExportPaperSheet}
              </label>
            )}
          </TooltipTarget>
          <fieldset className="sheetImageExportTemplateModes">
            <legend>{uiText.actions.imageExportLayers}</legend>
            <TooltipTarget label={uiText.actions.imageExportTemplateImageTitle}>
              {tooltipProps => (
                <label className={!hasTemplateImage ? 'disabled' : ''} {...tooltipProps}>
                  <input
                    type="checkbox"
                    checked={options.includeTemplateImage}
                    disabled={!hasTemplateImage}
                    onChange={event => updateTemplateImage(event.currentTarget.checked)}
                  />
                  {uiText.actions.imageExportTemplateImage}
                </label>
              )}
            </TooltipTarget>
            <TooltipTarget label={uiText.actions.imageExportTemplateDrawingTitle}>
              {tooltipProps => (
                <label {...tooltipProps}>
                  <input
                    type="checkbox"
                    checked={options.includeTemplateDrawing}
                    onChange={event => setOptions(current => ({ ...current, includeTemplateDrawing: event.currentTarget.checked }))}
                  />
                  {uiText.actions.imageExportTemplateDrawing}
                </label>
              )}
            </TooltipTarget>
          </fieldset>
        </div>
        <footer className="sheetImageExportFooter">
          <button type="button" onClick={onClose}>{uiText.nameNormalization.cancel}</button>
          <button type="submit" disabled={isSaving}>
            {isSaving ? uiText.nameNormalization.applying : uiText.actions.imageExportSave}
          </button>
        </footer>
      </form>
    </div>
  )
}

function normalizeSheetImageExportDialogOptions(
  options: SheetImageExportOptions,
  hasPaper: boolean,
  hasTemplateImage: boolean,
): SheetImageExportOptions {
  const includePaperSheet = hasPaper && options.includePaperSheet
  const includeTemplateImage = hasTemplateImage && options.includeTemplateImage
  return { ...options, includePaperSheet, includeTemplateImage }
}
