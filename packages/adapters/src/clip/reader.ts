// CLIP format implementation is shared through celcodec; app policy stays here.
import type { SqlJsStatic } from 'sql.js'
import type { ClipImportData } from '@xsheet-remap/core'
import { readEditableDocument } from 'celcodec/read'
import { diagnosticKinds, type DiagnosticCode } from 'celcodec'
import { codecCall, codecMessage } from './material/celcodec'
export async function readClip(SQL:SqlJsStatic,bytes:Uint8Array,fileName:string):Promise<ClipImportData> {
 const result=await codecCall(()=>readEditableDocument(SQL,bytes,fileName))
 for(const timeline of result.timelines)for(const track of timeline.tracks)if(track.error) {
  const code=track.error.replace(/^CLIP: /,'') as DiagnosticCode
  if(Object.hasOwn(diagnosticKinds,code))track.error='CLIP: '+codecMessage(code)
 }
 return result
}
