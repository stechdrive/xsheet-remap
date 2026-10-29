import { normalizeClipName, validateClipDocument, type ClipAudioTimeline } from '@xsheet-remap/core'
import type { ClipWriteOptions as NativeOptions, ClipAudioTimeline as NativeAudio, WriteProgress } from 'celcodec/write'
import { clipSourceBytes } from './document-data'
import type { ClipWriteOptions } from './writer'
export const namespace = (projectId: string) => 'xsheet-remap:clip:1:'+projectId
export function nativeAudio(audio: ClipAudioTimeline): NativeAudio {
  return { ...audio, assets: audio.assets.map(({ dataUrl, ...asset })=>({ ...asset, bytes: clipSourceBytes(dataUrl) })) }
}
export function nativeOptions(options: ClipWriteOptions): NativeOptions {
  const { plan, ...settings } = options
  const state=plan.document && validateClipDocument(plan.document)
  return { ...settings, pathIdentity: normalizeClipName, plan: {
    namespace: namespace(plan.projectId), rootName:'xsheet-remap', folders:plan.folders,
    timelines:plan.timelines.map(t=>({ ...t,audio:t.audio && nativeAudio(t.audio) })),
    document:state ? { nodes:state.nodes, canvas:state.canvas, source:state.source && clipSourceBytes(state.source.dataUrl) } : undefined,
  } }
}
export function progressMessage(progress:(message:string)=>void) {
  return (event:WriteProgress)=>progress(event.phase==='canvas'?'キャンバスを準備しています':event.phase==='layer'?'レイヤーを作成しています: '+event.name:'タイムラインを作成しています: '+event.name)
}
