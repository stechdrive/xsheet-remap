import { Fragment, useMemo, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import { buildCspLayerTree, defaultCspCellName, type CspLayerTreeCel, type CspLayerTreeTrack, type CutProject, type StackGuideLabel } from '@xsheet-remap/core'
import { assetIdFromAssetDragData, assetIdsFromAssetDragData, hasAssetDragPayload } from './assetFiles'
import { ActionMenu } from './AppControls'
import { REGISTERED_CELL_DRAG_MIME, REGISTERED_CELL_TEXT_DRAG_PREFIX } from './sheetConstants'
import { Tooltip } from './Tooltip'

export interface CspTreeAssetRegistrationResult {
  addedCount: number
  duplicateCount: number
  missingCount: number
}

export interface CspTreeNewTrackRegistrationInput {
  correctionLayerId: string
  assetIds: string[]
  paperTrack: string
  insertAfterPaperTrack?: string
}

export function CspLayerTree({
  project,
  exportProfileId,
  selectedKeyId,
  onSelectKey,
  onJumpToFirstUse,
  activeCorrectionLayerId,
  onUpdateCspCellName,
  onUpdateStackGuideRegistration,
  onRenamePaperTrack,
  onMoveStackItem,
  onAssignAsset,
  onAssignAssetsToStackGuideLabel,
  onRegisterAssetsToTrack,
  onRegisterAssetsToNewTrack,
  onRegisterKeyToTrack,
  onOpenNameNormalization,
  onRequestOverlayPaperTrack,
  onRequestStackGuideInsert,
  onCreateStackGuideLabel,
}: {
  project: CutProject
  exportProfileId?: string
  selectedKeyId: string | null
  onSelectKey: (keyId: string | null) => void
  onJumpToFirstUse: (keyId: string) => void
  activeCorrectionLayerId: string
  onUpdateCspCellName: (keyId: string, slotId: string, cspCellName: string) => void
  onUpdateStackGuideRegistration: (labelId: string, correctionLayerId: string, cspCellName: string) => void
  onRenamePaperTrack: (paperTrack: string, name: string) => void
  onMoveStackItem: (itemId: string, direction: 'up' | 'down') => void
  onAssignAsset: (assetId: string, keyId: string, slotId?: string) => void
  onAssignAssetsToStackGuideLabel: (labelId: string, assetIds: string[], correctionLayerId: string) => void
  onRegisterAssetsToTrack: (slotId: string, assetIds: string[]) => CspTreeAssetRegistrationResult
  onRegisterAssetsToNewTrack: (input: CspTreeNewTrackRegistrationInput) => CspTreeAssetRegistrationResult
  onRegisterKeyToTrack: (keyId: string, slotId: string) => boolean
  onOpenNameNormalization: () => void
  onRequestOverlayPaperTrack: () => void
  onRequestStackGuideInsert: (correctionLayerId: string) => void
  onCreateStackGuideLabel: (input: { label: string; kind: StackGuideLabel['kind']; gapIndex: number; correctionLayerId: string }) => void
}) {
  const tree = useMemo(() => buildCspLayerTree(project, exportProfileId), [exportProfileId, project])
  const [auxiliaryDraft, setAuxiliaryDraft] = useState<{
    correctionLayerId: string
    kind: Extract<StackGuideLabel['kind'], 'camera-note' | 'memo'>
    label: string
  } | null>(null)
  const [assetDropTrackNodeId, setAssetDropTrackNodeId] = useState<string | null>(null)
  const [assetDropGapId, setAssetDropGapId] = useState<string | null>(null)
  const [newTrackDraft, setNewTrackDraft] = useState<{
    correctionLayerId: string
    gapIndex: number
    assetIds: string[]
    paperTrack: string
    insertAfterPaperTrack?: string
  } | null>(null)
  const [dropNotice, setDropNotice] = useState<string | null>(null)

  function handleCelDragStart(event: DragEvent<HTMLElement>, keyId: string) {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(REGISTERED_CELL_DRAG_MIME, keyId)
    event.dataTransfer.setData('text/plain', `${REGISTERED_CELL_TEXT_DRAG_PREFIX}${keyId}`)
  }

  function handleAssetDrop(event: DragEvent<HTMLElement>, keyId: string, slotId?: string) {
    const assetIds = assetIdsFromAssetDragData(event.dataTransfer)
    if (assetIds.length > 1) return
    const assetId = assetIds[0] ?? assetIdFromAssetDragData(event.dataTransfer)
    if (!assetId) return
    event.preventDefault()
    event.stopPropagation()
    onAssignAsset(assetId, keyId, slotId)
  }

  function handleStackGuideAssetDrop(
    event: DragEvent<HTMLElement>,
    labelId: string,
    correctionLayerId: string,
  ) {
    const assetIds = assetIdsFromAssetDragData(event.dataTransfer)
    if (assetIds.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    setAssetDropTrackNodeId(null)
    onAssignAssetsToStackGuideLabel(labelId, assetIds, correctionLayerId)
    setDropNotice(assetRegistrationNotice({ addedCount: assetIds.length, duplicateCount: 0, missingCount: 0 }))
  }

  function handlePaperTrackAssetDrop(event: DragEvent<HTMLElement>, slotId: string) {
    const keyId = registeredCellKeyIdFromDrag(event)
    if (keyId) {
      event.preventDefault()
      event.stopPropagation()
      setAssetDropTrackNodeId(null)
      setDropNotice(onRegisterKeyToTrack(keyId, slotId) ? '未登録カードを工程へ登録しました。' : 'このカードは登録済みです。')
      return
    }
    const assetIds = assetIdsFromAssetDragData(event.dataTransfer)
    if (assetIds.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    setAssetDropTrackNodeId(null)
    setDropNotice(assetRegistrationNotice(onRegisterAssetsToTrack(slotId, assetIds)))
  }

  function activeSlotIdForTrack(track: CspLayerTreeTrack): string | undefined {
    return project.cspTrackSlots.find(slot =>
      slot.paperTrack === track.paperTrack
      && slot.correctionLayerId === activeCorrectionLayerId,
    )?.slotId
  }

  function beginNewTrackDrop(
    event: DragEvent<HTMLElement>,
    correctionLayerId: string,
    tracks: CspLayerTreeTrack[],
    gapIndex: number,
  ) {
    const assetIds = assetIdsFromAssetDragData(event.dataTransfer)
    if (assetIds.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    setAssetDropGapId(null)
    setNewTrackDraft({
      correctionLayerId,
      gapIndex,
      assetIds,
      paperTrack: suggestedPaperTrackName(project, correctionLayerId, tracks),
      insertAfterPaperTrack: tracks.slice(gapIndex).find(track => track.paperTrack)?.paperTrack,
    })
  }

  function submitNewTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!newTrackDraft) return
    const paperTrack = newTrackDraft.paperTrack.trim()
    if (!paperTrack) return
    const result = onRegisterAssetsToNewTrack({ ...newTrackDraft, paperTrack })
    setDropNotice(assetRegistrationNotice(result))
    setNewTrackDraft(null)
  }

  function renderNewTrackDropZone(
    correctionLayerId: string,
    layerLabel: string,
    tracks: CspLayerTreeTrack[],
    gapIndex: number,
  ) {
    const gapId = `${correctionLayerId}:${gapIndex}`
    const editing = newTrackDraft?.correctionLayerId === correctionLayerId && newTrackDraft.gapIndex === gapIndex
    return (
      <div
        className={[
          'cspTreeTrackInsertDropZone',
          tracks.length === 0 ? 'emptyLayer' : '',
          assetDropGapId === gapId ? 'assetDragOver' : '',
          editing ? 'editing' : '',
        ].filter(Boolean).join(' ')}
        aria-label={`${layerLabel}のセル列挿入位置${gapIndex + 1}`}
        onDragOver={event => {
          if (!hasAssetDragPayload(event.dataTransfer)) return
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'copy'
          setAssetDropGapId(gapId)
        }}
        onDragLeave={event => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          setAssetDropGapId(current => current === gapId ? null : current)
        }}
        onDrop={event => beginNewTrackDrop(event, correctionLayerId, tracks, gapIndex)}
      >
        {editing && newTrackDraft && (
          <form className="cspTreeNewTrackForm" onSubmit={submitNewTrack}>
            <input
              autoFocus
              aria-label={`${layerLabel}に追加するセル列名`}
              value={newTrackDraft.paperTrack}
              onFocus={event => event.currentTarget.select()}
              onChange={event => {
                const paperTrack = event.currentTarget.value
                setNewTrackDraft(current => current ? { ...current, paperTrack } : current)
              }}
              onKeyDown={event => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                setNewTrackDraft(null)
              }}
            />
            <button type="submit" aria-label="セル列を作成して素材を登録" title="確定">✓</button>
            <button type="button" aria-label="セル列の作成をキャンセル" title="キャンセル" onClick={() => setNewTrackDraft(null)}>×</button>
          </form>
        )}
      </div>
    )
  }

  function renderCelCard(track: CspLayerTreeTrack, cel: CspLayerTreeCel, correctionLayerId?: string) {
    const assignmentSlotId = track.slotId ?? activeSlotIdForTrack(track)
    const editableBinding = Boolean(track.slotId && cel.keyId)
    const editableGuide = Boolean(track.stackGuideLabelId && correctionLayerId)
    const automaticName = track.paperTrack && cel.displayLabel
      ? defaultCspCellName(cel.displayLabel, track.paperTrack)
      : ''
    const showSheetLabel = Boolean(cel.keyId && cel.displayLabel?.trim() && automaticName !== cel.cspCellName.trim())
    return (
      <div
        key={cel.nodeId}
        className={[
          'cspTreeCel',
          cel.keyId === selectedKeyId ? 'selected' : '',
          cel.materialState === 'assigned' ? 'assigned' : '',
          cel.keyId && !cel.bindingId ? 'unregistered' : '',
        ].filter(Boolean).join(' ')}
        draggable={Boolean(cel.keyId)}
        onDragStart={cel.keyId ? event => handleCelDragStart(event, cel.keyId!) : undefined}
        onDragOver={cel.keyId ? event => {
          if (hasAssetDragPayload(event.dataTransfer)) event.preventDefault()
        } : undefined}
        onDrop={cel.keyId ? event => handleAssetDrop(event, cel.keyId!, assignmentSlotId) : undefined}
        onClick={() => onSelectKey(cel.keyId ?? null)}
        onDoubleClick={() => cel.keyId && onJumpToFirstUse(cel.keyId)}
      >
        {(editableBinding || editableGuide) ? (
          <input
            className="cspTreeCelNameInput"
            aria-label={`${track.label}のCSPセル名`}
            value={cel.cspCellName}
            onClick={event => event.stopPropagation()}
            onChange={event => {
              if (track.slotId && cel.keyId) {
                onUpdateCspCellName(cel.keyId, track.slotId, event.currentTarget.value)
              } else if (track.stackGuideLabelId && correctionLayerId) {
                onUpdateStackGuideRegistration(track.stackGuideLabelId, correctionLayerId, event.currentTarget.value)
              }
            }}
          />
        ) : <span className="cspTreeCelName">{cel.cspCellName}</span>}
        {showSheetLabel && <span className="cspTreeSheetLabel">シート: {cel.displayLabel}</span>}
        <span className="cspTreeAssetState" title={cel.assetId ? '素材割当済み' : '素材未割当'}>{cel.assetId ? '●' : '○'}</span>
      </div>
    )
  }

  return (
    <section className="cspLayerTree" aria-label="CSPレイヤー構成">
      <header className="cspLayerTreeHeader">
        <strong>CSPレイヤー構成</strong>
        <div className="cspLayerTreeHeaderActions">
          <Tooltip label="CSPセル名と素材ファイル名をまとめて整える">
            <button type="button" className="cspTreeNormalizeButton" aria-label="名前を正規化" onClick={onOpenNameNormalization}>
              <NormalizeIcon />
            </button>
          </Tooltip>
          <Tooltip label="紙シート上にセル列を追加">
            <button type="button" className="cspTreeAddCellButton" aria-label="セル列を追加" onClick={onRequestOverlayPaperTrack}>
              <PlusIcon />
            </button>
          </Tooltip>
        </div>
      </header>
      <div className="cspLayerTreeBody">
        {dropNotice && <div className="cspTreeDropNotice" role="status">{dropNotice}</div>}
        {tree.unregisteredTracks.length > 0 && (
          <details className="cspTreeStage cspTreeUnregisteredStage" open>
            <summary>未登録</summary>
            {tree.unregisteredTracks.map(track => (
              <div className="cspTreeTrack cspTreeUnregisteredTrack" key={track.nodeId}>
                <div className="cspTreeTrackRow">
                  <span className="cspTreeTrackName">{track.label}</span>
                </div>
                <div className="cspTreeCels">
                  {track.cels.map(cel => renderCelCard(track, cel))}
                </div>
              </div>
            ))}
          </details>
        )}
        {tree.stages.length === 0 && tree.unregisteredTracks.length === 0 && <p className="cspLayerTreeEmpty">登録済みのレイヤーはありません。</p>}
        {tree.stages.map(stage => (
          <details className="cspTreeStage" key={stage.nodeId} open>
            <summary>{stage.label}</summary>
            {stage.layers.map(layer => (
              <div className="cspTreeLayerShell" key={layer.nodeId}>
                <details className="cspTreeLayer" open>
                  <summary
                    className={layer.layerId && assetDropGapId === `${layer.layerId}:0` ? 'assetDragOver' : undefined}
                    onDragOver={layer.layerId ? event => {
                      if (!hasAssetDragPayload(event.dataTransfer)) return
                      event.preventDefault()
                      event.stopPropagation()
                      event.dataTransfer.dropEffect = 'copy'
                      setAssetDropGapId(`${layer.layerId}:0`)
                    } : undefined}
                    onDragLeave={layer.layerId ? event => {
                      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                      setAssetDropGapId(current => current === `${layer.layerId}:0` ? null : current)
                    } : undefined}
                    onDrop={layer.layerId ? event => {
                      const details = event.currentTarget.parentElement
                      if (details instanceof HTMLDetailsElement) details.open = true
                      beginNewTrackDrop(event, layer.layerId!, layer.tracks, 0)
                    } : undefined}
                  >{layer.label}</summary>
                  {auxiliaryDraft && auxiliaryDraft.correctionLayerId === layer.layerId && (
                    <form
                      className="cspTreeAuxiliaryForm"
                      onSubmit={(event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault()
                        const label = auxiliaryDraft.label.trim()
                        if (!label || !layer.layerId) return
                        onCreateStackGuideLabel({
                          label,
                          kind: auxiliaryDraft.kind,
                          gapIndex: project.logicalSheet.paperTracks.length,
                          correctionLayerId: layer.layerId,
                        })
                        setAuxiliaryDraft(null)
                      }}
                    >
                      <input
                        autoFocus
                        aria-label="追加トラック名"
                        placeholder={auxiliaryDraft.kind === 'camera-note' ? 'SL1 / PAN1 / TU1' : 'MEMO1'}
                        value={auxiliaryDraft.label}
                        onChange={event => {
                          const label = event.currentTarget.value
                          setAuxiliaryDraft(current => current ? { ...current, label } : current)
                        }}
                      />
                      <button type="submit" aria-label="追加を確定" title="追加を確定">✓</button>
                      <button type="button" aria-label="追加をキャンセル" title="追加をキャンセル" onClick={() => setAuxiliaryDraft(null)}>×</button>
                    </form>
                  )}
                  {layer.tracks.length === 0 && <p className="cspTreeNoTracks">トラックなし</p>}
                  {layer.layerId && renderNewTrackDropZone(layer.layerId, layer.label, layer.tracks, 0)}
                  {layer.tracks.map((track, trackIndex) => {
                    const acceptsStackGuideAsset = Boolean(track.stackGuideLabelId && layer.layerId)
                    const acceptsPaperTrackAsset = Boolean(track.paperTrack && track.slotId)
                    const acceptsAsset = acceptsStackGuideAsset || acceptsPaperTrackAsset
                    return (
                    <Fragment key={track.nodeId}>
                    <div
                      className={[
                        'cspTreeTrack',
                        acceptsAsset ? 'assetDropTarget' : '',
                        assetDropTrackNodeId === track.nodeId ? 'assetDragOver' : '',
                      ].filter(Boolean).join(' ')}
                      aria-label={acceptsAsset ? `${track.label}（${layer.label}）へ画像素材を登録` : undefined}
                      onDragOver={acceptsAsset ? event => {
                        if (!hasAssetDragPayload(event.dataTransfer) && !(acceptsPaperTrackAsset && hasRegisteredCellDragPayload(event))) return
                        event.preventDefault()
                        event.stopPropagation()
                        event.dataTransfer.dropEffect = 'copy'
                        setAssetDropTrackNodeId(track.nodeId)
                      } : undefined}
                      onDragLeave={acceptsAsset ? event => {
                        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                        setAssetDropTrackNodeId(current => current === track.nodeId ? null : current)
                      } : undefined}
                      onDrop={acceptsStackGuideAsset && track.stackGuideLabelId && layer.layerId
                        ? event => handleStackGuideAssetDrop(event, track.stackGuideLabelId!, layer.layerId!)
                        : acceptsPaperTrackAsset && track.slotId
                          ? event => handlePaperTrackAssetDrop(event, track.slotId!)
                          : undefined}
                    >
                    <div className="cspTreeTrackRow">
                      {track.paperTrack ? (
                        <PaperTrackNameInput
                          key={`${track.paperTrack}:${track.label}`}
                          paperTrack={track.paperTrack}
                          label={track.label}
                          onCommit={onRenamePaperTrack}
                        />
                      ) : <span className="cspTreeTrackName">{track.label}</span>}
                      {track.stackItemId && <div className="cspTreeMoveButtons">
                        <Tooltip label="CSPで1段上へ（紙シートでは右へ）">
                          <button type="button" aria-label={`${track.label}をCSPで上へ（シートで右へ）`} onClick={() => onMoveStackItem(track.stackItemId!, 'up')}>↑</button>
                        </Tooltip>
                        <Tooltip label="CSPで1段下へ（紙シートでは左へ）">
                          <button type="button" aria-label={`${track.label}をCSPで下へ（シートで左へ）`} onClick={() => onMoveStackItem(track.stackItemId!, 'down')}>↓</button>
                        </Tooltip>
                      </div>}
                    </div>
                    <div className="cspTreeCels">
                      {track.cels.length === 0 && <span className="cspTreeNoCels">カードなし</span>}
                      {track.cels.map(cel => renderCelCard(track, cel, layer.layerId))}
                    </div>
                    </div>
                    {layer.layerId && renderNewTrackDropZone(layer.layerId, layer.label, layer.tracks, trackIndex + 1)}
                    </Fragment>
                    )
                  })}
                </details>
                {layer.layerId && (
                  <ActionMenu
                    label={<PlusIcon />}
                    ariaLabel={`${layer.label}にトラックを追加`}
                    tooltipLabel={`${layer.label}にトラックを追加`}
                    className="cspTreeLayerAddMenu iconActionMenu"
                    closeOnMenuItemClick
                  >
                    <button type="button" onClick={() => onRequestStackGuideInsert(layer.layerId!)}>BG／BOOK</button>
                    <button type="button" onClick={() => setAuxiliaryDraft({ correctionLayerId: layer.layerId!, kind: 'camera-note', label: '' })}>撮影指示</button>
                    <button type="button" onClick={() => setAuxiliaryDraft({ correctionLayerId: layer.layerId!, kind: 'memo', label: '' })}>メモ</button>
                  </ActionMenu>
                )}
              </div>
            ))}
          </details>
        ))}
      </div>
    </section>
  )
}

function PlusIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  )
}

function NormalizeIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h9" />
      <path d="M4 12h7" />
      <path d="M4 18h9" />
      <path d="m16 8 3-3 3 3" />
      <path d="M19 5v14" />
      <path d="m16 16 3 3 3-3" />
    </svg>
  )
}

function hasRegisteredCellDragPayload(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types ?? []).includes(REGISTERED_CELL_DRAG_MIME)
}

function registeredCellKeyIdFromDrag(event: DragEvent<HTMLElement>): string {
  const direct = event.dataTransfer.getData(REGISTERED_CELL_DRAG_MIME).trim()
  if (direct) return direct
  const text = event.dataTransfer.getData('text/plain')
  return text.startsWith(REGISTERED_CELL_TEXT_DRAG_PREFIX)
    ? text.slice(REGISTERED_CELL_TEXT_DRAG_PREFIX.length).trim()
    : ''
}

function assetRegistrationNotice(result: CspTreeAssetRegistrationResult): string {
  const parts = [`${result.addedCount}件追加`]
  if (result.duplicateCount > 0) parts.push(`${result.duplicateCount}件は登録済み`)
  if (result.missingCount > 0) parts.push(`${result.missingCount}件は素材なし`)
  return parts.join(' / ')
}

function suggestedPaperTrackName(project: CutProject, correctionLayerId: string, visibleTracks: CspLayerTreeTrack[]): string {
  const visiblePaperTracks = new Set(visibleTracks.flatMap(track => track.paperTrack ? [track.paperTrack] : []))
  const occupiedSlotIds = new Set(
    project.bindings
      .filter(binding => {
        const slot = project.cspTrackSlots.find(item => item.slotId === binding.slotId)
        return slot?.correctionLayerId === correctionLayerId
      })
      .map(binding => binding.slotId),
  )
  const availableTrack = project.logicalSheet.paperTracks.find(track => {
    const slot = project.cspTrackSlots.find(item => item.paperTrack === track.paperTrack && item.correctionLayerId === correctionLayerId)
    return slot && !occupiedSlotIds.has(slot.slotId) && !visiblePaperTracks.has(track.paperTrack)
  })
  if (availableTrack) return availableTrack.label || availableTrack.paperTrack

  const usedNames = new Set(project.logicalSheet.paperTracks.flatMap(track => [track.paperTrack, track.label]).map(name => name.toLocaleUpperCase()))
  for (let index = 0; index < 26; index += 1) {
    const candidate = String.fromCharCode('A'.charCodeAt(0) + index)
    if (!usedNames.has(candidate)) return candidate
  }
  return `セル列${project.logicalSheet.paperTracks.length + 1}`
}

function PaperTrackNameInput({
  paperTrack,
  label,
  onCommit,
}: {
  paperTrack: string
  label: string
  onCommit: (paperTrack: string, name: string) => void
}) {
  const [draft, setDraft] = useState(label)

  function commit() {
    const name = draft.trim()
    if (name && name !== label) onCommit(paperTrack, name)
    setDraft(label)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(label)
      event.currentTarget.blur()
    }
  }

  return (
    <input
      className="cspTreeTrackNameInput"
      aria-label={`${label}のセル列名`}
      title="セル列名"
      value={draft}
      onChange={event => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  )
}
