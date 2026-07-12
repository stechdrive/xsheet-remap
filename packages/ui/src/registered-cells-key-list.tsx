import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react'
import { type CutProject, type SheetTimingRole, type StackGuideLabel, stackGuideCspCellName, stackGuideRegistrationForLayer, stackGuideRegistrations, stackGuideStackBand, type TimingKey } from '@xsheet-remap/core'
import { uiText } from './i18n'
import { assetIdFromAssetDragData, hasAssetDragPayload } from './assetFiles'
import { AssetFloatingPreview } from './assetPreview'
import { clampAssetPreviewRect, initialAssetPreviewRect, openNativeAssetPreviewPayload, writeAssetPreviewRect, type AssetPreviewPayload, type AssetPreviewRect } from './assetPreviewModel'
import { createInternalDragCardImage, startInternalPointerDrag, subscribeInternalDrag } from './internalDrag'
import { Tooltip, TooltipTarget } from './Tooltip'
import { ActionMenu } from './AppControls'
import { RegisteredCellSortDirection, StackGuideInsertTool, StackGuideLabelUpdates, compareStackGuideLabelsForUi } from './app-foundation'
import { NormalizeNamesIcon, PlusIcon, RegisteredCellDetailViewIcon, RegisteredCellListViewIcon, RegisteredCellSortIcon, TrashIcon } from './app-navigation'
import { isInteractiveKeyboardTarget } from './app-stack-guides'
import { ProcessMoveMenu } from './app-sheet-layers'
import { RegisteredCellHoverPreviewOverlay, RegisteredCellThumbnailRow, automaticRegisteredCellCspName, embeddedRegisteredCellPreviewPayload, embeddedStackGuidePreviewPayload, firstTimelineUseForKey, nativeRegisteredCellPreviewPayload, nativeStackGuidePreviewPayload, primarySlotForKey, registeredCellAssetRows, registeredCellCompactTitle, registeredCellHoverPreviewStyle, registeredCellPrimaryDisplayName, registeredCellProcessLabels, registeredCellSectionsForUi, registeredCellTrackOrder, stackGuideAssetRows, stackGuideDropMenuStyle, stackGuideKindLabel, updateNativeRegisteredCellPreviewIfOpen } from './registered-cells-model'

type RegisteredCellViewMode = 'detail' | 'list'

