// CLIP format implementation is shared through celcodec; app policy stays here.
import type { SqlJsStatic } from 'sql.js'
import type { ClipCanvasSettings, ClipImageFit, ClipRegistrationPlan } from '@xsheet-remap/core'
import * as native from 'celcodec/write'
import { codecCall, codecFunction } from './material/celcodec'
import { nativeOptions, progressMessage } from './celcodec-plan'
export interface ClipWriteOptions {
  plan:ClipRegistrationPlan; canvas:ClipCanvasSettings; fit:ClipImageFit
  images:Record<string,native.Pixels>; template?:Uint8Array
}
export type ClipWriteResult = native.ClipWriteResult
export function writeClip(SQL:SqlJsStatic,seed:Uint8Array,options:ClipWriteOptions,progress:(message:string)=>void=()=>{}):Promise<ClipWriteResult> {
  return codecCall(()=>native.writeClip(SQL,seed,nativeOptions(options),progressMessage(progress)))
}
export const inspectClip=codecFunction(native.inspectClip)
