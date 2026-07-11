import { useMemo, type DragEvent } from 'react'
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
        <div>
          <strong>CSPレイヤー構成</strong>
          <span>パレット表示順</span>
        </div>
        <span className="cspLayerDirection">上</span>
      </header>
      <div className="cspLayerTreeBody">
        <div className="cspLayerBoundary">CSPパレット上端</div>
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
                      <span className="cspTreeTrackName">{track.label}</span>
                      <span className="cspTreeTrackOrder">#{track.stackOrder}</span>
                      {track.stackItemId && <div className="cspTreeMoveButtons">
                        <Tooltip label="CSPパレットで1段上へ移動">
                          <button type="button" aria-label={`${track.label}を上へ`} onClick={() => onMoveStackItem(track.stackItemId!, 'up')}>↑</button>
                        </Tooltip>
                        <Tooltip label="CSPパレットで1段下へ移動">
                          <button type="button" aria-label={`${track.label}を下へ`} onClick={() => onMoveStackItem(track.stackItemId!, 'down')}>↓</button>
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
        <div className="cspLayerBoundary bottom">CSPパレット下端</div>
      </div>
    </section>
  )
}
