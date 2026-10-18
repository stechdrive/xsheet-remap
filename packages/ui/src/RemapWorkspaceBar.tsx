import type { CutProject } from '@xsheet-remap/core'
import { ActionMenu } from './AppControls'
import { ClipProcessComparison } from './ClipProcessComparison'
import './styles/remap-workspace.css'

export type RemapWorkMode = 'sheet' | 'clip'

export function RemapWorkspaceBar({ project, mode, onModeChange, baseProcessId, onBaseProcessChange, processId, onProcessChange, protected: protectedSheet }: {
  project: CutProject; mode: RemapWorkMode; onModeChange: (mode: RemapWorkMode) => void
  baseProcessId: string; onBaseProcessChange: (id: string) => void
  processId: string; onProcessChange: (id: string) => void; protected?: boolean
}) {
  const base = project.correctionLayers.find(process => process.layerId === baseProcessId)
  const options = project.correctionLayers.map(process => <option key={process.layerId} value={process.layerId}>{process.label}</option>)
  return <div className="remapWorkspaceBar" aria-label="作業モード">
    <div className="remapWorkModes" role="group" aria-label="作業の切り替え">
      <button type="button" aria-pressed={mode === 'sheet'} onClick={() => onModeChange('sheet')}>シート編集</button>
      <button type="button" aria-pressed={mode === 'clip'} onClick={() => onModeChange('clip')}>CLIP組み立て</button>
    </div>
    <ActionMenu label={<span className="remapBaseLabel">基準：{base?.label}</span>} ariaLabel="基準シートの設定" tooltipLabel={`基準シート：${base?.label}`}>
      <label>基準にする工程<select aria-label="基準にする工程" value={baseProcessId} disabled={protectedSheet} onChange={event => onBaseProcessChange(event.target.value)}>{options}</select></label>
    </ActionMenu>
    {mode === 'clip' && <label className="remapEditingProcess">編集先<select aria-label="編集先の工程" value={processId} onChange={event => onProcessChange(event.target.value)}>{options}</select></label>}
    {mode === 'clip' && project.logicalSheet.processTimings && <ActionMenu label="比較" ariaLabel="基準シートと比較" className="remapComparisonMenu">
      <ClipProcessComparison project={project} baseProcessId={baseProcessId} processId={processId} />
    </ActionMenu>}
  </div>
}
