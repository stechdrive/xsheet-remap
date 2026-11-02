// Fixed legacy fixture builder/inspector. Never imported by application code.
import * as native from 'celcodec-legacy/write'
import { codecCall, codecFunction } from './codec'
export type { Row } from 'celcodec-legacy/write'
export type ClipContainer = native.ClipContainer
export const ClipContainer: typeof native.ClipContainer = new Proxy(native.ClipContainer, {
  construct: (target,args) => codecCall(()=>Reflect.construct(target,args)),
})
export const blob: typeof native.blob = codecFunction(native.blob)
