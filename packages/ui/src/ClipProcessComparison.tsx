import { useMemo, useState } from 'react'
import { processTimingDifferences, type CutProject } from '@xsheet-remap/core'

export function ClipProcessComparison({ project, baseProcessId, processId }: { project: CutProject; baseProcessId: string; processId: string }) {
  const [chosen, setChosen] = useState(processId), [column, setColumn] = useState(''), [limit, setLimit] = useState(100)
  const others = project.correctionLayers.filter(process => process.layerId !== baseProcessId)
  const base = project.correctionLayers.find(process => process.layerId === baseProcessId)
  const { other, differences } = useMemo(() => {
    const candidates = project.correctionLayers.filter(process => process.layerId !== baseProcessId)
    const other = candidates.find(process => process.layerId === chosen) ?? candidates[0]
    return { other, differences: processTimingDifferences({ ...project, correctionLayers: project.correctionLayers.filter(process => process.layerId === baseProcessId || process.layerId === other?.layerId) }, { includeUnmapped: true }) }
  }, [project, baseProcessId, chosen])
  const shown = differences.filter(item => !column || item.paperTrack === column)
  return <section className="clipProcessComparison" aria-label="工程別タイミング差分">
    <div className="clipComparisonControls"><label>比較先<select aria-label="比較する工程" value={other?.layerId ?? ''} onChange={event => { setChosen(event.target.value); setLimit(100) }}>{others.map(process => <option key={process.layerId} value={process.layerId}>{process.label}</option>)}</select></label>
      <label>セル列<select aria-label="差分のセル列" value={column} onChange={event => { setColumn(event.target.value); setLimit(100) }}><option value="">すべて</option>{project.logicalSheet.paperTracks.map(track => <option key={track.paperTrack}>{track.paperTrack}</option>)}</select></label></div>
    <table><thead><tr><th>列／欄</th><th>コマ</th><th>基準：{base?.label}</th><th>{other?.label}</th></tr></thead><tbody>
      {shown.slice(0, limit).map(item => <tr key={`${item.role}:${item.paperTrack}:${item.frameStart}`}><th>{item.paperTrack}／{item.role === 'action' ? '原画' : '動画'}</th><td>{item.frameStart}–{item.frameEnd}</td>
        {[baseProcessId, other?.layerId].map(id => <td key={id}>{item.values.find(value => value.processId === id)?.label ?? '未対応'}</td>)}
      </tr>)}
      {!shown.length && <tr><td colSpan={4}>タイミング・セル指定の差はありません</td></tr>}
    </tbody></table>
    {shown.length > limit && <button type="button" onClick={() => setLimit(value => value + 100)}>続きを表示</button>}
  </section>
}
