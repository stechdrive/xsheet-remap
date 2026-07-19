import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { buildCspLayerTree, defaultCorrectionLayerId, stackGuideStackBand, suggestUnplacedCspCellName, type CspLayerTreeCel, type CspLayerTreeTrack, type CutProject, type StackGuideLabel } from '@xsheet-remap/core'
import { ActionMenu } from './AppControls'
import { setInternalDragDropValidity, startInternalPointerDrag, subscribeInternalDrag, type InternalDragPayload } from './internalDrag'
import { autoScrollListForPointer, listReorderTargetFromContainer, type ListReorderTarget } from './listReorder'
import { correctionLayerIdForCspPaneSelection, cspPaneNodeCapabilities, cspPaneSelectionCurrentLabel, cspPaneSelectionExists, stackGuideSelectionBand, type CspPaneSelection } from './cspPaneModel'
import { nextOverlayTrackNameForUi } from './sheet-layers-hit-geometry'
import { Tooltip, TooltipTarget } from './Tooltip'

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
  onDeleteKey,
  activeCorrectionLayerId,
  onUpdateCspCellName,
  onMoveKeyBindingProcess,
  onUpdateStackGuideRegistration,
  onUpdateStackGuideLabel,
  onDeleteStackGuideLabel,
  onRenameProductionStage,
  onRenameCorrectionLayer,
  onRenamePaperTrack,
  onReorderStackItem,
  onReorderProductionStage,
  onReorderCorrectionLayer,
  onDeleteCorrectionLayer,
  onDeleteOverlayPaperTrack,
  onAssignAsset,
  onAssignAssetsToStackGuideLabel,
  onRegisterAssetsToTrack,
  onRegisterAssetsToNewTrack,
  onCreateUnplacedCard,
  onRegisterKeyToTrack,
  onOpenNameNormalization,
  onCreateDefaultOverlayPaperTrack,
  onCreateDefaultStackGuideLabel,
  onCreateStackGuideLabel,
}: {
  project: CutProject
  exportProfileId?: string
  selectedKeyId: string | null
  onSelectKey: (keyId: string | null) => void
  onDeleteKey: (keyId: string, bindingId?: string) => void | Promise<void>
  activeCorrectionLayerId: string
  onUpdateCspCellName: (keyId: string, slotId: string, cspCellName: string) => void
  onMoveKeyBindingProcess: (keyId: string, sourceSlotId: string, targetCorrectionLayerId: string) => void
  onUpdateStackGuideRegistration: (labelId: string, correctionLayerId: string, cspCellName: string) => void
  onUpdateStackGuideLabel: (labelId: string, updates: { label: string }) => void
  onDeleteStackGuideLabel: (labelId: string) => void
  onRenameProductionStage?: (stageId: string, label: string) => void
  onRenameCorrectionLayer?: (layerId: string, label: string) => void
  onRenamePaperTrack: (paperTrack: string, name: string) => void
  onReorderStackItem: (itemId: string, referenceItemId: string, edge: 'before' | 'after') => void
  onReorderProductionStage: (stageId: string, referenceStageId: string, edge: 'before' | 'after') => void
  onReorderCorrectionLayer: (layerId: string, referenceLayerId: string, edge: 'before' | 'after') => void
  onDeleteCorrectionLayer: (layerId: string) => void
  onDeleteOverlayPaperTrack: (paperTrack: string) => void | Promise<void>
  onAssignAsset: (assetId: string, keyId: string, slotId?: string) => void
  onAssignAssetsToStackGuideLabel: (labelId: string, assetIds: string[], correctionLayerId: string) => void
  onRegisterAssetsToTrack: (slotId: string, assetIds: string[]) => CspTreeAssetRegistrationResult
  onRegisterAssetsToNewTrack: (input: CspTreeNewTrackRegistrationInput) => CspTreeAssetRegistrationResult
  onCreateUnplacedCard?: (slotId: string, cspCellName: string) => string | null
  onRegisterKeyToTrack: (keyId: string, slotId: string) => boolean
  onOpenNameNormalization: () => void
  onCreateDefaultOverlayPaperTrack: (input: { paperTrack: string }) => void
  onCreateDefaultStackGuideLabel: (input: { label: string; correctionLayerId: string }) => void
  onCreateStackGuideLabel: (input: { label: string; kind: StackGuideLabel['kind']; gapIndex: number; correctionLayerId: string }) => void
}) {
  const tree = useMemo(() => buildCspLayerTree(project, exportProfileId), [exportProfileId, project])
  const assetsById = useMemo(() => new Map(project.assets.map(asset => [asset.assetId, asset])), [project.assets])
  const [auxiliaryDraft, setAuxiliaryDraft] = useState<{
    correctionLayerId: string
    kind: Extract<StackGuideLabel['kind'], 'camera-note' | 'memo'>
    label: string
  } | null>(null)
  const [paneAdditionDraft, setPaneAdditionDraft] = useState<{
    kind: 'overlay-track' | 'stack-guide'
    correctionLayerId: string
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
  const [newCelDraft, setNewCelDraft] = useState<{ slotId: string; cspCellName: string } | null>(null)
  const [dropNotice, setDropNotice] = useState<string | null>(null)
  const [paneSelectionState, setPaneSelection] = useState<CspPaneSelection | null>(null)
  const [paneDropTarget, setPaneDropTarget] = useState<(ListReorderTarget & { scope: string }) | null>(null)
  const [summaryRename, setSummaryRename] = useState<{
    kind: 'stage' | 'layer'
    id: string
    label: string
  } | null>(null)
  const treeRootRef = useRef<HTMLElement | null>(null)
  const treeBodyRef = useRef<HTMLDivElement | null>(null)
  const paneDropTargetRef = useRef<(ListReorderTarget & { scope: string }) | null>(null)
  const pendingKeySelectRef = useRef<number | null>(null)
  const suppressClickKeyRef = useRef<string | null>(null)
  const suppressPaneClickRef = useRef<string | null>(null)

  useEffect(() => () => {
    if (pendingKeySelectRef.current !== null) window.clearTimeout(pendingKeySelectRef.current)
  }, [])

  const paneSelection = useMemo<CspPaneSelection | null>(() => {
    const currentState = paneSelectionState && cspPaneSelectionExists(project, paneSelectionState)
      ? (() => {
          const currentLabel = cspPaneSelectionCurrentLabel(project, paneSelectionState)
          return currentLabel !== null && currentLabel !== paneSelectionState.label
            ? { ...paneSelectionState, label: currentLabel }
            : paneSelectionState
        })()
      : null
    if (!selectedKeyId) return currentState
    if ((currentState?.kind === 'registered-cell' || currentState?.kind === 'unregistered-cell') && currentState.keyId === selectedKeyId) return currentState
    const key = project.logicalSheet.keys.find(candidate => candidate.keyId === selectedKeyId)
    if (!key) return currentState
    const activeSlotIds = new Set(project.cspTrackSlots.filter(slot => slot.correctionLayerId === activeCorrectionLayerId).map(slot => slot.slotId))
    const binding = project.bindings.find(candidate => candidate.keyId === selectedKeyId && activeSlotIds.has(candidate.slotId))
      ?? project.bindings.find(candidate => candidate.keyId === selectedKeyId)
    const slot = binding ? project.cspTrackSlots.find(candidate => candidate.slotId === binding.slotId) : undefined
    return binding
      ? { kind: 'registered-cell', nodeId: `binding:${binding.bindingId}`, label: binding.cspCellName, keyId: selectedKeyId, bindingId: binding.bindingId, correctionLayerId: slot?.correctionLayerId, slotId: binding.slotId }
      : { kind: 'unregistered-cell', nodeId: `key:${selectedKeyId}`, label: key.displayLabel, keyId: selectedKeyId }
  }, [activeCorrectionLayerId, paneSelectionState, project, selectedKeyId])

  function cancelPendingKeySelect() {
    if (pendingKeySelectRef.current === null) return
    window.clearTimeout(pendingKeySelectRef.current)
    pendingKeySelectRef.current = null
  }

  function scheduleKeySelect(selection: CspPaneSelection) {
    cancelPendingKeySelect()
    pendingKeySelectRef.current = window.setTimeout(() => {
      pendingKeySelectRef.current = null
      selectPaneNode(selection)
    }, 250)
  }

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

  function selectPaneNode(selection: CspPaneSelection) {
    setPaneSelection(selection)
    if (selection.kind === 'registered-cell' || selection.kind === 'unregistered-cell') {
      onSelectKey(selection.keyId)
    } else {
      onSelectKey(null)
    }
  }

  function trackPaneSelection(track: CspLayerTreeTrack, correctionLayerId?: string): CspPaneSelection {
    if (track.stackGuideLabelId && track.stackItemId) {
      return {
        kind: 'stack-guide',
        nodeId: track.stackItemId,
        label: track.label,
        itemId: track.stackItemId,
        labelId: track.stackGuideLabelId,
        band: stackGuideSelectionBand(project, track.stackGuideLabelId),
        correctionLayerId,
      }
    }
    if (track.paperTrack && track.stackItemId) {
      const paperTrack = project.logicalSheet.paperTracks.find(item => item.paperTrack === track.paperTrack)
      return {
        kind: paperTrack?.source === 'overlay' ? 'overlay-track' : 'template-track',
        nodeId: track.stackItemId,
        label: track.label,
        itemId: track.stackItemId,
        paperTrack: track.paperTrack,
        correctionLayerId,
        slotId: track.slotId,
      }
    }
    return { kind: 'generated-readonly', nodeId: track.nodeId, label: track.label, correctionLayerId }
  }

  function paneReorderId(selection: CspPaneSelection): string | null {
    if (selection.kind === 'production-stage') return selection.stageId
    if (selection.kind === 'correction-layer') return selection.layerId
    if (selection.kind === 'template-track' || selection.kind === 'overlay-track' || selection.kind === 'stack-guide') return selection.itemId
    return null
  }

  function beginPaneNodeDrag(event: ReactPointerEvent<HTMLElement>, selection: CspPaneSelection) {
    const capabilities = cspPaneNodeCapabilities(project, selection)
    const reorderId = paneReorderId(selection)
    if (!capabilities.draggable || !capabilities.reorderScope || !reorderId) return
    if (
      selection.kind !== 'production-stage'
      && selection.kind !== 'correction-layer'
      && selection.kind !== 'template-track'
      && selection.kind !== 'overlay-track'
      && selection.kind !== 'stack-guide'
    ) return
    startInternalPointerDrag(event, {
      // The visible name occupies almost the entire row and doubles as the
      // rename trigger. Keep actual form controls/disclosure buttons inert,
      // but allow a thresholded drag to start from the name itself.
      interactiveTargetSelector: 'button,input,select,textarea,a,[contenteditable="true"]',
      begin: () => ({
        kind: 'csp-pane-node',
        nodeId: selection.nodeId,
        nodeKind: selection.kind,
        reorderId,
        reorderScope: capabilities.reorderScope!,
        ...(selection.kind === 'stack-guide' ? { stackGuideLabelId: selection.labelId } : {}),
      }),
      createPreview: () => ({ primaryText: selection.label, secondaryText: 'CSPレイヤー構成' }),
      onStarted: () => {
        selectPaneNode(selection)
        suppressPaneClickRef.current = selection.nodeId
      },
      onFinished: () => {
        window.setTimeout(() => {
          if (suppressPaneClickRef.current === selection.nodeId) suppressPaneClickRef.current = null
        }, 0)
      },
    })
  }

  function handlePaneNodeClick(selection: CspPaneSelection) {
    if (suppressPaneClickRef.current === selection.nodeId) {
      suppressPaneClickRef.current = null
      return
    }
    selectPaneNode(selection)
  }

  function paneReorderAttributes(selection: CspPaneSelection) {
    const capabilities = cspPaneNodeCapabilities(project, selection)
    const reorderId = paneReorderId(selection)
    return capabilities.draggable && capabilities.reorderScope && reorderId
      ? {
          'data-csp-pane-reorder-id': reorderId,
          'data-csp-pane-reorder-scope': capabilities.reorderScope,
        }
      : {}
  }

  function paneRowClass(selection: CspPaneSelection): string {
    const capabilities = cspPaneNodeCapabilities(project, selection)
    const reorderId = paneReorderId(selection)
    const activeDrop = paneDropTarget
      && paneDropTarget.scope === capabilities.reorderScope
      && paneDropTarget.referenceItemId === reorderId
      ? paneDropTarget
      : null
    return [
      paneSelection?.nodeId === selection.nodeId ? 'cspPaneSelected' : '',
      capabilities.draggable ? 'cspPaneDraggable' : '',
      activeDrop
        ? activeDrop.edge === 'before' ? 'cspPaneDropBefore' : 'cspPaneDropAfter'
        : '',
    ].filter(Boolean).join(' ')
  }

  function deleteSelectedPaneNode() {
    if (!paneSelection) return
    const capabilities = cspPaneNodeCapabilities(project, paneSelection)
    if (!capabilities.deletable) return
    if (paneSelection.kind === 'correction-layer') onDeleteCorrectionLayer(paneSelection.layerId)
    if (paneSelection.kind === 'overlay-track') void onDeleteOverlayPaperTrack(paneSelection.paperTrack)
    if (paneSelection.kind === 'stack-guide') onDeleteStackGuideLabel(paneSelection.labelId)
    if (paneSelection.kind === 'registered-cell') void onDeleteKey(paneSelection.keyId, paneSelection.bindingId)
    if (paneSelection.kind === 'unregistered-cell') void onDeleteKey(paneSelection.keyId)
    setPaneSelection(null)
  }

  useEffect(() => subscribeInternalDrag(detail => {
    if (detail.payload.kind === 'csp-pane-node') {
      const body = treeBodyRef.current
      const target = listReorderTargetFromContainer(body, detail.payload.reorderScope, detail.clientX, detail.clientY)
      if (detail.phase === 'start' || detail.phase === 'move') {
        if (target) {
          autoScrollListForPointer(body, detail.clientY)
          const nextTarget = { ...target, scope: detail.payload.reorderScope }
          paneDropTargetRef.current = nextTarget
          setPaneDropTarget(nextTarget)
          setInternalDragDropValidity('valid')
        } else {
          paneDropTargetRef.current = null
          setPaneDropTarget(null)
          setInternalDragDropValidity(null)
        }
        return
      }
      const lastTarget = paneDropTargetRef.current?.scope === detail.payload.reorderScope
        ? paneDropTargetRef.current
        : null
      paneDropTargetRef.current = null
      setPaneDropTarget(null)
      if (detail.phase !== 'drop') {
        setInternalDragDropValidity(null)
        return
      }
      const dropTarget = lastTarget ?? target
      if (!dropTarget) {
        setInternalDragDropValidity(null)
        return
      }
      if (detail.payload.nodeKind === 'production-stage') {
        onReorderProductionStage(detail.payload.reorderId, dropTarget.referenceItemId, dropTarget.edge)
      } else if (detail.payload.nodeKind === 'correction-layer') {
        onReorderCorrectionLayer(detail.payload.reorderId, dropTarget.referenceItemId, dropTarget.edge)
      } else {
        onReorderStackItem(detail.payload.reorderId, dropTarget.referenceItemId, dropTarget.edge)
      }
      setInternalDragDropValidity(null)
      return
    }
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

  function beginNewCel(slotId: string) {
    setNewCelDraft({
      slotId,
      cspCellName: suggestUnplacedCspCellName(project, slotId),
    })
  }

  function submitNewCel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!newCelDraft?.cspCellName.trim() || !onCreateUnplacedCard) return
    const keyId = onCreateUnplacedCard(newCelDraft.slotId, newCelDraft.cspCellName.trim())
    if (!keyId) return
    setNewCelDraft(null)
    onSelectKey(keyId)
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
            <TooltipTarget label="確定">
              {tooltipProps => <button type="submit" aria-label="セル列を作成して素材を登録" {...tooltipProps}>✓</button>}
            </TooltipTarget>
            <TooltipTarget label="キャンセル">
              {tooltipProps => <button type="button" aria-label="セル列の作成をキャンセル" onClick={() => setNewTrackDraft(null)} {...tooltipProps}>×</button>}
            </TooltipTarget>
          </form>
        )}
      </div>
    )
  }

  function renderCelCard(track: CspLayerTreeTrack, cel: CspLayerTreeCel, correctionLayerId?: string, correctionLayerLabel?: string) {
    const assignmentSlotId = track.slotId ?? activeSlotIdForTrack(track)
    const editableBinding = Boolean(track.slotId && cel.keyId)
    const editableGuide = Boolean(track.stackGuideLabelId && correctionLayerId)
    const showSheetLabel = Boolean(cel.keyId && cel.displayLabel?.trim() && cel.displayLabel.trim() !== cel.cspCellName.trim())
    const asset = cel.assetId ? assetsById.get(cel.assetId) : undefined
    const celSelection: CspPaneSelection = cel.keyId
      ? cel.bindingId
        ? { kind: 'registered-cell', nodeId: `binding:${cel.bindingId}`, label: cel.cspCellName, keyId: cel.keyId, bindingId: cel.bindingId, correctionLayerId, slotId: track.slotId }
        : { kind: 'unregistered-cell', nodeId: `key:${cel.keyId}`, label: cel.cspCellName, keyId: cel.keyId, correctionLayerId, slotId: assignmentSlotId }
      : trackPaneSelection(track, correctionLayerId)
    const selected = cel.keyId === selectedKeyId || paneSelection?.nodeId === celSelection.nodeId
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
        role="treeitem"
        aria-selected={selected}
        data-csp-drop-kind={cel.keyId ? 'cel' : undefined}
        data-csp-cel-node-id={cel.nodeId}
        data-csp-key-id={cel.keyId}
        data-csp-slot-id={assignmentSlotId}
        data-csp-paper-track={track.paperTrack}
        data-csp-sheet-role={cel.sheetRole}
        onPointerDown={cel.keyId ? event => {
          startInternalPointerDrag(event, {
            begin: () => ({ kind: 'registered-cell', keyId: cel.keyId!, sourceSlotId: cel.bindingId ? track.slotId : undefined }),
            createPreview: () => ({ primaryText: cel.cspCellName, secondaryText: correctionLayerLabel ?? '未登録' }),
            interactiveTargetSelector: 'button,input,select,textarea,a,[contenteditable="true"]',
            onStarted: () => {
              cancelPendingKeySelect()
              suppressClickKeyRef.current = cel.keyId!
              selectPaneNode(celSelection)
            },
            onFinished: () => {
              window.setTimeout(() => {
                if (suppressClickKeyRef.current === cel.keyId) suppressClickKeyRef.current = null
              }, 0)
            },
          })
        } : undefined}
        onClick={event => {
          if (suppressClickKeyRef.current === cel.keyId) {
            suppressClickKeyRef.current = null
            cancelPendingKeySelect()
            return
          }
          const target = event.target
          if (target instanceof Element && target.closest('.cspTreeCelName')) {
            scheduleKeySelect(celSelection)
            return
          }
          cancelPendingKeySelect()
          selectPaneNode(celSelection)
        }}
      >
        {(editableBinding || editableGuide) ? (
          <InlineTreeLabel
            className="cspTreeCelName"
            inputClassName="cspTreeCelNameInput"
            label={cel.cspCellName}
            inputAriaLabel={`${track.label}のCSPセル名`}
            editTitle="ダブルクリックでCSPセル名を編集"
            onBeginEditing={cancelPendingKeySelect}
            onCommit={name => {
              if (track.slotId && cel.keyId) {
                onUpdateCspCellName(cel.keyId, track.slotId, name)
              } else if (track.stackGuideLabelId && correctionLayerId) {
                onUpdateStackGuideRegistration(track.stackGuideLabelId, correctionLayerId, name)
              }
            }}
          />
        ) : <span className="cspTreeCelName">{cel.cspCellName}</span>}
        {showSheetLabel && <span className="cspTreeSheetLabel">シート: {cel.displayLabel}</span>}
        {asset && !cel.keyId && (
          <TooltipTarget label={asset.displayName}>
            {tooltipProps => <span className="cspTreeSheetLabel" {...tooltipProps}>{asset.displayName}</span>}
          </TooltipTarget>
        )}
        <TooltipTarget label={asset ? `素材: ${asset.displayName}` : '素材未割当'}>
          {tooltipProps => (
            <span
              className="cspTreeAssetState"
              aria-label={asset ? `素材: ${asset.displayName}` : '素材未割当'}
              {...tooltipProps}
            >
              {asset ? '●' : '○'}
            </span>
          )}
        </TooltipTarget>
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

  function beginPaneAddition(kind: 'overlay-track' | 'stack-guide', correctionLayerId: string) {
    setAuxiliaryDraft(null)
    setPaneAdditionDraft({
      kind,
      correctionLayerId,
      label: kind === 'overlay-track' ? nextOverlayTrackNameForUi(project) : '',
    })
  }

  function paneAdditionIndex(tracks: CspLayerTreeTrack[]): number {
    if (!paneAdditionDraft) return -1
    const cellInterleaveIndices = tracks.flatMap((track, index) => {
      if (track.paperTrack) return [index]
      const label = track.stackGuideLabelId
        ? project.stackGuideLabels.find(item => item.labelId === track.stackGuideLabelId)
        : undefined
      return label && stackGuideStackBand(label) === 'cell-interleave' ? [index] : []
    })
    if (paneAdditionDraft.kind === 'overlay-track') {
      return cellInterleaveIndices[0] ?? tracks.length
    }
    let lastPaperTrackIndex = -1
    tracks.forEach((track, index) => {
      if (track.paperTrack) lastPaperTrackIndex = index
    })
    return lastPaperTrackIndex >= 0
      ? lastPaperTrackIndex + 1
      : cellInterleaveIndices[0] ?? tracks.length
  }

  function renderPaneAdditionDraft(layerId: string) {
    if (!paneAdditionDraft || paneAdditionDraft.correctionLayerId !== layerId) return null
    const isOverlayTrack = paneAdditionDraft.kind === 'overlay-track'
    return (
      <form
        className="cspTreeAuxiliaryForm cspTreePaneAdditionForm"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          const label = paneAdditionDraft.label.trim()
          if (!label) return
          if (isOverlayTrack) {
            onCreateDefaultOverlayPaperTrack({ paperTrack: label })
          } else {
            onCreateDefaultStackGuideLabel({ label, correctionLayerId: layerId })
          }
          setPaneAdditionDraft(null)
        }}
      >
        <input
          autoFocus
          aria-label={isOverlayTrack ? '追加セル列名' : 'BG／BOOK名'}
          placeholder={isOverlayTrack ? 'J' : 'BG1 / BOOK1'}
          value={paneAdditionDraft.label}
          onFocus={event => event.currentTarget.select()}
          onChange={event => {
            const label = event.currentTarget.value
            setPaneAdditionDraft(current => current ? { ...current, label } : current)
          }}
          onKeyDown={event => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            setPaneAdditionDraft(null)
          }}
        />
        <TooltipTarget label="追加を確定">
          {tooltipProps => <button type="submit" aria-label={isOverlayTrack ? '追加セル列を作成' : 'BG／BOOKを作成'} {...tooltipProps}>✓</button>}
        </TooltipTarget>
        <TooltipTarget label="追加をキャンセル">
          {tooltipProps => <button type="button" aria-label="追加をキャンセル" onClick={() => setPaneAdditionDraft(null)} {...tooltipProps}>×</button>}
        </TooltipTarget>
      </form>
    )
  }

  const selectedCapabilities = paneSelection ? cspPaneNodeCapabilities(project, paneSelection) : null
  const selectedLayerId = correctionLayerIdForCspPaneSelection(paneSelection, activeCorrectionLayerId)
  const selectedSlotId = paneSelection && (
    paneSelection.kind === 'template-track'
    || paneSelection.kind === 'overlay-track'
    || paneSelection.kind === 'registered-cell'
    || paneSelection.kind === 'unregistered-cell'
  ) ? paneSelection.slotId : undefined
  const deleteTooltip = paneSelection
    ? selectedCapabilities?.deletable
      ? `${paneSelection.label}を削除`
      : selectedCapabilities?.disabledReason ?? `${paneSelection.label}は削除できません`
    : '削除する項目を選択してください'

  return (
    <section ref={treeRootRef} className="cspLayerTree" aria-label="CSPレイヤー構成">
      <header className="cspLayerTreeHeader">
        <strong>CSPレイヤー構成</strong>
      </header>
      <div ref={treeBodyRef} className="cspLayerTreeBody" role="tree" aria-label="CSPレイヤー">
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
        {tree.stages.map(stage => {
          const stageSelection: CspPaneSelection = stage.stageId
            ? { kind: 'production-stage', nodeId: `stage:${stage.stageId}`, label: stage.label, stageId: stage.stageId }
            : { kind: 'generated-readonly', nodeId: stage.nodeId, label: stage.label }
          return (
          <details className="cspTreeStage" key={stage.nodeId} open>
            <summary
              className={paneRowClass(stageSelection)}
              role="treeitem"
              aria-selected={paneSelection?.nodeId === stageSelection.nodeId}
              {...paneReorderAttributes(stageSelection)}
              onPointerDown={event => beginPaneNodeDrag(event, stageSelection)}
              onClick={event => {
                event.preventDefault()
                handlePaneNodeClick(stageSelection)
              }}
            >
              <TreeDisclosureButton label={stage.label} />
              {stage.stageId && onRenameProductionStage ? (
                <SummaryRenameTrigger
                  className="cspTreeSummaryLabel"
                  label={stage.label}
                  editTitle="ダブルクリックで制作段階名を編集"
                  editing={summaryRename?.kind === 'stage' && summaryRename.id === stage.stageId}
                  onSelect={() => handlePaneNodeClick(stageSelection)}
                  onBegin={() => setSummaryRename({ kind: 'stage', id: stage.stageId!, label: stage.label })}
                />
              ) : stage.label}
            </summary>
            {stage.stageId && summaryRename?.kind === 'stage' && summaryRename.id === stage.stageId && (
              <SummaryRenameEditor
                key={`stage:${stage.stageId}:${summaryRename.label}`}
                label={summaryRename.label}
                inputAriaLabel={`${summaryRename.label}の制作段階名`}
                onCancel={() => setSummaryRename(null)}
                onCommit={label => {
                  onRenameProductionStage?.(stage.stageId!, label)
                  setSummaryRename(null)
                }}
              />
            )}
            {stage.layers.map(layer => {
              const layerSelection: CspPaneSelection = layer.layerId
                ? { kind: 'correction-layer', nodeId: `layer:${layer.layerId}`, label: layer.label, stageId: stage.stageId ?? '', layerId: layer.layerId }
                : { kind: 'generated-readonly', nodeId: layer.nodeId, label: layer.label }
              const additionIndex = layer.layerId && paneAdditionDraft?.correctionLayerId === layer.layerId
                ? paneAdditionIndex(layer.tracks)
                : -1
              return (
              <div className="cspTreeLayerShell" key={layer.nodeId}>
                <details className="cspTreeLayer" open>
                  <summary
                    className={[
                      layer.layerId && assetDropGapId === `${layer.layerId}:0` ? 'assetDragOver' : '',
                      paneRowClass(layerSelection),
                    ].filter(Boolean).join(' ')}
                    role="treeitem"
                    aria-selected={paneSelection?.nodeId === layerSelection.nodeId}
                    {...paneReorderAttributes(layerSelection)}
                    data-csp-drop-kind={layer.layerId ? 'gap' : undefined}
                    data-csp-gap-id={layer.layerId ? `${layer.layerId}:0` : undefined}
                    data-csp-correction-layer-id={layer.layerId}
                    data-csp-gap-index={layer.layerId ? 0 : undefined}
                    onPointerDown={event => beginPaneNodeDrag(event, layerSelection)}
                    onClick={event => {
                      event.preventDefault()
                      handlePaneNodeClick(layerSelection)
                    }}
                  >
                    <TreeDisclosureButton label={layer.label} />
                    {layer.layerId && onRenameCorrectionLayer ? (
                      <SummaryRenameTrigger
                        className="cspTreeSummaryLabel"
                        label={layer.label}
                        editTitle="ダブルクリックで工程名を編集"
                        editing={summaryRename?.kind === 'layer' && summaryRename.id === layer.layerId}
                        onSelect={() => handlePaneNodeClick(layerSelection)}
                        onBegin={() => setSummaryRename({ kind: 'layer', id: layer.layerId!, label: layer.label })}
                      />
                    ) : layer.label}
                  </summary>
                  {layer.layerId && summaryRename?.kind === 'layer' && summaryRename.id === layer.layerId && (
                    <SummaryRenameEditor
                      key={`layer:${layer.layerId}:${summaryRename.label}`}
                      label={summaryRename.label}
                      inputAriaLabel={`${summaryRename.label}の工程名`}
                      onCancel={() => setSummaryRename(null)}
                      onCommit={label => {
                        onRenameCorrectionLayer?.(layer.layerId!, label)
                        setSummaryRename(null)
                      }}
                    />
                  )}
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
                      <TooltipTarget label="追加を確定">
                        {tooltipProps => <button type="submit" aria-label="追加を確定" {...tooltipProps}>✓</button>}
                      </TooltipTarget>
                      <TooltipTarget label="追加をキャンセル">
                        {tooltipProps => <button type="button" aria-label="追加をキャンセル" onClick={() => setAuxiliaryDraft(null)} {...tooltipProps}>×</button>}
                      </TooltipTarget>
                    </form>
                  )}
                  {layer.tracks.length === 0 && additionIndex < 0 && <p className="cspTreeNoTracks">トラックなし</p>}
                  {layer.layerId && renderNewTrackDropZone(layer.layerId, layer.label, layer.tracks, 0)}
                  {layer.tracks.map((track, trackIndex) => {
                    const trackSelection = trackPaneSelection(track, layer.layerId)
                    const acceptsStackGuideAsset = Boolean(track.stackGuideLabelId && layer.layerId)
                    const acceptsPaperTrackAsset = Boolean(track.paperTrack && track.slotId)
                    const acceptsAsset = acceptsStackGuideAsset || acceptsPaperTrackAsset
                    const assetDropZoneLabel = acceptsStackGuideAsset
                      ? `${track.label}（${layer.label}）へ画像素材を割り当て`
                      : `${track.label}（${layer.label}）にカードを追加`
                    return (
                    <Fragment key={track.nodeId}>
                    {layer.layerId && additionIndex === trackIndex && renderPaneAdditionDraft(layer.layerId)}
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
                    >
                    <div
                      className={['cspTreeTrackRow', paneRowClass(trackSelection)].filter(Boolean).join(' ')}
                      role="treeitem"
                      aria-selected={paneSelection?.nodeId === trackSelection.nodeId}
                      {...paneReorderAttributes(trackSelection)}
                      onPointerDown={event => beginPaneNodeDrag(event, trackSelection)}
                      onClick={() => handlePaneNodeClick(trackSelection)}
                    >
                      {track.paperTrack ? (
                        <InlineTreeLabel
                          key={`${track.paperTrack}:${track.label}`}
                          label={track.label}
                          className="cspTreeTrackName"
                          inputClassName="cspTreeTrackNameInput"
                          inputAriaLabel={`${track.label}のセル列名`}
                          editTitle="ダブルクリックでセル列名を編集"
                          onCommit={label => onRenamePaperTrack(track.paperTrack!, label)}
                        />
                      ) : track.stackGuideLabelId ? (
                        <InlineTreeLabel
                          key={`${track.stackGuideLabelId}:${track.label}`}
                          label={track.label}
                          className="cspTreeTrackName"
                          inputClassName="cspTreeTrackNameInput"
                          inputAriaLabel={`${track.label}の追加トラック名`}
                          editTitle="ダブルクリックで追加トラック名を編集"
                          onCommit={label => onUpdateStackGuideLabel(track.stackGuideLabelId!, { label })}
                        />
                      ) : <span className="cspTreeTrackName">{track.label}</span>}
                    </div>
                    <div className="cspTreeCels">
                      {newCelDraft && newCelDraft.slotId === track.slotId && (
                        <form className="cspTreeNewCelForm" onSubmit={submitNewCel}>
                          <input
                            autoFocus
                            aria-label={`${track.label}（${layer.label}）に追加するCSPセル名`}
                            value={newCelDraft.cspCellName}
                            onFocus={event => event.currentTarget.select()}
                            onChange={event => {
                              const cspCellName = event.currentTarget.value
                              setNewCelDraft(current => current ? { ...current, cspCellName } : current)
                            }}
                            onKeyDown={event => {
                              if (event.key !== 'Escape') return
                              event.preventDefault()
                              setNewCelDraft(null)
                            }}
                          />
                          <TooltipTarget label="確定">
                            {tooltipProps => <button type="submit" aria-label="セルを追加" {...tooltipProps}>✓</button>}
                          </TooltipTarget>
                          <TooltipTarget label="キャンセル">
                            {tooltipProps => <button type="button" aria-label="セルの追加をキャンセル" onClick={() => setNewCelDraft(null)} {...tooltipProps}>×</button>}
                          </TooltipTarget>
                        </form>
                      )}
                      {track.cels.length === 0 && newCelDraft?.slotId !== track.slotId && <span className="cspTreeNoCels">カードなし</span>}
                      {track.cels.map(cel => renderCelCard(track, cel, layer.layerId, layer.label))}
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
                  {layer.layerId && additionIndex === layer.tracks.length && renderPaneAdditionDraft(layer.layerId)}
                </details>
              </div>
              )
            })}
          </details>
          )
        })}
      </div>
      <footer className="cspLayerTreeFooter" aria-label="CSPレイヤー操作">
        <Tooltip label="一括リネーム">
          <button type="button" className="cspTreeNormalizeButton" aria-label="名前を正規化" onClick={onOpenNameNormalization}>
            <NormalizeIcon />
          </button>
        </Tooltip>
        <ActionMenu
          label={<PlusIcon />}
          ariaLabel="CSPレイヤー項目を追加"
          tooltipLabel="項目を追加"
          className="cspPaneFooterAddMenu iconActionMenu"
          closeOnMenuItemClick
        >
          <button
            type="button"
            onClick={() => {
              const layerId = defaultCorrectionLayerId(project) ?? activeCorrectionLayerId
              if (layerId) beginPaneAddition('overlay-track', layerId)
            }}
          >
            追加セル列
          </button>
          <button type="button" disabled={!selectedLayerId} onClick={() => selectedLayerId && beginPaneAddition('stack-guide', selectedLayerId)}>BG／BOOK</button>
          <button type="button" disabled={!selectedLayerId} onClick={() => {
            if (!selectedLayerId) return
            setPaneAdditionDraft(null)
            setAuxiliaryDraft({ correctionLayerId: selectedLayerId, kind: 'camera-note', label: '' })
          }}>撮影指示</button>
          <button type="button" disabled={!selectedLayerId} onClick={() => {
            if (!selectedLayerId) return
            setPaneAdditionDraft(null)
            setAuxiliaryDraft({ correctionLayerId: selectedLayerId, kind: 'memo', label: '' })
          }}>メモ</button>
          {selectedSlotId && onCreateUnplacedCard && <button type="button" onClick={() => beginNewCel(selectedSlotId)}>登録セル</button>}
        </ActionMenu>
        <span className="cspLayerTreeFooterSpacer" />
        <Tooltip label={deleteTooltip}>
          <button
            type="button"
            className="cspPaneDeleteButton"
            aria-label={paneSelection ? `${paneSelection.label}を削除` : '選択項目を削除'}
            disabled={!paneSelection || !selectedCapabilities?.deletable}
            onClick={deleteSelectedPaneNode}
          >
            <DeleteIcon />
          </button>
        </Tooltip>
      </footer>
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

function TreeDisclosureButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="cspTreeDisclosureButton"
      aria-label={`${label}を展開または折りたたむ`}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => {
        event.preventDefault()
        event.stopPropagation()
        const details = event.currentTarget.closest<HTMLDetailsElement>('details')
        if (details) details.open = !details.open
      }}
    >
      <span className="cspTreeDisclosureGlyph" aria-hidden="true" />
    </button>
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

function SummaryRenameTrigger({
  label,
  className,
  editTitle,
  editing,
  onSelect,
  onBegin,
}: {
  label: string
  className: string
  editTitle: string
  editing: boolean
  onSelect: () => void
  onBegin: () => void
}) {
  return (
    <TooltipTarget label={editTitle} disabled={editing}>
      {tooltipProps => (
        <span
          className={[className, editing ? 'isRenameActive' : ''].filter(Boolean).join(' ')}
          role="button"
          tabIndex={0}
          {...tooltipProps}
          onClick={event => {
            event.preventDefault()
            event.stopPropagation()
            onSelect()
          }}
          onDoubleClick={event => {
            event.preventDefault()
            event.stopPropagation()
            onBegin()
          }}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== 'F2') return
            event.preventDefault()
            event.stopPropagation()
            onBegin()
          }}
        >
          {label}
        </span>
      )}
    </TooltipTarget>
  )
}

