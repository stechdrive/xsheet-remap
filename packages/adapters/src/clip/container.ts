// CLIP format implementation is shared through celcodec; app policy stays here.
import * as native from 'celcodec/write'
import { codecCall, codecFunction } from './material/celcodec'
export type { Row } from 'celcodec/write'
export type ClipContainer = native.ClipContainer
export const ClipContainer: typeof native.ClipContainer = new Proxy(native.ClipContainer, {
  construct: (target,args) => codecCall(()=>Reflect.construct(target,args)),
})
export const blob = codecFunction(native.blob)
