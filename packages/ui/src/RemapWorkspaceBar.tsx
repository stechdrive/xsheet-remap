import type { CutProject } from '@xsheet-remap/core'
import './styles/remap-workspace.css'

export type RemapWorkMode = 'sheet' | 'clip'

export function RemapWorkspaceBar({ project, mode, onModeChange, timingProcessId, onTimingProcessChange, imageProcessId, onImageProcessChange }: {
  project: CutProject; mode: RemapWorkMode; onModeChange: (mode: RemapWorkMode) => void
  timingProcessId: string; onTimingProcessChange: (id: string) => void
  imageProcessId: string; onImageProcessChange: (id: string) => void
}) {
  const options = project.correctionLayers.map(process => <option key={process.layerId} value={process.layerId}>{process.label}</option>)
  return <div className="remapWorkspaceBar" aria-label="作業モード">
    <div className="remapWorkModes" role="group" aria-label="作業の切り替え">
      <button type="button" aria-pressed={mode === 'sheet'} onClick={() => onModeChange('sheet')}>シート編集</button>
      <button type="button" aria-pressed={mode === 'clip'} onClick={() => onModeChange('clip')}>CLIP組み立て</button>
    </div>
    {project.logicalSheet.processTimings ? <label className="remapTimingContext">編集しているタイミング
      <select aria-label="編集しているタイミング" value={timingProcessId} onChange={event => onTimingProcessChange(event.target.value)}>{options}</select>
      <small>CLIPの各工程は独立</small>
    </label> : <span className="remapTimingContext">共通シート<small>番号・タイミングは全工程共通</small></span>}
    {mode === 'clip' ? <label className="remapImageDestination">新規画像の登録先
      <select aria-label="新規画像の登録先" value={imageProcessId} onChange={event => onImageProcessChange(event.target.value)}>{options}</select>
      <small>ツリーの素材は所属工程へ登録</small>
    </label> : <small>番号・タイミング・メモ・音声を編集</small>}
  </div>
}
