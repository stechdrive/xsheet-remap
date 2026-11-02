// Fixed legacy fixture builder/inspector. Never imported by application code.
import * as native from 'celcodec-legacy/write'
import { codecCall, codecFunction } from './codec'
export type Mixer = native.Mixer
export const Mixer: typeof native.Mixer = new Proxy(native.Mixer, {
  construct: (target,args) => codecCall(()=>Reflect.construct(target,args)),
})
export const animationMixer = codecFunction(native.animationMixer)
export const packedMixer = codecFunction(native.packedMixer)
export const trackValueMap = codecFunction(native.trackValueMap)
