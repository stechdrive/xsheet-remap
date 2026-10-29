// CLIP format implementation is shared through celcodec; app policy stays here.
import * as native from 'celcodec/write'
import { codecCall, codecFunction } from './material/celcodec'
export type Mixer = native.Mixer
export const Mixer: typeof native.Mixer = new Proxy(native.Mixer, {
  construct: (target,args) => codecCall(()=>Reflect.construct(target,args)),
})
export const animationMixer = codecFunction(native.animationMixer)
export const packedMixer = codecFunction(native.packedMixer)
export const trackValueMap = codecFunction(native.trackValueMap)
