// Native format implementation is provided by the local celcodec package.
import * as native from 'celcodec/material'
import type { ClipDiagnostic as NativeDiagnostic } from 'celcodec'
import type { ClipLayer, ClipDiagnostic, ClipCompatibility } from './types'
import type { ClipRow } from './records'
import { layerRenderingDiagnostics } from './rendering-status'
import { codecCall, codecFunction, codecMessage } from './celcodec'
export type { MaterialTables } from 'celcodec/material'
export const materialOffscreen=codecFunction(native.materialOffscreen)
export const readMaterialQuad=codecFunction(native.readMaterialQuad)
export function readMaterialEffects(row:ClipRow,report?:(message:string)=>void){return codecCall(()=>native.readMaterialEffects(row,report?code=>report(codecMessage(code)):undefined))}
const renderingCodes=new Set(['APPROXIMATE_VECTOR','APPROXIMATE_TEXT','UNSUPPORTED_3D','APPROXIMATE_WATERCOLOR','UNSUPPORTED_WATERCOLOR_STYLE','UNSUPPORTED_TONE'])
export function createMaterialDecoder(t:native.MaterialTables,width:number,height:number,dpi:number,diagnostics:ClipDiagnostic[],compatibility?:ClipCompatibility) {
 const result:NativeDiagnostic[]=[]
 const decode=native.createMaterialDecoder(t,width,height,dpi,result,compatibility,{source:'prefer-original',budget:'extent',vectorReservation:true})
 return async (layer:ClipLayer,row:ClipRow) => {
  result.length=0
  await codecCall(()=>decode(layer,row))
  for(const d of result)if(!renderingCodes.has(d.code)&&!(d.code==='MISSING_VECTOR_DATA'&&layer.vectorRendering==='unavailable'))diagnostics.push({
   scope:'raster',layerId:layer.id,part:d.part as ClipDiagnostic['part'],outcome:d.outcome,message:'「'+layer.name+'」: '+codecMessage(d.code,d.data)
  })
  diagnostics.push(...layerRenderingDiagnostics(layer,compatibility))
 }
}
