import type { ClipAudioTimeline } from '@xsheet-remap/core'
import type { ClipAudioTimeline as NativeAudio } from 'celcodec/write'
import { identity } from 'celcodec/binary'
import { clipSourceBytes } from './document-data'
export const namespace = (projectId: string) => 'xsheet-remap:clip:1:' + projectId
export async function nativeId(projectId: string, key: string): Promise<string> {
  return Array.from(await identity(namespace(projectId), key), byte => byte.toString(16).padStart(2, '0')).join('')
}
export function nativeAudio(audio: ClipAudioTimeline): NativeAudio {
  return { ...audio, assets: audio.assets.map(({ dataUrl, ...asset }) => ({ ...asset, bytes: clipSourceBytes(dataUrl) })) }
}
