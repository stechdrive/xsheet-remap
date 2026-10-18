import { useState } from 'react'
import { clipNodePath, clipSheetKeyAtFrame, selectTimingProcess, type CutProject, type SheetHit } from '@xsheet-remap/core'
import { useModalDialogKeyboardBoundary } from './useModalDialogKeyboardBoundary'

export interface PendingClipImageDrop {
  source: CutProject
  prepared: CutProject
  images: { name: string; assetId: string; imageDataUrl: string }[]
  hit: SheetHit
  processId: string
}

export function ClipImageDropDialog({ pending, onClose, onApply }: { pending: PendingClipImageDrop; onClose: () => void; onApply: (processId: string, newKey: boolean) => void }) {
  const [processId, setProcessId] = useState(pending.processId)
  const ref = useModalDialogKeyboardBoundary<HTMLDivElement>(onClose)
  const { source, hit } = pending
  const project = selectTimingProcess(source, processId)
  const role = hit.role === 'cell' ? 'cell' : 'action'
  const key = clipSheetKeyAtFrame(project, hit.paperTrack!, hit.frame, role)
  const slot = source.cspTrackSlots.find(slot => slot.paperTrack === hit.paperTrack && slot.correctionLayerId === processId)
  const target = source.clipDocument!.targets.find(target => target.slotId === slot?.slotId)
  const old = key && source.bindings.find(binding => binding.keyId === key.keyId && binding.slotId === slot?.slotId && (binding.clipLayerId || binding.assetId))
  return <div ref={ref} className="assetQuickPreviewBackdrop exportSettingsBackdrop" role="dialog" aria-modal="true" aria-label="画像の登録先を選択">
    <section className="timingExportDialog clipImageDropDialog">
      <header><strong>画像の登録先を選択</strong><button type="button" aria-label="閉じる" onClick={onClose}>×</button></header>
      <div className="timingExportDialogBody">
        <p>{pending.images[0]?.name} → {hit.paperTrack}列 / {hit.frame}コマ</p>
        <label>登録する工程<select aria-label="画像を登録する工程" value={processId} onChange={event => setProcessId(event.target.value)}>{source.correctionLayers.map(process => {
          const view = selectTimingProcess(source, process.layerId)
          const cell = clipSheetKeyAtFrame(view, hit.paperTrack!, hit.frame, role)
          const destination = source.cspTrackSlots.find(slot => slot.paperTrack === hit.paperTrack && slot.correctionLayerId === process.layerId)
          const mapped = source.clipDocument!.targets.some(target => target.slotId === destination?.slotId)
          const assigned = cell && source.bindings.find(binding => binding.keyId === cell.keyId && binding.slotId === destination?.slotId && (binding.clipLayerId || binding.assetId))
          return <option key={process.layerId} value={process.layerId} disabled={!mapped}>{process.label}：{!mapped ? '対応先なし' : !cell ? '番号なし' : `${cell.displayLabel} / ${assigned ? '登録済み' : '未登録'}`}</option>
        })}</select></label>
        <p className="clipTargetPath">登録先：{target ? clipNodePath(source.clipDocument!, target.folderId) : '未設定'}</p>
        <p>{key ? `シート番号 ${key.displayLabel} の素材：${old?.cspCellName ?? '未登録'}。この番号を使う全コマ・カットに反映します。` : 'このコマに新しいシート番号を作成します。'}</p>
        {old && <p>差し替え前の素材はレイヤーツリーに残ります。</p>}
      </div>
      <footer>
        <button type="button" onClick={onClose}>キャンセル</button>
        {key && <button type="button" disabled={!target} onClick={() => onApply(processId, true)}>新しい番号として配置</button>}
        <button type="button" className="primary" disabled={!target} onClick={() => onApply(processId, !key)}>{old ? 'この番号の素材を差し替える' : key ? 'この番号へ登録' : '新しい番号として配置'}</button>
      </footer>
    </section>
  </div>
}