function SummaryRenameEditor({
  label,
  inputAriaLabel,
  onCommit,
  onCancel,
}: {
  label: string
  inputAriaLabel: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(label)
  const cancelledRef = useRef(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function commit() {
    if (cancelledRef.current) return
    const name = draft.trim()
    if (name && name !== label) onCommit(name)
    else onCancel()
  }

  useEffect(() => {
    function finishEditingOnOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && editorRef.current?.contains(event.target)) return
      inputRef.current?.blur()
    }

    document.addEventListener('pointerdown', finishEditingOnOutsidePointer, true)
    return () => document.removeEventListener('pointerdown', finishEditingOnOutsidePointer, true)
  }, [])

  return (
    <div ref={editorRef} className="cspTreeSummaryEditor" onClick={event => event.stopPropagation()}>
      <input
        ref={inputRef}
        autoFocus
        className="cspTreeSummaryNameInput"
        aria-label={inputAriaLabel}
        value={draft}
        onFocus={event => event.currentTarget.select()}
        onChange={event => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            cancelledRef.current = true
            onCancel()
          }
        }}
      />
    </div>
  )
}

function InlineTreeLabel({
  label,
  className,
  inputClassName,
  inputAriaLabel,
  editTitle,
  onBeginEditing,
  onCommit,
}: {
  label: string
  className: string
  inputClassName: string
  inputAriaLabel: string
  editTitle: string
  onBeginEditing?: () => void
  onCommit: (name: string) => void
}) {
  const [draft, setDraft] = useState(label)
  const [editing, setEditing] = useState(false)

  function beginEditing() {
    onBeginEditing?.()
    setDraft(label)
    setEditing(true)
  }

  function commit() {
    const name = draft.trim()
    if (name && name !== label) onCommit(name)
    setDraft(label)
    setEditing(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(label)
      setEditing(false)
    }
  }

  return editing ? (
    <input
      autoFocus
      className={inputClassName}
      aria-label={inputAriaLabel}
      value={draft}
      onFocus={event => event.currentTarget.select()}
      onChange={event => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
    />
  ) : (
    <TooltipTarget label={editTitle}>
      {tooltipProps => (
        <span
          className={className}
          role="button"
          tabIndex={0}
          {...tooltipProps}
          onDoubleClick={event => {
            event.preventDefault()
            event.stopPropagation()
            beginEditing()
          }}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== 'F2') return
            event.preventDefault()
            event.stopPropagation()
            beginEditing()
          }}
        >
          {label}
        </span>
      )}
    </TooltipTarget>
  )
}
