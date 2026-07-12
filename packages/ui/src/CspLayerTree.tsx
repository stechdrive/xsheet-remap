import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { buildCspLayerTree, type CspLayerTreeCel, type CspLayerTreeTrack, type CutProject, type StackGuideLabel } from '@xsheet-remap/core'
import { ActionMenu } from './AppControls'
import { createInternalDragCardImage, startInternalPointerDrag, subscribeInternalDrag, type InternalDragPayload } from './internalDrag'
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
  onUpdateKey,
  onDeleteKey,
  activeCorrectionLayerId,
  onUpdateCspCellName,
  onMoveKeyBindingProcess,
  onUpdateStackGuideRegistration,
  onUpdateStackGuideLabel,
  onDeleteStackGuideLabel,
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
  onUpdateKey: (keyId: string, displayLabel: string) => void
  onDeleteKey: (keyId: string, bindingId?: string) => void | Promise<void>
  activeCorrectionLayerId: string
  onUpdateCspCellName: (keyId: string, slotId: string, cspCellName: string) => void
  onMoveKeyBindingProcess: (keyId: string, sourceSlotId: string, targetCorrectionLayerId: string) => void
  onUpdateStackGuideRegistration: (labelId: string, correctionLayerId: string, cspCellName: string) => void
  onUpdateStackGuideLabel: (labelId: string, updates: { label: string }) => void
  onDeleteStackGuideLabel: (labelId: string) => void
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
  const assetsById = useMemo(() => new Map(project.assets.map(asset => [asset.assetId, asset])), [project.assets])
  const [auxiliaryDraft, setAuxiliaryDraft] = useState<{
    correctionLayerId: string
    kind: Extract<StackGuideLabel['kind'], 'camera-note' | 'memo'>
    label: string
  } | null>(null)
  const [assetDropTrackNodeId, setAssetDropTrackNodeId] = useState<string | null>(null)
  const [assetDropCelNodeId, setAssetDropCelNodeId] = useState<string | null>(null)
  const [assetDropGapId, setAssetDropGapId] = useState<string | null>(null)
  const [activeAssetDragCount, setActiveAssetDragCount] = useState(0)
  const [newTrackDraft, setNewTrackDraft] = useState<{
    correctionLayerId: string
    gapIndex: number
    assetIds: string[]
    paperTrack: string
    insertAfterPaperTrack?: string
  } | null>(null)
  const [dropNotice, setDropNotice] = useState<string | null>(null)
  const treeRootRef = useRef<HTMLElement | null>(null)

  function handleAssetDrop(assetIds: string[], keyId: string, slotId?: string) {
    if (assetIds.length !== 1) {
      setDropNotice('登録済みカードへ割り当てる画像素材は1件だけ選択してください。')
      return
    }
    onAssignAsset(assetIds[0]!, keyId, slotId)
    setDropNotice('画像素材を登録しました。')
  }

  function handleStackGuideAssetDrop(
    assetIds: string[],
    labelId: string,
    correctionLayerId: string,
  ) {
    if (assetIds.length !== 1) {
      setDropNotice('BG／BOOK・撮影指示・メモへ登録する画像素材は1件だけ選択してください。')
      return
    }
    setAssetDropTrackNodeId(null)
    onAssignAssetsToStackGuideLabel(labelId, assetIds, correctionLayerId)
    setDropNotice('画像素材を登録しました。')
  }

  function handlePaperTrackDrop(payload: InternalDragPayload, slotId: string) {
    if (payload.kind === 'registered-cell') {
      setAssetDropTrackNodeId(null)
      if (payload.sourceSlotId) {
        const sourceSlot = project.cspTrackSlots.find(slot => slot.slotId === payload.sourceSlotId)
        const targetSlot = project.cspTrackSlots.find(slot => slot.slotId === slotId)
        if (!sourceSlot || !targetSlot || sourceSlot.paperTrack !== targetSlot.paperTrack) {
          setDropNotice('登録済みカードは同じセル列の工程間で移動してください。')
          return
        }
        if (sourceSlot.slotId === targetSlot.slotId) {
          setDropNotice('このカードは登録済みです。')
          return
        }
        if (!targetSlot.correctionLayerId) {
          setDropNotice('移動先の工程を特定できません。')
          return
        }
        onMoveKeyBindingProcess(payload.keyId, sourceSlot.slotId, targetSlot.correctionLayerId)
        setDropNotice('カードの工程を移動しました。')
        return
      }
      setDropNotice(onRegisterKeyToTrack(payload.keyId, slotId) ? '未登録カードを工程へ登録しました。' : 'このカードは登録済みです。')
      return
    }
    if (payload.kind !== 'asset') return
    setAssetDropTrackNodeId(null)
    setDropNotice(assetRegistrationNotice(onRegisterAssetsToTrack(slotId, payload.assetIds)))
  }

  function handleCorrectionLayerDrop(payload: Extract<InternalDragPayload, { kind: 'registered-cell' }>, correctionLayerId: string) {
    const key = project.logicalSheet.keys.find(item => item.keyId === payload.keyId)
    const sourceSlot = payload.sourceSlotId
      ? project.cspTrackSlots.find(slot => slot.slotId === payload.sourceSlotId)
      : undefined
    const paperTrack = sourceSlot?.paperTrack ?? key?.paperTrack
    const targetSlot = paperTrack
      ? project.cspTrackSlots.find(slot => slot.paperTrack === paperTrack && slot.correctionLayerId === correctionLayerId)
      : undefined
    if (!targetSlot) {
      setDropNotice('この工程に対応するセル列がありません。')
      return
    }
    if (sourceSlot) {
      if (sourceSlot.slotId === targetSlot.slotId) {
        setDropNotice('このカードは登録済みです。')
        return
      }
      onMoveKeyBindingProcess(payload.keyId, sourceSlot.slotId, correctionLayerId)
      setDropNotice('カードの工程を移動しました。')
      return
    }
    setDropNotice(onRegisterKeyToTrack(payload.keyId, targetSlot.slotId) ? '未登録カードを工程へ登録しました。' : 'このカードは登録済みです。')
  }

  function activeSlotIdForTrack(track: CspLayerTreeTrack): string | undefined {
    return project.cspTrackSlots.find(slot =>
      slot.paperTrack === track.paperTrack
      && slot.correctionLayerId === activeCorrectionLayerId,
    )?.slotId
  }

  function beginNewTrackDrop(
    assetIds: string[],
    correctionLayerId: string,
    tracks: CspLayerTreeTrack[],
    gapIndex: number,
  ) {
    if (assetIds.length === 0) return
    setAssetDropGapId(null)
    setNewTrackDraft({
      correctionLayerId,
      gapIndex,
      assetIds,
      paperTrack: suggestedPaperTrackName(project, correctionLayerId, tracks),
      insertAfterPaperTrack: tracks.slice(gapIndex).find(track => track.paperTrack)?.paperTrack,
    })
  }

  useEffect(() => subscribeInternalDrag(detail => {
    if (detail.payload.kind !== 'asset' && detail.payload.kind !== 'registered-cell') return
    const target = cspInternalDropTarget(treeRootRef.current, detail.clientX, detail.clientY, detail.payload)
    if (detail.phase === 'start' || detail.phase === 'move') {
      setActiveAssetDragCount(detail.payload.kind === 'asset' ? detail.payload.assetIds.length : 0)
      setAssetDropCelNodeId(detail.payload.kind === 'asset' && target?.kind === 'cel' ? target.celNodeId ?? null : null)
      setAssetDropTrackNodeId(target?.kind === 'track' ? target.trackNodeId ?? null : null)
      setAssetDropGapId(target?.gapId ?? null)
      return
    }
    setActiveAssetDragCount(0)
    setAssetDropCelNodeId(null)
    setAssetDropTrackNodeId(null)
    setAssetDropGapId(null)
    if (detail.phase !== 'drop' || !target) return

    if (target.kind === 'cel') {
      if (detail.payload.kind !== 'asset') return
      if (detail.payload.assetIds.length !== 1) {
        setDropNotice('複数素材はセル列の「カードを追加」へドロップしてください。')
        return
      }
      if (target.keyId) handleAssetDrop(detail.payload.assetIds, target.keyId, target.slotId)
      return
    }
    if (target.kind === 'track') {
      if (!target.correctionLayerId || !target.trackNodeId) return
      const layer = tree.stages.flatMap(stage => stage.layers).find(item => item.layerId === target.correctionLayerId)
      const track = layer?.tracks.find(item => item.nodeId === target.trackNodeId)
      if (!track) return
      if (track.stackGuideLabelId && detail.payload.kind === 'asset') {
        handleStackGuideAssetDrop(detail.payload.assetIds, track.stackGuideLabelId, target.correctionLayerId)
      } else if (track.slotId) {
        handlePaperTrackDrop(detail.payload, track.slotId)
      }
      return
    }
    if (detail.payload.kind === 'registered-cell') {
      if (target.correctionLayerId) handleCorrectionLayerDrop(detail.payload, target.correctionLayerId)
      return
    }
    if (!target.correctionLayerId || target.gapIndex === undefined) return
    const layer = tree.stages.flatMap(stage => stage.layers).find(item => item.layerId === target.correctionLayerId)
    if (layer) beginNewTrackDrop(detail.payload.assetIds, target.correctionLayerId, layer.tracks, target.gapIndex)
  }))

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
        data-csp-drop-kind="gap"
        data-csp-gap-id={gapId}
        data-csp-correction-layer-id={correctionLayerId}
        data-csp-gap-index={gapIndex}
      >
        {activeAssetDragCount > 0 && assetDropGapId === gapId && !editing && (
          <span className="cspTreeTrackInsertLabel">ここに新しいセル列を作成（{activeAssetDragCount}件）</span>
        )}
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
    const showSheetLabel = Boolean(cel.keyId && cel.displayLabel?.trim() && cel.displayLabel.trim() !== cel.cspCellName.trim())
    const asset = cel.assetId ? assetsById.get(cel.assetId) : undefined
    const selected = cel.keyId === selectedKeyId
    const assetDragOver = cel.nodeId === assetDropCelNodeId
    const assetDropInvalid = assetDragOver && activeAssetDragCount !== 1
    return (
      <div
        key={cel.nodeId}
        className={[
          'cspTreeCel',
          selected ? 'selected' : '',
          cel.materialState === 'assigned' ? 'assigned' : '',
          cel.keyId && !cel.bindingId ? 'unregistered' : '',
          assetDragOver ? 'assetDragOver' : '',
          assetDropInvalid ? 'assetDropInvalid' : '',
        ].filter(Boolean).join(' ')}
        draggable={false}
        data-csp-drop-kind={cel.keyId ? 'cel' : undefined}
        data-csp-cel-node-id={cel.nodeId}
        data-csp-key-id={cel.keyId}
        data-csp-slot-id={assignmentSlotId}
        data-csp-paper-track={track.paperTrack}
        data-csp-sheet-role={cel.sheetRole}
        onPointerDown={cel.keyId ? event => {
          const dragSource = event.currentTarget
          startInternalPointerDrag(event, {
            begin: () => ({ kind: 'registered-cell', keyId: cel.keyId!, sourceSlotId: cel.bindingId ? track.slotId : undefined }),
            createDragGhost: () => createInternalDragCardImage(track.label, cel.cspCellName, dragSource),
          })
        } : undefined}
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
        {asset && !cel.keyId && <span className="cspTreeSheetLabel" title={asset.displayName}>{asset.displayName}</span>}
        <span className="cspTreeAssetState" title={asset ? `素材: ${asset.displayName}` : '素材未割当'}>{asset ? '●' : '○'}</span>
        {selected && cel.keyId && (
          <div className="cspTreeCelDetails" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
            <label className="cspTreeSheetNameField">
              <span>シート</span>
              <input
                aria-label={`${track.label} ${cel.displayLabel || cel.cspCellName}のシート表示名`}
                value={cel.displayLabel ?? ''}
                onChange={event => onUpdateKey(cel.keyId!, event.currentTarget.value)}
              />
            </label>
            {asset && <span className="cspTreeAssetName" title={asset.displayName}>{asset.displayName}</span>}
            <Tooltip label={cel.bindingId ? 'この工程のカードを削除' : '登録セルを削除'}>
              <button
                type="button"
                className="cspTreeDeleteButton"
                aria-label={`${track.label} ${cel.displayLabel || cel.cspCellName}を削除`}
                onClick={() => onDeleteKey(cel.keyId!, cel.bindingId)}
              >
                <DeleteIcon />
              </button>
            </Tooltip>
          </div>
        )}
        {assetDragOver && (
          <span className="cspTreeCelDropLabel">
            {assetDropInvalid
              ? `複数素材は「${track.label}列にカードを追加」へ`
              : asset
                ? `${cel.cspCellName}の素材を差し替え`
                : `${cel.cspCellName}へ素材を割り当て`}
          </span>
        )}
      </div>
    )
  }

  return (
    <section ref={treeRootRef} className="cspLayerTree" aria-label="CSPレイヤー構成">
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
                    data-csp-drop-kind={layer.layerId ? 'gap' : undefined}
                    data-csp-gap-id={layer.layerId ? `${layer.layerId}:0` : undefined}
                    data-csp-correction-layer-id={layer.layerId}
                    data-csp-gap-index={layer.layerId ? 0 : undefined}
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
                    const assetDropZoneLabel = acceptsStackGuideAsset
                      ? `${track.label}（${layer.label}）へ画像素材を割り当て`
                      : `${track.label}（${layer.label}）にカードを追加`
                    return (
                    <Fragment key={track.nodeId}>
                    <div
                      className={[
                        'cspTreeTrack',
                      ].filter(Boolean).join(' ')}
                      data-csp-drop-kind={track.slotId ? 'track' : undefined}
                      data-csp-track-node-id={track.slotId ? track.nodeId : undefined}
                      data-csp-correction-layer-id={(track.slotId || track.stackGuideLabelId) ? layer.layerId : undefined}
                      data-csp-native-drop-kind={acceptsPaperTrackAsset ? 'paper-track' : acceptsStackGuideAsset ? 'stack-guide' : undefined}
                      data-csp-slot-id={track.slotId}
                      data-csp-stack-guide-label-id={track.stackGuideLabelId}
                      onPointerDown={track.stackGuideLabelId ? event => {
                        const dragSource = event.currentTarget
                        startInternalPointerDrag(event, {
                          begin: () => ({ kind: 'stack-guide', labelId: track.stackGuideLabelId! }),
                          createDragGhost: () => createInternalDragCardImage(layer.label, track.label, dragSource),
                        })
                      } : undefined}
                    >
                    <div className="cspTreeTrackRow">
                      {track.paperTrack ? (
                        <PaperTrackNameInput
                          key={`${track.paperTrack}:${track.label}`}
                          paperTrack={track.paperTrack}
                          label={track.label}
                          onCommit={onRenamePaperTrack}
                        />
                      ) : track.stackGuideLabelId ? (
                        <StackGuideTrackNameInput
                          key={`${track.stackGuideLabelId}:${track.label}`}
                          labelId={track.stackGuideLabelId}
                          label={track.label}
                          onCommit={(labelId, label) => onUpdateStackGuideLabel(labelId, { label })}
                        />
                      ) : <span className="cspTreeTrackName">{track.label}</span>}
                      {track.stackItemId && <div className="cspTreeMoveButtons">
                        <Tooltip label="CSPで1段上へ（紙シートでは右へ）">
                          <button type="button" aria-label={`${track.label}をCSPで上へ（シートで右へ）`} onClick={() => onMoveStackItem(track.stackItemId!, 'up')}>↑</button>
                        </Tooltip>
                        <Tooltip label="CSPで1段下へ（紙シートでは左へ）">
                          <button type="button" aria-label={`${track.label}をCSPで下へ（シートで左へ）`} onClick={() => onMoveStackItem(track.stackItemId!, 'down')}>↓</button>
                        </Tooltip>
                        {track.stackGuideLabelId && (
                          <Tooltip label={`${track.label}を削除`}>
                            <button
                              type="button"
                              className="cspTreeTrackDeleteButton"
                              aria-label={`${track.label}を削除`}
                              onClick={() => onDeleteStackGuideLabel(track.stackGuideLabelId!)}
                            >
                              <DeleteIcon />
                            </button>
                          </Tooltip>
                        )}
                      </div>}
                    </div>
                    <div className="cspTreeCels">
                      {track.cels.length === 0 && <span className="cspTreeNoCels">カードなし</span>}
                      {track.cels.map(cel => renderCelCard(track, cel, layer.layerId))}
                    </div>
                    {acceptsAsset && (
                      <div
                        className={[
                          'cspTreeAssetDropZone',
                          activeAssetDragCount > 0 ? 'active' : '',
                          assetDropTrackNodeId === track.nodeId ? 'assetDragOver' : '',
                        ].filter(Boolean).join(' ')}
                        aria-label={assetDropZoneLabel}
                        data-csp-drop-kind="track-add"
                        data-csp-track-node-id={track.nodeId}
                        data-csp-correction-layer-id={layer.layerId}
                      >
                        {acceptsStackGuideAsset
                          ? `${track.label}へ素材を割り当て`
                          : activeAssetDragCount > 0
                            ? `${track.label}列に${activeAssetDragCount}件のカードを追加`
                            : `${track.label}列にカードを追加`}
                      </div>
                    )}
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

function DeleteIcon() {
  return (
    <svg className="topIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="m7 7 1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  )
}

interface CspInternalDropTarget {
  kind: 'cel' | 'track' | 'gap'
  celNodeId?: string
  keyId?: string
  slotId?: string
  trackNodeId?: string
  correctionLayerId?: string
  gapId?: string
  gapIndex?: number
}

function cspInternalDropTarget(
  root: HTMLElement | null,
  clientX: number,
  clientY: number,
  payload: Extract<InternalDragPayload, { kind: 'asset' | 'registered-cell' }>,
): CspInternalDropTarget | null {
  const element = document.elementFromPoint?.(clientX, clientY)
  if (!root || !element || !root.contains(element)) return null

  if (payload.kind === 'asset') {
    const cel = element.closest<HTMLElement>('[data-csp-drop-kind="cel"][data-csp-key-id][data-csp-cel-node-id]')
    if (cel && root.contains(cel)) {
      const keyId = cel.dataset.cspKeyId
      const celNodeId = cel.dataset.cspCelNodeId
      if (keyId && celNodeId) return {
        kind: 'cel',
        celNodeId,
        keyId,
        slotId: cel.dataset.cspSlotId,
      }
    }

    const assetTarget = element.closest<HTMLElement>('[data-csp-drop-kind="track-add"][data-csp-track-node-id][data-csp-correction-layer-id]')
    if (assetTarget && root.contains(assetTarget)) {
      const trackNodeId = assetTarget.dataset.cspTrackNodeId
      const correctionLayerId = assetTarget.dataset.cspCorrectionLayerId
      if (trackNodeId && correctionLayerId) return { kind: 'track', trackNodeId, correctionLayerId }
    }
  }

  if (payload.kind === 'registered-cell') {
    const track = element.closest<HTMLElement>('[data-csp-drop-kind="track"][data-csp-track-node-id][data-csp-correction-layer-id]')
    if (track && root.contains(track)) {
      const trackNodeId = track.dataset.cspTrackNodeId
      const correctionLayerId = track.dataset.cspCorrectionLayerId
      if (trackNodeId && correctionLayerId) return { kind: 'track', trackNodeId, correctionLayerId }
    }
  }

  const gap = element.closest<HTMLElement>('[data-csp-drop-kind="gap"][data-csp-gap-id][data-csp-correction-layer-id][data-csp-gap-index]')
  if (gap && root.contains(gap)) {
    const gapId = gap.dataset.cspGapId
    const correctionLayerId = gap.dataset.cspCorrectionLayerId
    const gapIndex = Number(gap.dataset.cspGapIndex)
    if (gapId && correctionLayerId && Number.isInteger(gapIndex)) return { kind: 'gap', gapId, correctionLayerId, gapIndex }
  }
  return null
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

function StackGuideTrackNameInput({
  labelId,
  label,
  onCommit,
}: {
  labelId: string
  label: string
  onCommit: (labelId: string, label: string) => void
}) {
  const [draft, setDraft] = useState(label)

  function commit() {
    const name = draft.trim()
    if (name && name !== label) onCommit(labelId, name)
    setDraft(label)
  }

  return (
    <input
      className="cspTreeTrackNameInput"
      aria-label={`${label}の追加トラック名`}
      title="追加トラック名"
      value={draft}
      onChange={event => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          setDraft(label)
          event.currentTarget.blur()
        }
      }}
    />
  )
}
