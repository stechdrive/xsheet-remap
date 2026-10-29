// CLIP format implementation is shared through celcodec; app policy stays here.
import type { SqlJsStatic } from 'sql.js'
import { writeClipDocument as writeNative } from 'celcodec/write'
import { codecCall } from './material/celcodec'
import { nativeOptions, progressMessage } from './celcodec-plan'
import type { ClipWriteOptions, ClipWriteResult } from './writer'
export function writeClipDocument(SQL:SqlJsStatic,seed:Uint8Array,options:ClipWriteOptions,progress:(message:string)=>void):Promise<ClipWriteResult> {
  return codecCall(()=>writeNative(SQL,seed,nativeOptions(options),progressMessage(progress)))
}
