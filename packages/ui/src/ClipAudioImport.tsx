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
  const [trackId, setTrackId] = useState(state.tracks.find(track => !track.clips.length)?.trackId ?? state.activeTrackId)
  const [sound, setSound] = useState(Boolean(revisionId)), [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const current = useRef({ project, disabled }), controller = useRef<AbortController | null>(null)
  useEffect(() => { current.current = { project, disabled } }, [project, disabled])
  useEffect(() => () => controller.current?.abort(), [])
  async function importAudio() {
    if (disabled || busy || !document.source || node.sourceLayerId === undefined) return
    const abort = new AbortController(); controller.current = abort
    setBusy(true); setNotice('音声と配置を読み込んでいます…')
    let context: AudioContext | undefined
    try {
      if (typeof AudioContext !== 'function') throw new Error('この環境では音声をデコードできません。デスクトップ版またはWeb Audio対応ブラウザーで取り込んでください。')
      const source = document.source
      const data = await readClipAudioFile(clipSourceBytes(source.dataUrl), node.sourceLayerId, timelineId, abort.signal)
      abort.signal.throwIfAborted()
      context = new AudioContext()
      const prepared = await prepareClipAudio(data, `clip-audio:${source.fileHash.slice(0, 20)}:${node.sourceLayerId}:${timelineId}`, project.logicalSheet.frameOrigin, context)
      abort.signal.throwIfAborted()
      if (current.current.project !== project || current.current.disabled) throw new Error('読み込み中にシートが変更されました。もう一度取り込んでください。')
      let visible = node.visible, parentId = node.parentId
      while (parentId) { const parent = document.nodes.find(item => item.id === parentId)!; visible = visible && parent.visible; parentId = parent.parentId }
      const next = placeClipAudio(project, prepared, { trackId, muted: !visible, revisionId, sound })
      onChange(next); setNotice(`${prepared.clips.length}個の音声クリップを取り込みました。${sound ? 'SOUNDと音声をリンクしました。' : 'セリフ音声で区間を選んでSOUNDにリンクできます。'}`)
    } catch (error) { if (!abort.signal.aborted) setNotice(error instanceof Error ? error.message : String(error)) }
    finally { await context?.close(); if (!abort.signal.aborted) setBusy(false) }
  }
  return <fieldset className="clipAudioImport" disabled={disabled || busy}>
    <strong>CLIPの音声を使う</strong>
    <label>タイムライン<select aria-label="音声の読込元タイムライン" value={timelineId} onChange={event => setTimelineId(event.target.value)}>{timelines.map(item => <option key={item.id} value={item.id}>{item.name}（{item.fps}fps）</option>)}</select></label>
    <label>音声トラック<select aria-label="音声の取り込み先" value={trackId} onChange={event => setTrackId(event.target.value)}>{state.tracks.map((track, index) => <option key={track.trackId} value={track.trackId}>{index + 1}{track.clips.length ? '（使用中）' : '（空）'}</option>)}</select></label>
    <label><input type="checkbox" checked={sound} disabled={!revisionId} onChange={event => setSound(event.target.checked)} />SOUNDに区間を表示</label>
    <button type="button" disabled={!timelineId} onClick={() => void importAudio()}>セリフ音声へ取り込む</button>
    <small>元の配置・トリミングをコピーします。SOUNDの文字は素材名です。セリフ音声側の編集は元のCLIP音声へ反映されません。</small>
    {notice && <p role="status">{notice}</p>}
  </fieldset>
}
