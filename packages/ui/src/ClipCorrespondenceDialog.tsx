import { useMemo, useState } from 'react'
import { activeCutProjectFromDocument, clipNodePath, remapClipTracks, type ClipTrackCorrespondence, type CutGroupProjectDocument } from '@xsheet-remap/core'
import { useModalDialogKeyboardBoundary } from './useModalDialogKeyboardBoundary'
import { TooltipTarget } from './Tooltip'

export function ClipCorrespondenceDialog({ document, onClose, onApply }: { document: CutGroupProjectDocument; onClose: () => void; onApply: (assignments: ClipTrackCorrespondence[]) => void }) {
  const project = useMemo(() => activeCutProjectFromDocument(document), [document])
  const [assignments, setAssignments] = useState<ClipTrackCorrespondence[]>(() => document.clipDocument!.targets.map(({ folderId, slotId }) => ({ folderId, slotId })))
  const [error, setError] = useState('')
  const ref = useModalDialogKeyboardBoundary<HTMLDivElement>(onClose)
  const preview = useMemo(() => {
    try { return { document: remapClipTracks(document, assignments), error: '' } }
    catch (error) { return { document: null, error: error instanceof Error ? error.message : String(error) } }
  }, [document, assignments])
  function update(folderId: string, processId: string, paperTrack: string) {
    const slot = project.cspTrackSlots.find(slot => slot.correctionLayerId === processId && slot.paperTrack === paperTrack)
    if (slot) setAssignments(current => current.map(row => row.folderId === folderId ? { ...row, slotId: slot.slotId } : row))
    setError('')
  }
  return <div ref={ref} className="assetQuickPreviewBackdrop exportSettingsBackdrop" role="dialog" aria-modal="true" aria-label="CLIPとシートの対応">
    <section className="timingExportDialog clipCorrespondenceDialog">
      <header><strong>CLIPとシートの対応</strong><button type="button" aria-label="閉じる" onClick={onClose}>×</button></header>
      <div className="timingExportDialogBody">
        <p>CLIPの各フォルダーを表示するセル列・グループを選びます。同じ列でもタイミングは独立しています。名前が違うフォルダーも対応づけられます。</p>
        <p>フォルダー名・階層・素材・タイミングを保持し、全カット・シート履歴の対応をまとめて変更します。Undoで戻せます。</p>
        <table><thead><tr><th>CLIPのフォルダー</th><th>表示グループ</th><th>セル列</th></tr></thead><tbody>{assignments.map(row => {
          const slot = project.cspTrackSlots.find(slot => slot.slotId === row.slotId)!
          const path = clipNodePath(document.clipDocument!, row.folderId)
          return <tr key={row.folderId}><TooltipTarget label={path}>{tooltip => <td {...tooltip}>{path}</td>}</TooltipTarget><td><select aria-label={`${path}の表示グループ`} value={slot.correctionLayerId} onChange={event => update(row.folderId, event.target.value, slot.paperTrack)}>{project.correctionLayers.map(process => <option key={process.layerId} value={process.layerId}>{process.label}</option>)}</select></td><td><select aria-label={`${path}のセル列`} value={slot.paperTrack} onChange={event => update(row.folderId, slot.correctionLayerId!, event.target.value)}>{project.logicalSheet.paperTracks.map(track => <option key={track.paperTrack} value={track.paperTrack}>{track.label}</option>)}</select></td></tr>
        })}</tbody></table>
        {(error || preview.error) && <p className="issue error" role="alert">{error || preview.error}</p>}
      </div>
      <footer><button type="button" onClick={onClose}>キャンセル</button><button type="button" className="primary" disabled={!preview.document || preview.document === document} onClick={() => { try { onApply(assignments); onClose() } catch (error) { setError(error instanceof Error ? error.message : String(error)) } }}>対応を変更</button></footer>
    </section>
  </div>
}
