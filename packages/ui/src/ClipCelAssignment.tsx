import { useState } from 'react'
import { assignClipCelToKey, clipCelRoot, clipSheetKeyAtFrame, selectTimingProcess, sheetTimingRoleForKey, type CutProject, type SheetHit } from '@xsheet-remap/core'

export function ClipCelAssignment({ project, layerId, hit, onChange, disabled }: { project: CutProject; layerId?: string; hit: SheetHit | null; onChange: (project: CutProject) => void; disabled?: boolean }) {
  const [chosen, setChosen] = useState(''), [error, setError] = useState('')
  const cel = layerId && clipCelRoot(project.clipDocument!, layerId)
  const target = cel && project.clipDocument!.targets.find(target => target.folderId === cel.parentId)
  const slot = project.cspTrackSlots.find(slot => slot.slotId === (target && target.slotId))
  if (!cel || !slot?.correctionLayerId) return null
  const processId = slot.correctionLayerId
  const keys = project.logicalSheet.keys.filter(key => key.paperTrack === slot.paperTrack && (!project.logicalSheet.processTimings || key.processId === processId))
  const atHit = hit?.paperTrack === slot.paperTrack && (hit.role === 'action' || hit.role === 'cell') ? clipSheetKeyAtFrame(selectTimingProcess(project, processId), slot.paperTrack, hit.frame, hit.role) : undefined
  const key = keys.find(key => key.keyId === chosen) ?? atHit
  const old = key && project.bindings.find(binding => binding.slotId === slot.slotId && binding.keyId === key.keyId)
  return <fieldset className="clipCelAssignment" disabled={disabled}>
    <small>素材の所属：{project.correctionLayers.find(process => process.layerId === processId)?.label} / {slot.paperTrack}</small>
    <label>シート番号<select aria-label="素材を対応づけるシート番号" value={key?.keyId ?? ''} onChange={event => { setChosen(event.target.value); setError('') }}><option value="">番号を選択</option>{keys.map(key => <option key={key.keyId} value={key.keyId}>{sheetTimingRoleForKey(key) === 'cell' ? '動画' : '原画'} {slot.paperTrack}：{key.displayLabel}</option>)}</select></label>
    {key && <small>素材：{old?.cspCellName ?? '未登録'} → {cel.name}。この番号を使う全カットに反映します。タイミングは変わりません。</small>}
    <button type="button" disabled={!key || old?.clipLayerId === cel.id} onClick={() => {
      try { onChange(assignClipCelToKey(project, cel.id, key!.keyId, processId)); setError('') } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    }}>{old?.clipLayerId || old?.assetId ? '素材を差し替える' : 'この番号へ素材を登録'}</button>
    {error && <p role="alert">{error}</p>}
  </fieldset>
}
