import { useMemo, useState } from 'react'
import { processTimingDifferences, type CutProject } from '@xsheet-remap/core'

export function ClipProcessComparison({ project, onProcessChange }: { project: CutProject; onProcessChange: (id: string) => void }) {
  const differences = useMemo(() => processTimingDifferences(project), [project])
  const [column, setColumn] = useState(''), [limit, setLimit] = useState(20)
  const shown = differences.filter(item => !column || item.paperTrack === column)
  return <section className="clipProcessComparison" aria-label="工程別タイミング差分">
    <label>比較するセル列<select aria-label="差分のセル列" value={column} onChange={event => { setColumn(event.target.value); setLimit(20) }}><option value="">すべて</option>{project.logicalSheet.paperTracks.map(track => <option key={track.paperTrack}>{track.paperTrack}</option>)}</select></label>
    <p>{shown.length ? `${shown.length}区間にタイミング・セル指定の差があります。` : '対応済みのグループ間にタイミング・セル指定の差はありません。'}</p>
    <small>同じセル列の指定を比較します。画像の内容は比較しません。色の付いた区間も、編集対象は選択中のグループです。</small>
    {shown.slice(0, limit).map(item => <details key={`${item.role}:${item.paperTrack}:${item.frameStart}`}>
      <summary>{item.paperTrack}列・{item.role === 'action' ? '原画' : '動画'} {item.frameStart}〜{item.frameEnd}コマ</summary>
      {item.values.map(value => <button type="button" key={value.processId} onClick={() => onProcessChange(value.processId)} aria-pressed={project.logicalSheet.processTimings?.activeProcessId === value.processId}>
        <span>{project.correctionLayers.find(process => process.layerId === value.processId)?.label}</span><strong>{value.label}{value.state === 'unregistered' ? '（素材未登録）' : ''}</strong>
      </button>)}
    </details>)}
    {shown.length > limit && <button type="button" onClick={() => setLimit(value => value + 20)}>次の20区間を表示</button>}
  </section>
}
