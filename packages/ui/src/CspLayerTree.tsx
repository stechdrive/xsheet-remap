import { useMemo, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import { buildCspLayerTree, type CutProject, type StackGuideLabel } from '@xsheet-remap/core'
import { assetIdFromAssetDragData, hasAssetDragPayload } from './assetFiles'
import { ActionMenu } from './AppControls'
import { REGISTERED_CELL_DRAG_MIME, REGISTERED_CELL_TEXT_DRAG_PREFIX } from './sheetConstants'
import { Tooltip } from './Tooltip'

export function CspLayerTree({
  project,
  exportProfileId,
  selectedKeyId,
  onSelectKey,
  onJumpToFirstUse,
  onUpdateCspCellName,
  onUpdateStackGuideRegistration,
  onRenamePaperTrack,
  onMoveStackItem,
  onAssignAsset,
  onAssignAssetToStackGuideLabel,
  onRequestOverlayPaperTrack,
  onRequestStackGuideInsert,
  onCreateStackGuideLabel,
}: {
  project: CutProject
  exportProfileId?: string
  selectedKeyId: string | null
  onSelectKey: (keyId: string | null) => void
  onJumpToFirstUse: (keyId: string) => void
  onUpdateCspCellName: (keyId: string, slotId: string, cspCellName: string) => void
  onUpdateStackGuideRegistration: (labelId: string, correctionLayerId: string, cspCellName: string) => void
  onRenamePaperTrack: (paperTrack: string, name: string) => void
  onMoveStackItem: (itemId: string, direction: 'up' | 'down') => void
  onAssignAsset: (assetId: string, keyId: string) => void
  onAssignAssetToStackGuideLabel: (labelId: string, assetId: string, correctionLayerId: string) => void
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

  function handleCelDragStart(event: DragEvent<HTMLElement>, keyId: string) {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(REGISTERED_CELL_DRAG_MIME, keyId)
    event.dataTransfer.setData('text/plain', `${REGISTERED_CELL_TEXT_DRAG_PREFIX}${keyId}`)
  }

  function handleAssetDrop(event: DragEvent<HTMLElement>, keyId: string) {
    const assetId = assetIdFromAssetDragData(event.dataTransfer)
    if (!assetId) return
    event.preventDefault()
    event.stopPropagation()
    onAssignAsset(assetId, keyId)
  }

  function handleStackGuideAssetDrop(
    event: DragEvent<HTMLElement>,
    labelId: string,
    correctionLayerId: string,
  ) {
    const assetId = assetIdFromAssetDragData(event.dataTransfer)
    if (!assetId) return
    event.preventDefault()
    event.stopPropagation()
    setAssetDropTrackNodeId(null)
    onAssignAssetToStackGuideLabel(labelId, assetId, correctionLayerId)
  }

  return (
    <section className="cspLayerTree" aria-label="CSPレイヤー構成">
      <header className="cspLayerTreeHeader">
        <strong>CSPレイヤー構成</strong>
        <Tooltip label="紙シート上にセル列を追加">
          <button type="button" className="cspTreeAddCellButton" aria-label="セル列を追加" onClick={onRequestOverlayPaperTrack}>
            <PlusIcon />
          </button>
        </Tooltip>
      </header>
      <div className="cspLayerTreeBody">
        {tree.stages.length === 0 && <p className="cspLayerTreeEmpty">登録済みのレイヤーはありません。</p>}
        {tree.stages.map(stage => (
          <details className="cspTreeStage" key={stage.nodeId} open>
            <summary>{stage.label}</summary>
            {stage.layers.map(layer => (
              <div className="cspTreeLayerShell" key={layer.nodeId}>
                <details className="cspTreeLayer" open>
                  <summary>{layer.label}</summary>
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
                  {layer.tracks.map(track => {
                    const acceptsStackGuideAsset = Boolean(track.stackGuideLabelId && layer.layerId)
                    return (
                    <div
                      className={[
                        'cspTreeTrack',
                        acceptsStackGuideAsset ? 'stackGuideAssetDropTarget' : '',
                        assetDropTrackNodeId === track.nodeId ? 'assetDragOver' : '',
                      ].filter(Boolean).join(' ')}
                      key={track.nodeId}
                      aria-label={acceptsStackGuideAsset ? `${track.label}（${layer.label}）へ画像素材を登録` : undefined}
                      onDragOver={acceptsStackGuideAsset ? event => {
                        if (!hasAssetDragPayload(event.dataTransfer)) return
                        event.preventDefault()
                        event.stopPropagation()
                        event.dataTransfer.dropEffect = 'copy'
                        setAssetDropTrackNodeId(track.nodeId)
                      } : undefined}
                      onDragLeave={acceptsStackGuideAsset ? event => {
                        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                        setAssetDropTrackNodeId(current => current === track.nodeId ? null : current)
                      } : undefined}
                      onDrop={acceptsStackGuideAsset && track.stackGuideLabelId && layer.layerId
                        ? event => handleStackGuideAssetDrop(event, track.stackGuideLabelId!, layer.layerId!)
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
                      {track.cels.length === 0 && <span className="cspTreeNoCels">イベントなし</span>}
                      {track.cels.map(cel => {
                        const editableBinding = Boolean(track.slotId && cel.keyId)
                        const editableGuide = Boolean(track.stackGuideLabelId && layer.layerId)
                        return (
                          <div
                            key={cel.nodeId}
                            className={[
                              'cspTreeCel',
                              cel.keyId === selectedKeyId ? 'selected' : '',
                              cel.materialState === 'assigned' ? 'assigned' : '',
                            ].filter(Boolean).join(' ')}
                            draggable={Boolean(cel.keyId)}
                            onDragStart={cel.keyId ? event => handleCelDragStart(event, cel.keyId!) : undefined}
                            onDragOver={cel.keyId ? event => {
                              if (hasAssetDragPayload(event.dataTransfer)) event.preventDefault()
                            } : undefined}
                            onDrop={cel.keyId ? event => handleAssetDrop(event, cel.keyId!) : undefined}
                            onClick={() => onSelectKey(cel.keyId ?? null)}
                            onDoubleClick={() => cel.keyId && onJumpToFirstUse(cel.keyId)}
                          >
                            <span className="cspTreeCelLabel">{cel.displayLabel ?? cel.cspCellName}</span>
                            {(editableBinding || editableGuide) ? (
                              <input
                                aria-label={`${track.label}のCSPセル名`}
                                value={cel.cspCellName}
                                onClick={event => event.stopPropagation()}
                                onChange={event => {
                                  if (track.slotId && cel.keyId) {
                                    onUpdateCspCellName(cel.keyId, track.slotId, event.currentTarget.value)
                                  } else if (track.stackGuideLabelId && layer.layerId) {
                                    onUpdateStackGuideRegistration(track.stackGuideLabelId, layer.layerId, event.currentTarget.value)
                                  }
                                }}
                              />
                            ) : <span className="cspTreeCelName">{cel.cspCellName}</span>}
                            <span className="cspTreeCelFrame">F{cel.firstFrame + 1}</span>
                            <span className="cspTreeAssetState" title={cel.assetId ? '素材割当済み' : '素材未割当'}>{cel.assetId ? '●' : '○'}</span>
                          </div>
                        )
                      })}
                    </div>
                    </div>
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
