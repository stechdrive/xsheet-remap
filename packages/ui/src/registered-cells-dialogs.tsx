import { useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { buildNameNormalizationPlan, type CutProject, type NameNormalizationOptions, type NameNormalizationPlan, type SheetHit, type SheetTemplate } from '@xsheet-remap/core'
import { uiText } from './i18n'
import { type SheetRangeSelection } from './appTypes'
import { hasPaperSheetImages, type SheetImageExportOptions } from './cleanSheetExport'
import { sortedCorrectionLayers } from './sheetAssets'
import { sheetRoleLabel } from './sheetInteraction'
import { type TimelineDeleteDurationPolicy, type TimelineFrameEditScope, type TimelineInsertDurationPolicy } from './timingEditing'
import { Tooltip, TooltipTarget } from './Tooltip'
import { FrameOperationDialogState, FrameOperationKind, FrameOperationSubmit, errorMessage, formatFramePosition } from './app-foundation'
import { defaultNameNormalizationTarget, nameNormalizationOptionsForTarget, nameNormalizationTargetOptions, type NameNormalizationTarget } from './registered-cells-model'

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
  const trackScope: TimelineFrameEditScope = state.paperTracks.length > 1 ? 'tracks' : 'track'
  const [scope, setScope] = useState<TimelineFrameEditScope>(trackScope)
  const [frameCount, setFrameCount] = useState(selectedSpanFrames)
  const [durationPolicy, setDurationPolicy] = useState<TimelineInsertDurationPolicy | TimelineDeleteDurationPolicy>(() => defaultFrameOperationDurationPolicy(state.kind, trackScope))
  const title = state.kind === 'insert' ? uiText.frameOperation.dialogTitleInsert : uiText.frameOperation.dialogTitleDelete
  const hint = state.kind === 'insert' ? uiText.frameOperation.insertHint : uiText.frameOperation.deleteHint
  const sanitizedFrameCount = Math.max(1, Math.round(frameCount))

  function updateScope(nextScope: TimelineFrameEditScope) {
    setScope(nextScope)
    setDurationPolicy(defaultFrameOperationDurationPolicy(state.kind, nextScope))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit({
      scope,
      frameCount: sanitizedFrameCount,
      durationPolicy,
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
            <span>{sheetRoleLabel(state.role)} {state.paperTracks.join(', ')}</span>
          </div>
          <fieldset className="frameOperationFieldset">
            <legend>{uiText.frameOperation.target}</legend>
            <label>
              <input type="radio" name="frameOperationScope" value={trackScope} checked={scope === trackScope} onChange={() => updateScope(trackScope)} />
              {state.paperTracks.length > 1 ? uiText.frameOperation.targetTracks : uiText.frameOperation.targetTrack}
            </label>
            <label>
              <input type="radio" name="frameOperationScope" value="cut" checked={scope === 'cut'} onChange={() => updateScope('cut')} />
              {uiText.frameOperation.targetCut}
            </label>
          </fieldset>
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
          <fieldset className="frameOperationFieldset">
            <legend>{uiText.frameOperation.durationPolicy}</legend>
            <label>
              <input
                type="radio"
                name="frameOperationDuration"
                value="preserve"
                checked={durationPolicy === 'preserve'}
                onChange={() => setDurationPolicy('preserve')}
              />
              {uiText.frameOperation.preserveDuration}
            </label>
            {state.kind === 'insert' ? (
              <label>
                <input
                  type="radio"
                  name="frameOperationDuration"
                  value="extend"
                  checked={durationPolicy === 'extend'}
                  onChange={() => setDurationPolicy('extend')}
                />
                {uiText.frameOperation.extendDuration}
              </label>
            ) : (
              <label>
                <input
                  type="radio"
                  name="frameOperationDuration"
                  value="shrink"
                  checked={durationPolicy === 'shrink'}
                  onChange={() => setDurationPolicy('shrink')}
                />
                {uiText.frameOperation.shrinkDuration}
              </label>
            )}
          </fieldset>
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

function defaultFrameOperationDurationPolicy(kind: FrameOperationKind, scope: TimelineFrameEditScope): TimelineInsertDurationPolicy | TimelineDeleteDurationPolicy {
  if (kind === 'insert') return scope === 'cut' ? 'extend' : 'preserve'
  return scope === 'cut' ? 'shrink' : 'preserve'
}

export function NameNormalizationDialog({
  project,
  selectedKeyId,
  selectedHit,
  rangeSelection,
  initialCorrectionLayerId,
  onClose,
  onApply,
}: {
  project: CutProject
  selectedKeyId: string | null
  selectedHit: SheetHit | null
  rangeSelection: SheetRangeSelection | null
  initialCorrectionLayerId?: string
  onClose: () => void
  onApply: (plan: NameNormalizationPlan) => Promise<void>
}) {
  const [target, setTarget] = useState<NameNormalizationTarget>(() =>
    defaultNameNormalizationTarget(project, selectedKeyId, selectedHit, rangeSelection),
  )
  const [correctionLayerId, setCorrectionLayerId] = useState(() =>
    project.correctionLayers.some(layer => layer.layerId === initialCorrectionLayerId) ? initialCorrectionLayerId ?? '' : '',
  )
  const [includeAssetFiles, setIncludeAssetFiles] = useState(false)
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
          <label className="nameNormalizationCheckbox">
            <input type="checkbox" checked={includeAssetFiles} onChange={event => setIncludeAssetFiles(event.currentTarget.checked)} />
            {uiText.nameNormalization.includeAssetFiles}
          </label>
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
                <th>{uiText.nameNormalization.headers.track}</th>
                <th>{uiText.nameNormalization.headers.display}</th>
                <th>{uiText.nameNormalization.headers.currentCsp}</th>
                <th>{uiText.nameNormalization.headers.nextCsp}</th>
                <th>{uiText.nameNormalization.headers.asset}</th>
                <th>{uiText.nameNormalization.headers.nextFile}</th>
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
                return (
                  <tr key={item.itemId}>
                    <td>{item.processLabel ?? '-'}</td>
                    <td>{item.paperTrack}</td>
                    <td>{item.displayLabel}</td>
                    <td>{item.currentCspCellName}</td>
                    <td>{item.nextCspCellName}</td>
                    <td>{item.assetDisplayName ?? '-'}</td>
                    <td>
                      <Tooltip label={rename?.representativeReason ?? ''}>
                        <span>{rename ? rename.nextFileName : '-'}</span>
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
  const hasTemplateImage = Boolean(template.defaultUnderlay)
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
