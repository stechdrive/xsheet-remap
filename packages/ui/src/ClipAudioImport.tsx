import { useEffect, useRef, useState } from 'react'
import type { ClipLayerNode, CutProject } from '@xsheet-remap/core'
import { clipSourceBytes, readClipAudioFile } from '@xsheet-remap/adapters'
import { dialogueAudioCutStateFromProject } from './dialogueAudioProject'
import { placeClipAudio, prepareClipAudio } from './clipAudioTransfer'

export function ClipAudioImport({ project, node, activeCutId, revisionId, disabled, onChange }: {
  project: CutProject; node: ClipLayerNode; activeCutId: string; revisionId?: string; disabled?: boolean; onChange: (project: CutProject) => void
}) {
  const document = project.clipDocument!, timelines = document.sourceTimelines ?? []
  const state = dialogueAudioCutStateFromProject(project, project.logicalSheet.frameOrigin, project.logicalSheet.durationFrames)
  const [timelineId, setTimelineId] = useState(document.timelineIds?.[activeCutId] ?? timelines[0]?.id ?? '')
  const [trackId, setTrackId] = useState('new')
  const [sound, setSound] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const current = useRef({ project, disabled }), controller = useRef<AbortController | null>(null)
  useEffect(() => { current.current = { project, disabled } }, [project, disabled])
  useEffect(() => () => controller.current?.abort(), [])
  async function importAudio(all = false) {
    if (disabled || busy || !document.source || node.sourceLayerId === undefined) return
    const abort = new AbortController(); controller.current = abort
    setBusy(true); setNotice('音声と配置を読み込んでいます…')
    let context: AudioContext | undefined
    try {
      if (typeof AudioContext !== 'function') throw new Error('この環境では音声をデコードできません。デスクトップ版またはWeb Audio対応ブラウザーで取り込んでください。')
      const source = document.source
      const assignedTimeline = document.timelineIds?.[activeCutId]
      if (assignedTimeline && assignedTimeline !== timelineId) throw new Error('このカットと異なるタイムラインです。対応するカットへ切り替えて取り込んでください。')
      context = new AudioContext()
      const nodes = all ? document.nodes.filter(item => item.kind === 'audio' && item.sourceLayerId !== undefined) : [node]
      const bytes = clipSourceBytes(source.dataUrl), notices: string[] = []
      let next = project, count = 0
      for (const item of nodes) {
        if (state.managedClipSources?.some(existing => existing.fileHash === source.fileHash && existing.layerId === item.sourceLayerId && existing.timelineId === timelineId)) { notices.push(`${item.name}: 取り込み済み`); continue }
        try {
          const data = await readClipAudioFile(bytes, item.sourceLayerId!, timelineId, abort.signal)
          abort.signal.throwIfAborted()
          const prepared = await prepareClipAudio(data, `clip-audio:${source.fileHash.slice(0, 20)}:${item.sourceLayerId}:${timelineId}`, project.logicalSheet.frameOrigin, context)
          prepared.source = { fileHash: source.fileHash, layerId: item.sourceLayerId!, timelineId }
          prepared.name = item.name
          let visible = item.visible, parentId = item.parentId
          while (parentId) { const parent = document.nodes.find(candidate => candidate.id === parentId)!; visible = visible && parent.visible; parentId = parent.parentId }
          next = placeClipAudio(next, prepared, { trackId: all ? 'new' : trackId, muted: !visible, revisionId, sound: all ? false : sound })
          count += prepared.clips.length
        } catch (error) {
          abort.signal.throwIfAborted()
          if (!all) throw error
          notices.push(`${item.name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      abort.signal.throwIfAborted()
      if (current.current.project !== project || current.current.disabled) throw new Error('読み込み中にシートが変更されました。もう一度取り込んでください。')
      if (next !== project) onChange({ ...next, clipDocument: { ...next.clipDocument!, timelineIds: { ...next.clipDocument!.timelineIds, [activeCutId]: timelineId } } })
      setNotice(`${count}個の音声クリップを取り込みました。${notices.join(' / ')}`)
    } catch (error) { if (!abort.signal.aborted) setNotice(error instanceof Error ? error.message : String(error)) }
    finally { await context?.close(); if (!abort.signal.aborted) setBusy(false) }
  }
  return <fieldset className="clipAudioImport" disabled={disabled || busy}>
    <strong>CLIPの音声を使う</strong>
    <label>タイムライン<select aria-label="音声の読込元タイムライン" value={timelineId} onChange={event => setTimelineId(event.target.value)}>{timelines.map(item => <option key={item.id} value={item.id}>{item.name}（{item.fps}fps）</option>)}</select></label>
    <label>音声トラック<select aria-label="音声の取り込み先" value={trackId} onChange={event => setTrackId(event.target.value)}><option value="new">新規トラック</option>{state.tracks.map(track => <option key={track.trackId} value={track.trackId} disabled={track.locked || Boolean(track.clipSource)}>{track.name}{track.clips.length ? '（使用中）' : '（空）'}</option>)}</select></label>
    <label><input type="checkbox" checked={sound} disabled={!revisionId} onChange={event => setSound(event.target.checked)} />SOUNDに区間を表示</label>
    <button type="button" disabled={!timelineId} onClick={() => void importAudio()}>セリフ音声へ取り込む</button>
    <button type="button" disabled={!timelineId} onClick={() => void importAudio(true)}>全音声レイヤーを新規トラックへ</button>
    <small>配置と素材を保持し、CLIP書き出し時に元の音声へ反映します。一括取り込みではSOUNDを自動作成しません。未対応の音声は元CLIP内に保持します。</small>
    {notice && <p role="status">{notice}</p>}
  </fieldset>
}
