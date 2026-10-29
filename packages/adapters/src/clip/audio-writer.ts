// CLIP format implementation is shared through celcodec; app policy stays here.
import type { ClipAudioTimeline } from '@xsheet-remap/core'
import * as native from 'celcodec/write'
import { codecCall, codecFunction } from './material/celcodec'
import { nativeAudio, namespace } from './celcodec-plan'
export const audioMixer=codecFunction(native.audioMixer)
export function writeAudioTimeline(clip:native.ClipContainer,seed:native.ClipContainer,timeline:native.Row,audio:ClipAudioTimeline,projectId:string) {
 return codecCall(()=>native.writeAudioTimeline(clip,seed,timeline,nativeAudio(audio),namespace(projectId)))
}
