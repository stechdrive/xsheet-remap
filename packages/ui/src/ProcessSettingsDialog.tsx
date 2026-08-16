import { MAX_CORRECTION_LAYERS, type CorrectionLayer, type CutProject } from '@xsheet-remap/core'
import { useRef, useState, type FormEvent, type PointerEvent } from 'react'
import { uiText } from './i18n'
import { sortedCorrectionLayers } from './sheetAssets'
import { clampNumber } from './sheetInteraction'
import { DeleteIconButton } from './DeleteIconButton'
import { Tooltip } from './Tooltip'

type ProcessLayerDraft = CorrectionLayer & { draftId: string }

export function ProcessSettingsDialog({
  project,
  onClose,
  onApply,
}: {
  project: CutProject
  onClose: () => void
  onApply: (layers: CorrectionLayer[]) => void
}) {
  const [draftLayers, setDraftLayers] = useState<ProcessLayerDraft[]>(() => sortedCorrectionLayers(project).map(layer => ({
    ...layer,
    draftId: layer.layerId,
  })).reverse())
  const [draggingDraftId, setDraggingDraftId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const dragPointerRef = useRef<{ draftId: string; pointerId: number } | null>(null)
  const processSettingsTableRef = useRef<HTMLDivElement>(null)
  const defaultStageId = project.productionStages[0]?.stageId ?? 'stage_lo'
  const canAdd = draftLayers.length < MAX_CORRECTION_LAYERS
  const defaultRegistrationDraftId = draftLayers[draftLayers.length - 1]?.draftId ?? ''

  function updateDraft(draftId: string, updates: Partial<Pick<CorrectionLayer, 'label' | 'fileNameSuffix'>>) {
    setDraftLayers(current => current.map(layer => layer.draftId === draftId ? { ...layer, ...updates } : layer))
  }

  function moveDraftToIndex(draftId: string, targetIndex: number) {
    setDraftLayers(current => {
      const index = current.findIndex(layer => layer.draftId === draftId)
      if (index < 0) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      const insertionIndex = clampNumber(index < targetIndex ? targetIndex - 1 : targetIndex, 0, next.length)
      next.splice(insertionIndex, 0, item)
      return next
    })
  }

  function deleteDraft(draftId: string) {
    setDraftLayers(current => current.length <= 1 ? current : current.filter(layer => layer.draftId !== draftId))
  }

  function addDraft() {
    if (!canAdd) return
    setDraftLayers(current => ([
      {
        draftId: `draft_layer_${current.length + 1}_${Date.now()}`,
        layerId: '',
        stageId: defaultStageId,
        label: uiText.processSettings.newLayerLabel(current.length + 1),
        order: current.length,
        role: 'correction',
        defaultVisible: true,
        fileNameSuffix: '',
      },
      ...current,
    ]))
  }

  function dropIndexFromPointer(clientY: number): number {
    const rows = Array.from(processSettingsTableRef.current?.querySelectorAll<HTMLElement>('[data-process-layer-row-index]') ?? [])
    if (rows.length === 0) return 0
    const firstRect = rows[0]?.getBoundingClientRect()
    if (firstRect && clientY < firstRect.top) return 0
    for (const row of rows) {
      const rowIndex = Number(row.dataset.processLayerRowIndex ?? 0)
      const rect = row.getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) return rowIndex
      if (clientY <= rect.bottom) return rowIndex + 1
    }
    return rows.length
  }

  function clearProcessLayerDrag() {
    dragPointerRef.current = null
    setDraggingDraftId(null)
    setDropIndex(null)
  }

  function handleDragHandlePointerDown(event: PointerEvent<HTMLButtonElement>, draftId: string, rowIndex: number) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragPointerRef.current = { draftId, pointerId: event.pointerId }
    setDraggingDraftId(draftId)
    setDropIndex(rowIndex)
  }

  function handleDragHandlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragPointerRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    setDropIndex(dropIndexFromPointer(event.clientY))
  }

  function handleDragHandlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragPointerRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    moveDraftToIndex(drag.draftId, dropIndex ?? dropIndexFromPointer(event.clientY))
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    clearProcessLayerDrag()
  }

  function handleDragHandlePointerCancel(event: PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    clearProcessLayerDrag()
  }

  function validateDrafts(): string | null {
    if (draftLayers.length < 1) return uiText.processSettings.minError
    if (draftLayers.length > MAX_CORRECTION_LAYERS) return uiText.processSettings.maxError(MAX_CORRECTION_LAYERS)
    const labels = new Set<string>()
    for (const layer of draftLayers) {
      const label = layer.label.trim()
      if (!label) return uiText.processSettings.emptyNameError
      if (labels.has(label)) return uiText.processSettings.duplicateNameError(label)
      labels.add(label)
      if (/[<>:"/\\|?*]/.test(layer.fileNameSuffix ?? '')) return uiText.processSettings.invalidSuffixError(label)
    }
    return null
  }

  function handleApply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = validateDrafts()
    if (validationError) {
      window.alert(validationError)
      return
    }
    const layers = [...draftLayers].reverse().map<CorrectionLayer>((layer, index) => ({
      ...layer,
      layerId: layer.layerId,
      stageId: layer.stageId || defaultStageId,
      label: layer.label.trim(),
      order: index,
      role: index === 0 ? 'base' : layer.role === 'base' ? 'correction' : layer.role,
      defaultVisible: true,
      fileNameSuffix: layer.fileNameSuffix?.trim() ?? '',
    }))
    onApply(layers)
  }

  return (
    <div className="assetQuickPreviewBackdrop processSettingsBackdrop" role="dialog" aria-modal="true" aria-label={uiText.processSettings.title}>
      <form className="processSettingsDialog" onSubmit={handleApply}>
        <header className="processSettingsHeader">
          <div>
            <strong>{uiText.processSettings.title}</strong>
            <span>{uiText.processSettings.orderHint}</span>
          </div>
        </header>
        <div ref={processSettingsTableRef} className="processSettingsTable" role="table" aria-label={uiText.processSettings.title}>
          <div className="processSettingsStackMarker top">{uiText.processSettings.cspTop}</div>
          <div className="processSettingsRow processSettingsHead" role="row">
            <span>{uiText.processSettings.dragHandle}</span>
            <span>{uiText.processSettings.name}</span>
            <span>{uiText.processSettings.suffix}</span>
            <span>{uiText.processSettings.directRegistration}</span>
            <span>{uiText.processSettings.delete}</span>
          </div>
          {draftLayers.map((layer, index) => (
            <div
              className={[
                'processSettingsRow',
                draggingDraftId === layer.draftId ? 'dragging' : '',
                dropIndex === index ? 'dropBefore' : '',
                dropIndex === index + 1 ? 'dropAfter' : '',
              ].filter(Boolean).join(' ')}
              role="row"
              key={layer.draftId}
              data-process-layer-row-index={index}
            >
              <Tooltip label={uiText.processSettings.dragHandleTitle(layer.label)}>
                <button
                  type="button"
                  className="processSettingsDragHandle"
                  aria-label={uiText.processSettings.dragHandleTitle(layer.label)}
                  onPointerDown={event => handleDragHandlePointerDown(event, layer.draftId, index)}
                  onPointerMove={handleDragHandlePointerMove}
                  onPointerUp={handleDragHandlePointerUp}
                  onPointerCancel={handleDragHandlePointerCancel}
                >
                  ⋮⋮
                </button>
              </Tooltip>
              <input value={layer.label} aria-label={uiText.processSettings.name} onChange={event => updateDraft(layer.draftId, { label: event.currentTarget.value })} />
              <input value={layer.fileNameSuffix ?? ''} aria-label={uiText.processSettings.suffix} onChange={event => updateDraft(layer.draftId, { fileNameSuffix: event.currentTarget.value })} />
              <span className={layer.draftId === defaultRegistrationDraftId ? 'processSettingsDefaultBadge active' : 'processSettingsDefaultBadge'}>
                {layer.draftId === defaultRegistrationDraftId ? uiText.processSettings.defaultRegistrationLayer : '-'}
              </span>
              <DeleteIconButton
                label={uiText.processSettings.deleteLayer(layer.label)}
                disabled={draftLayers.length <= 1}
                onClick={() => deleteDraft(layer.draftId)}
              />
            </div>
          ))}
          <div className="processSettingsStackMarker bottom">{uiText.processSettings.cspBottom}</div>
        </div>
        <footer className="processSettingsFooter">
          <button type="button" disabled={!canAdd} onClick={addDraft}>{uiText.processSettings.add}</button>
          <span className="muted">{uiText.processSettings.limit(draftLayers.length, MAX_CORRECTION_LAYERS)}</span>
          <span className="processSettingsFooterSpacer" />
          <button type="button" onClick={onClose}>{uiText.processSettings.cancel}</button>
          <button type="submit">{uiText.processSettings.apply}</button>
        </footer>
      </form>
    </div>
  )
}
