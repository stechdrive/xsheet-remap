import { useMemo, useState, type DragEvent, type KeyboardEvent } from 'react'
import { buildCspLayerTree, type CutProject } from '@xsheet-remap/core'
import { assetIdFromAssetDragData, hasAssetDragPayload } from './assetFiles'
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
}) {
  const tree = useMemo(() => buildCspLayerTree(project, exportProfileId), [exportProfileId, project])

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

  return (
    <section className="cspLayerTree" aria-label="CSPレイヤー構成">
      <header className="cspLayerTreeHeader">
        <strong>CSPレイヤー構成</strong>
      </header>
      <div className="cspLayerTreeBody">
        {tree.stages.length === 0 && <p className="cspLayerTreeEmpty">登録済みのレイヤーはありません。</p>}
        {tree.stages.map(stage => (
          <details className="cspTreeStage" key={stage.nodeId} open>
            <summary>{stage.label}</summary>
            {stage.layers.map(layer => (
              <details className="cspTreeLayer" key={layer.nodeId} open>
                <summary>{layer.label}</summary>
                {layer.tracks.map(track => (
                  <div className="cspTreeTrack" key={track.nodeId}>
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
                ))}
              </details>
            ))}
          </details>
        ))}
      </div>
    </section>
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