export function KeyList({
  project,
  activeCorrectionLayerId,
  selectedKeyId,
  onSelect,
  onJumpToFirstUse,
  onUpdateKey,
  onDeleteKey,
  onUpdateCspCellName,
  onMoveKeyBindingProcess,
  onCreateStackGuideLabel,
  onUpdateStackGuideLabel,
  onUpdateStackGuideRegistration,
  onDeleteStackGuideLabel,
  onOpenNameNormalization,
  onAssignAsset,
  onAssignAssetToStackGuideLabel,
  onRequestStackGuideInsert,
}: {
  project: CutProject
  activeCorrectionLayerId: string
  selectedKeyId: string | null
  onSelect: (keyId: string | null) => void
  onJumpToFirstUse: (keyId: string) => void
  onUpdateKey: (keyId: string, displayLabel: string) => void
  onDeleteKey: (keyId: string) => void | Promise<void>
  onUpdateCspCellName: (keyId: string, slotId: string, cspCellName: string) => void
  onMoveKeyBindingProcess: (keyId: string, sourceSlotId: string, targetCorrectionLayerId: string) => void
  onCreateStackGuideLabel: (input: { label: string; gapIndex: number; insertAfterPaperTrack?: string; displayRole?: SheetTimingRole; viewSnapIndex?: number; kind?: StackGuideLabel['kind']; correctionLayerId?: string }) => void
  onUpdateStackGuideLabel: (labelId: string, updates: StackGuideLabelUpdates) => void
  onUpdateStackGuideRegistration: (labelId: string, correctionLayerId: string, cspCellName: string) => void
  onDeleteStackGuideLabel: (labelId: string) => void
  onOpenNameNormalization: () => void
  onAssignAsset: (assetId: string, keyId: string, target?: { position?: { x: number; y: number } }) => void
  onAssignAssetToStackGuideLabel: (labelId: string, assetId: string, correctionLayerId?: string) => void
  onRequestStackGuideInsert: (tool: StackGuideInsertTool) => void
}) {
  const trackOrder = useMemo(() => registeredCellTrackOrder(project), [project])
  const [registeredCellViewMode, setRegisteredCellViewMode] = useState<RegisteredCellViewMode>('detail')
  const [registeredCellSortDirection, setRegisteredCellSortDirection] = useState<RegisteredCellSortDirection>('asc')
  const [embeddedPreviewPayload, setEmbeddedPreviewPayload] = useState<AssetPreviewPayload | null>(null)
  const [embeddedPreviewOpen, setEmbeddedPreviewOpen] = useState(false)
  const [embeddedPreviewKind, setEmbeddedPreviewKind] = useState<'registered-cell' | 'stack-guide' | null>(null)
  const [previewRect, setPreviewRect] = useState<AssetPreviewRect>(() => initialAssetPreviewRect())
  const [stackGuideDraft, setStackGuideDraft] = useState<{ kind: Extract<StackGuideLabel['kind'], 'camera-note' | 'memo'>; label: string } | null>(null)
  const [stackGuideDrop, setStackGuideDrop] = useState<{ labelId: string; assetId: string; x: number; y: number } | null>(null)
  const [processMoveMenu, setProcessMoveMenu] = useState<{ keyId: string; sourceSlotId: string; x: number; y: number } | null>(null)
  const [cardHoverPreview, setCardHoverPreview] = useState<{ rows: RegisteredCellThumbnailRow[]; label: string; style: CSSProperties } | null>(null)
  const keyListRef = useRef<HTMLDivElement | null>(null)
  const registeredCellSections = useMemo(() => registeredCellSectionsForUi(project, trackOrder, registeredCellSortDirection), [project, registeredCellSortDirection, trackOrder])
  const stackGuideLabels = useMemo(() => {
    const labels = [...project.stackGuideLabels].sort(compareStackGuideLabelsForUi(project))
    return registeredCellSortDirection === 'asc' ? labels : labels.reverse()
  }, [project, registeredCellSortDirection])
  const selectedPreviewKey = selectedKeyId ? project.logicalSheet.keys.find(item => item.keyId === selectedKeyId) ?? null : null
  const activeEmbeddedPreviewPayload = embeddedPreviewOpen && embeddedPreviewKind === 'registered-cell' && selectedPreviewKey
    ? embeddedRegisteredCellPreviewPayload(project, selectedPreviewKey) ?? embeddedPreviewPayload
    : embeddedPreviewPayload

  useEffect(() => {
    if (!stackGuideDrop) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setStackGuideDrop(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [stackGuideDrop])

  useEffect(() => {
    if (!processMoveMenu) return undefined
    const close = () => setProcessMoveMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [processMoveMenu])

  useEffect(() => subscribeInternalDrag(detail => {
      if (detail.phase !== 'drop' || detail.payload.kind !== 'asset' || detail.payload.assetIds.length !== 1) return
      const assetId = detail.payload.assetIds[0]!
      const clientX = detail.clientX
      const clientY = detail.clientY

      const root = keyListRef.current
      const target = document.elementFromPoint(clientX, clientY)
      if (!root || !target || !root.contains(target)) return

      const stackGuideLayerRow = target.closest<HTMLElement>('.stackGuideRegistrationRow[data-stack-guide-label-id][data-correction-layer-id]')
      if (stackGuideLayerRow && root.contains(stackGuideLayerRow)) {
        const labelId = stackGuideLayerRow.dataset.stackGuideLabelId
        const correctionLayerId = stackGuideLayerRow.dataset.correctionLayerId
        if (!labelId || !correctionLayerId) return
        onAssignAssetToStackGuideLabel(labelId, assetId, correctionLayerId)
        setStackGuideDrop(null)
        return
      }

      const stackGuideCard = target.closest<HTMLElement>('.stackGuideCard[data-stack-guide-label-id]')
      if (stackGuideCard && root.contains(stackGuideCard)) {
        const labelId = stackGuideCard.dataset.stackGuideLabelId
        if (!labelId) return
        setStackGuideDrop({ labelId, assetId, x: clientX, y: clientY })
        return
      }

      const registeredCellCard = target.closest<HTMLElement>('.registeredCellCard[data-registered-cell-key-id]')
      if (registeredCellCard && root.contains(registeredCellCard)) {
        const keyId = registeredCellCard.dataset.registeredCellKeyId
        if (!keyId) return
        onAssignAsset(assetId, keyId, { position: { x: clientX, y: clientY } })
      }
  }))

  async function openPreviewForRegisteredCell(key: TimingKey) {
    const nativePayload = await nativeRegisteredCellPreviewPayload(project, key)
    if (nativePayload && await openNativeAssetPreviewPayload(nativePayload)) {
      setEmbeddedPreviewOpen(false)
      setEmbeddedPreviewPayload(null)
      setEmbeddedPreviewKind(null)
      return
    }
    const embeddedPayload = embeddedRegisteredCellPreviewPayload(project, key)
    if (!embeddedPayload) return
    setEmbeddedPreviewPayload(embeddedPayload)
    setEmbeddedPreviewKind('registered-cell')
    setEmbeddedPreviewOpen(true)
  }

  function updatePreviewRect(rect: AssetPreviewRect) {
    const nextRect = clampAssetPreviewRect(rect)
    setPreviewRect(nextRect)
    writeAssetPreviewRect(nextRect)
  }

  function showCardHoverPreview(event: MouseEvent<HTMLElement>, label: string, rows: RegisteredCellThumbnailRow[]) {
    if (rows.length === 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    setCardHoverPreview({
      rows,
      label,
      style: registeredCellHoverPreviewStyle(rect, rows.length),
    })
  }

  async function openPreviewForStackGuideLabel(label: StackGuideLabel) {
    const nativePayload = await nativeStackGuidePreviewPayload(project, label)
    if (nativePayload && await openNativeAssetPreviewPayload(nativePayload)) {
      setEmbeddedPreviewOpen(false)
      setEmbeddedPreviewPayload(null)
      setEmbeddedPreviewKind(null)
      return
    }
    const embeddedPayload = embeddedStackGuidePreviewPayload(project, label)
    if (!embeddedPayload) return
    setEmbeddedPreviewPayload(embeddedPayload)
    setEmbeddedPreviewKind('stack-guide')
    setEmbeddedPreviewOpen(true)
  }

  function selectRegisteredCell(key: TimingKey) {
    onSelect(key.keyId)
    void updateNativeRegisteredCellPreviewIfOpen(project, key)
  }

  return (
    <div className="keyList" ref={keyListRef}>
      <div className="dockHeader keyListHeader">
        <h2>{uiText.keys.title}</h2>
        <div className="keyListHeaderActions">
          <Tooltip label={uiText.keys.normalizeTitle}>
            <button
              type="button"
              className="iconOnlyButton keyListNormalizeButton"
              aria-label={uiText.nameNormalization.open}
              onClick={onOpenNameNormalization}
            >
              <NormalizeNamesIcon />
            </button>
          </Tooltip>
          <div className="iconSegmentedControl registeredCellViewToggle" role="group" aria-label={uiText.keys.viewMode}>
            <Tooltip label={uiText.keys.view.detailTitle}>
              <button
                type="button"
                className={registeredCellViewMode === 'detail' ? 'active' : ''}
                aria-label={uiText.keys.view.detail}
                onClick={() => setRegisteredCellViewMode('detail')}
              >
                <RegisteredCellDetailViewIcon />
              </button>
            </Tooltip>
            <Tooltip label={uiText.keys.view.listTitle}>
              <button
                type="button"
                className={registeredCellViewMode === 'list' ? 'active' : ''}
                aria-label={uiText.keys.view.list}
                onClick={() => setRegisteredCellViewMode('list')}
              >
                <RegisteredCellListViewIcon />
              </button>
            </Tooltip>
          </div>
          <Tooltip label={registeredCellSortDirection === 'asc' ? uiText.keys.sort.ascendingTitle : uiText.keys.sort.descendingTitle}>
            <button
              type="button"
              className="assetSortButton registeredCellSortButton"
              aria-label={registeredCellSortDirection === 'asc' ? uiText.keys.sort.toDescending : uiText.keys.sort.toAscending}
              onClick={() => setRegisteredCellSortDirection(current => current === 'asc' ? 'desc' : 'asc')}
            >
              <RegisteredCellSortIcon direction={registeredCellSortDirection} />
            </button>
          </Tooltip>
        </div>
      </div>
      {registeredCellSections.length === 0 && stackGuideLabels.length === 0 && <p className="muted">{uiText.keys.empty}</p>}
      {registeredCellSections.map(section => (
        <section className="registeredCellSection" data-section-title={section.title} key={section.sectionId}>
          <div className="registeredCellSectionHeader">
            <h3 className="registeredCellSectionTitle">{section.title}</h3>
          </div>
          <div className={registeredCellViewMode === 'list' ? 'registeredCellCardList compact' : 'registeredCellCardList'}>
      {section.keys.map(key => {
        const slot = primarySlotForKey(project, key, activeCorrectionLayerId)
        const binding = slot ? project.bindings.find(item => item.slotId === slot.slotId && item.keyId === key.keyId) ?? null : null
        const primaryAsset = binding?.assetId ? project.assets.find(asset => asset.assetId === binding.assetId) ?? null : null
        const automaticName = slot ? automaticRegisteredCellCspName(key, slot, primaryAsset) : ''
        const cspCellName = binding?.cspCellName ?? automaticName
        const isManualName = Boolean(binding && binding.cspCellName !== automaticName)
        const assetRows = registeredCellAssetRows(project, key)
        const thumbnailRows = assetRows.map(row => ({
          rowId: row.bindingId,
          correctionLayerId: row.correctionLayerId,
          processLabel: row.processLabel,
          cspCellName: row.cspCellName,
          assetName: row.assetName,
          thumbnailUrl: row.thumbnailUrl,
          detailText: row.detailText,
        }))
        const firstUse = firstTimelineUseForKey(project, key, trackOrder)
        const dragLabel = `${section.title} ${key.paperTrack}${key.displayLabel ? ` ${key.displayLabel}` : ''}`
        const dragSubLabel = cspCellName || uiText.assetDrop.untitledCell
        const primaryName = registeredCellPrimaryDisplayName(key, cspCellName)
        const showCspSubLabel = Boolean(cspCellName && cspCellName !== primaryName)
        const processLabels = registeredCellProcessLabels(assetRows)

        function handleDrop(event: DragEvent<HTMLElement>) {
          const assetId = assetIdFromAssetDragData(event.dataTransfer)
          if (!assetId) return
          event.preventDefault()
          onAssignAsset(assetId, key.keyId, { position: { x: event.clientX, y: event.clientY } })
        }

        function handleAssetRowDrop(event: DragEvent<HTMLElement>) {
          const assetId = assetIdFromAssetDragData(event.dataTransfer)
          if (!assetId) return
          event.preventDefault()
          event.stopPropagation()
          onAssignAsset(assetId, key.keyId, { position: { x: event.clientX, y: event.clientY } })
        }

        function openProcessMoveMenu(event: MouseEvent<HTMLElement>, slotId: string) {
          event.preventDefault()
          event.stopPropagation()
          setProcessMoveMenu({
            keyId: key.keyId,
            sourceSlotId: slotId,
            x: event.clientX,
            y: event.clientY,
          })
        }

        return (
          <article
            key={key.keyId}
            className={[
              'registeredCellCard',
              registeredCellViewMode === 'list' ? 'compact' : '',
              key.keyId === selectedKeyId ? 'selected' : '',
            ].filter(Boolean).join(' ')}
            data-registered-cell-key-id={key.keyId}
            tabIndex={0}
            draggable={false}
            onClick={() => selectRegisteredCell(key)}
            onPointerDown={event => {
              const dragSource = event.currentTarget
              startInternalPointerDrag(event, {
                begin: () => ({ kind: 'registered-cell', keyId: key.keyId }),
                onStarted: () => {
                  setCardHoverPreview(null)
                },
                createDragGhost: () => createInternalDragCardImage(dragLabel, dragSubLabel, dragSource),
              })
            }}
            onKeyDown={event => {
              if (isInteractiveKeyboardTarget(event.target)) return
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              selectRegisteredCell(key)
            }}
            onDragOver={event => {
              if (!hasAssetDragPayload(event.dataTransfer)) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={handleDrop}
            onMouseEnter={event => showCardHoverPreview(event, dragLabel, thumbnailRows)}
            onMouseLeave={() => setCardHoverPreview(null)}
          >
            <div className="registeredCellHeader">
              <div className="registeredCellIdentity" aria-label={`${section.title} ${key.paperTrack}`}>
                <span className="registeredCellTrackBadge">{key.paperTrack}</span>
                {firstUse
                  ? (
                    <Tooltip label={firstUse.title}>
                      <button
                        type="button"
                        className="registeredCellFirstUse"
                        aria-label={uiText.keys.firstUseJump(firstUse.timecode)}
                        draggable={false}
                        onClick={event => {
                          event.stopPropagation()
                          onJumpToFirstUse(key.keyId)
                        }}
                        onPointerDown={event => event.stopPropagation()}
                        onDragStart={event => {
                          event.preventDefault()
                          event.stopPropagation()
                        }}
                      >
                        {uiText.keys.firstUse(firstUse.timecode)}
                      </button>
                    </Tooltip>
                    )
                  : (
                    <Tooltip label={uiText.keys.unplaced}>
                      <span className="registeredCellFirstUse empty">
                        {uiText.keys.unplaced}
                      </span>
                    </Tooltip>
                    )}
                {registeredCellViewMode === 'list' && (
                  <>
                    <Tooltip label={registeredCellCompactTitle(key, cspCellName)}>
                      <strong className="registeredCellCompactName">{primaryName}</strong>
                    </Tooltip>
                    {showCspSubLabel && (
                      <Tooltip label={cspCellName}>
                        <small className="registeredCellCompactSub">{uiText.keys.cspCellName}: {cspCellName}</small>
                      </Tooltip>
                    )}
                    {processLabels.length > 0 && (
                      <span className="registeredCellProcessStrip" aria-label={uiText.keys.imageAsset}>
                        {processLabels.map(label => <span className="registeredCellAssetProcess" key={label}>{label}</span>)}
                      </span>
                    )}
                  </>
                )}
              </div>
              {assetRows.length > 0 && (
                <Tooltip label={uiText.assets.quickPreview}>
                  <button
                    type="button"
                    className="registeredCellPreviewButton"
                    aria-label={uiText.assets.previewDialog(dragLabel)}
                    draggable={false}
                    onClick={event => {
                      event.stopPropagation()
                      selectRegisteredCell(key)
                      void openPreviewForRegisteredCell(key)
                    }}
                    onPointerDown={event => event.stopPropagation()}
                    onDragStart={event => {
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                  >
                    <span className="assetQuickPreviewIcon" aria-hidden="true" />
                  </button>
                </Tooltip>
              )}
              <Tooltip label={uiText.keys.delete}>
                <button
                  type="button"
                  className="registeredCellDeleteButton"
                  aria-label={uiText.keys.deleteLabel(dragLabel)}
                  draggable={false}
                  onClick={event => {
                    event.stopPropagation()
                    void onDeleteKey(key.keyId)
                  }}
                  onPointerDown={event => event.stopPropagation()}
                  onDragStart={event => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                >
                  <TrashIcon />
                </button>
              </Tooltip>
              <span className={isManualName ? 'cellNameMode manual' : 'cellNameMode'}>{isManualName ? uiText.keys.manualName : uiText.keys.autoName}</span>
            </div>
            {registeredCellViewMode === 'detail' && (
              <>
                <label className="registeredCellField">
                  <span>{uiText.keys.displayName}</span>
                  <input value={key.displayLabel} onChange={event => onUpdateKey(key.keyId, event.currentTarget.value)} />
                </label>
                <label className="registeredCellField">
                  <span>{uiText.keys.cspCellName}</span>
                  <input
                    value={cspCellName}
                    disabled={!slot}
                    onChange={event => {
                      if (slot) onUpdateCspCellName(key.keyId, slot.slotId, event.currentTarget.value)
                    }}
                  />
                </label>
                <div className="registeredCellMeta">
                  <span>{uiText.keys.imageAsset}</span>
                  <div className="registeredCellAssetList">
                    {assetRows.length === 0
                      ? <span className="registeredCellAssetEmpty">{uiText.app.unassigned}</span>
                      : assetRows.map(row => (
                        <div
                          className="registeredCellAssetRow"
                          key={row.bindingId}
                          onDragOver={event => {
                            if (!hasAssetDragPayload(event.dataTransfer)) return
                            event.preventDefault()
                            event.stopPropagation()
                            event.dataTransfer.dropEffect = 'copy'
                          }}
                          onDrop={handleAssetRowDrop}
                        >
                          <Tooltip label={uiText.processMove.badgeTitle(row.processLabel)}>
                            <button
                              type="button"
                              className="registeredCellAssetProcess registeredCellAssetProcessButton"
                              onClick={event => openProcessMoveMenu(event, row.slotId)}
                              onContextMenu={event => openProcessMoveMenu(event, row.slotId)}
                              onPointerDown={event => event.stopPropagation()}
                          >
                            {row.processLabel}
                          </button>
                        </Tooltip>
                          <Tooltip label={`${row.processLabel}: ${row.assetName} / ${row.cspCellName}`}>
                            <strong>{row.assetName}</strong>
                          </Tooltip>
                        </div>
                      ))}
                  </div>
                </div>
                {slot && isManualName && (
                  <Tooltip label={uiText.keys.resetAutoNameTitle}>
                    <button className="registeredCellAutoButton" onClick={() => onUpdateCspCellName(key.keyId, slot.slotId, automaticName)}>
                      {uiText.keys.resetAutoName}
                    </button>
                  </Tooltip>
                )}
              </>
            )}
          </article>
        )
      })}
          </div>
        </section>
      ))}
      <section className="registeredCellSection stackGuideCardSection" data-section-title={uiText.stackGuides.title} aria-label={uiText.stackGuides.title}>
        <div className="stackGuideSectionHeader">
          <TooltipTarget label={uiText.stackGuides.titleHelp}>
            {tooltipProps => <h3 {...tooltipProps}>{uiText.stackGuides.title}</h3>}
          </TooltipTarget>
          <div className="stackGuideCreateButtons">
            <ActionMenu
              label={<PlusIcon />}
              ariaLabel={uiText.stackGuides.addMenu}
              tooltipLabel={uiText.stackGuides.addMenuTitle}
              className="stackGuideAddMenu iconActionMenu"
              closeOnMenuItemClick
            >
              <Tooltip label={uiText.stackGuides.addBackgroundBookTitle}>
                <button type="button" onClick={() => onRequestStackGuideInsert('label-editor')}>{uiText.stackGuides.add}</button>
              </Tooltip>
              <Tooltip label={uiText.stackGuides.addOverlayTrackTitle}>
                <button type="button" onClick={() => onRequestStackGuideInsert('overlay-track')}>{uiText.stackGuides.addOverlayTrack}</button>
              </Tooltip>
              <Tooltip label={uiText.stackGuides.addCameraNoteTitle}>
                <button type="button" onClick={() => setStackGuideDraft({ kind: 'camera-note', label: '' })}>{uiText.stackGuides.addCameraNote}</button>
              </Tooltip>
              <Tooltip label={uiText.stackGuides.addMemoTitle}>
                <button type="button" onClick={() => setStackGuideDraft({ kind: 'memo', label: '' })}>{uiText.stackGuides.addMemo}</button>
              </Tooltip>
            </ActionMenu>
          </div>
        </div>
        {stackGuideDraft && (
          <form
            className="stackGuideCreateForm"
            onSubmit={event => {
              event.preventDefault()
              const label = stackGuideDraft.label.trim()
              if (!label) return
              onCreateStackGuideLabel({
                label,
                kind: stackGuideDraft.kind,
                gapIndex: project.logicalSheet.paperTracks.length,
                correctionLayerId: activeCorrectionLayerId,
              })
              setStackGuideDraft(null)
            }}
          >
            <input
              autoFocus
              aria-label={uiText.stackGuides.inputLabel}
              placeholder={stackGuideDraft.kind === 'camera-note' ? uiText.stackGuides.cameraNotePlaceholder : uiText.stackGuides.memoPlaceholder}
              value={stackGuideDraft.label}
              onChange={event => {
                const label = event.currentTarget.value
                setStackGuideDraft(current => current ? { ...current, label } : current)
              }}
            />
            <Tooltip label={uiText.stackGuides.confirm}>
              <button type="submit" className="stackGuideEditorIconButton" aria-label={uiText.stackGuides.confirm}>✓</button>
            </Tooltip>
            <Tooltip label={uiText.stackGuides.cancel}>
              <button type="button" className="stackGuideEditorIconButton" aria-label={uiText.stackGuides.cancel} onClick={() => setStackGuideDraft(null)}>×</button>
            </Tooltip>
          </form>
        )}
        {stackGuideLabels.length === 0
          ? <p className="muted">{uiText.stackGuides.empty}</p>
          : (
            <>
          {stackGuideLabels.map(label => {
            const rows = stackGuideAssetRows(project, label)
            const kindLabel = stackGuideKindLabel(label.kind)
            const processLabels = registeredCellProcessLabels(rows)
            const thumbnailRows = rows.map(row => ({
              rowId: row.rowId,
              correctionLayerId: row.correctionLayerId,
              processLabel: row.processLabel,
              cspCellName: row.cspCellName,
              assetName: row.assetName,
              thumbnailUrl: row.thumbnailUrl,
              detailText: row.detailText,
            }))
            const registrationRows = stackGuideRegistrations(label)
              .map(registration => {
                const layer = project.correctionLayers.find(item => item.layerId === registration.correctionLayerId)
                const assets = registration.assetIds.flatMap(assetId => {
                  const asset = project.assets.find(item => item.assetId === assetId)
                  return asset ? [asset] : []
                })
                return { layer, registration, assets }
              })
              .sort((a, b) =>
                (a.layer?.order ?? Number.MAX_SAFE_INTEGER) - (b.layer?.order ?? Number.MAX_SAFE_INTEGER)
                || a.registration.correctionLayerId.localeCompare(b.registration.correctionLayerId, 'ja'),
              )

            return (
              <article
                key={label.labelId}
                className={[
                  'registeredCellCard',
                  'stackGuideCard',
                  registeredCellViewMode === 'list' ? 'compact' : '',
                ].filter(Boolean).join(' ')}
                data-stack-guide-label-id={label.labelId}
                draggable={false}
                onPointerDown={event => {
                  if (stackGuideStackBand(label) !== 'cell-interleave') return
                  const dragSource = event.currentTarget
                  startInternalPointerDrag(event, {
                    begin: () => ({ kind: 'stack-guide', labelId: label.labelId }),
                    onStarted: () => setCardHoverPreview(null),
                    createDragGhost: () => createInternalDragCardImage(label.label, kindLabel, dragSource),
                  })
                }}
                onMouseEnter={event => showCardHoverPreview(event, label.label, thumbnailRows)}
                onMouseLeave={() => setCardHoverPreview(null)}
              >
                <div className="registeredCellHeader">
                  <div className="registeredCellIdentity" aria-label={uiText.stackGuides.cardLabel(label.label)}>
                    <span className="registeredCellRoleBadge">{kindLabel}</span>
                    <span className="registeredCellTrackBadge">{label.label}</span>
                    {registeredCellViewMode === 'list' && processLabels.length > 0 && (
                      <span className="registeredCellProcessStrip" aria-label={uiText.keys.imageAsset}>
                        {processLabels.map(processLabel => <span className="registeredCellAssetProcess" key={processLabel}>{processLabel}</span>)}
                      </span>
                    )}
                  </div>
                  {rows.length > 0 && (
                    <Tooltip label={uiText.assets.quickPreview}>
                      <button
                        type="button"
                        className="registeredCellPreviewButton"
                        aria-label={uiText.assets.previewDialog(label.label)}
                        draggable={false}
                        onClick={event => {
                          event.stopPropagation()
                          void openPreviewForStackGuideLabel(label)
                        }}
                        onPointerDown={event => event.stopPropagation()}
                      >
                        <span className="assetQuickPreviewIcon" aria-hidden="true" />
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip label={uiText.keys.delete}>
                    <button
                      type="button"
                      className="registeredCellDeleteButton"
                      aria-label={uiText.keys.deleteLabel(label.label)}
                      draggable={false}
                      onClick={event => {
                        event.stopPropagation()
                        onDeleteStackGuideLabel(label.labelId)
                      }}
                      onPointerDown={event => event.stopPropagation()}
                      onDragStart={event => {
                        event.preventDefault()
                        event.stopPropagation()
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </Tooltip>
                </div>
                {registeredCellViewMode === 'detail' && (
                  <>
                    <label className="registeredCellField">
                      <span>{uiText.stackGuides.label}</span>
                      <input value={label.label} onChange={event => onUpdateStackGuideLabel(label.labelId, { label: event.currentTarget.value })} />
                    </label>
                    <div className="registeredCellMeta">
                      <span>{uiText.stackGuides.registrations}</span>
                      <div className="stackGuideRegistrationList">
                        {registrationRows.length === 0
                          ? <span className="registeredCellAssetEmpty">{uiText.app.unassigned}</span>
                          : registrationRows.map(row => (
                            <div
                              className="stackGuideRegistrationRow"
                              key={row.registration.registrationId}
                              data-stack-guide-label-id={label.labelId}
                              data-correction-layer-id={row.registration.correctionLayerId}
                            >
                              <span className="registeredCellAssetProcess">{row.layer?.label ?? row.registration.correctionLayerId}</span>
                              <input
                                aria-label={`${row.layer?.label ?? row.registration.correctionLayerId} ${uiText.keys.cspCellName}`}
                                value={stackGuideCspCellName(label, row.registration)}
                                onChange={event => onUpdateStackGuideRegistration(label.labelId, row.registration.correctionLayerId, event.currentTarget.value)}
                              />
                              <Tooltip label={`${row.layer?.label ?? row.registration.correctionLayerId}: ${stackGuideCspCellName(label, row.registration)}`}>
                                <strong>{row.assets.length > 0 ? row.assets.map(asset => asset.displayName).join(', ') : uiText.app.unassigned}</strong>
                              </Tooltip>
                            </div>
                          ))}
                      </div>
                    </div>
                  </>
                )}
              </article>
            )
          })}
            </>
          )}
      </section>
      {stackGuideDrop && (
        <div className="stackGuideDropMenuScrim" onPointerDown={() => setStackGuideDrop(null)}>
          <div
            className="stackGuideDropMenu"
            style={stackGuideDropMenuStyle(stackGuideDrop.x, stackGuideDrop.y)}
            role="menu"
            aria-label={uiText.stackGuides.selectCorrectionLayer}
            onPointerDown={event => event.stopPropagation()}
          >
            <strong>{uiText.stackGuides.selectCorrectionLayer}</strong>
            {project.correctionLayers
              .slice()
              .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'ja'))
              .map(layer => {
                const label = project.stackGuideLabels.find(item => item.labelId === stackGuideDrop.labelId)
                const registration = label ? stackGuideRegistrationForLayer(label, layer.layerId) : undefined
                const assetCount = registration?.assetIds.length ?? 0
                return (
                  <button
                    type="button"
                    key={layer.layerId}
                    role="menuitem"
                    onClick={() => {
                      onAssignAssetToStackGuideLabel(stackGuideDrop.labelId, stackGuideDrop.assetId, layer.layerId)
                      setStackGuideDrop(null)
                    }}
                  >
                    <span>{layer.label}</span>
                    <small>{registration ? uiText.stackGuides.registeredAssetCount(assetCount) : uiText.stackGuides.unregistered}</small>
                  </button>
                )
              })}
          </div>
        </div>
      )}
      {processMoveMenu && (
        <ProcessMoveMenu
          project={project}
          keyId={processMoveMenu.keyId}
          sourceSlotId={processMoveMenu.sourceSlotId}
          x={processMoveMenu.x}
          y={processMoveMenu.y}
          onSelect={targetCorrectionLayerId => {
            onMoveKeyBindingProcess(processMoveMenu.keyId, processMoveMenu.sourceSlotId, targetCorrectionLayerId)
            setProcessMoveMenu(null)
          }}
          onCancel={() => setProcessMoveMenu(null)}
        />
      )}
      {embeddedPreviewOpen && activeEmbeddedPreviewPayload && (
        <AssetFloatingPreview
          payload={activeEmbeddedPreviewPayload}
          rect={previewRect}
          isDragPassthrough={false}
          onRectChange={updatePreviewRect}
          onClose={() => {
            setEmbeddedPreviewOpen(false)
            setEmbeddedPreviewKind(null)
          }}
        />
      )}
      {cardHoverPreview && (
        <RegisteredCellHoverPreviewOverlay
          project={project}
          rows={cardHoverPreview.rows}
          label={cardHoverPreview.label}
          style={cardHoverPreview.style}
        />
      )}
    </div>
  )
}
