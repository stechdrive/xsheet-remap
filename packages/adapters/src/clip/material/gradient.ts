// Native format implementation is provided by the local celcodec package.
import * as native from 'celcodec/material'
import { codecCall, codecFunction, codecMessage } from './celcodec'
export const readGradientKind = codecFunction(native.readGradientKind)
export function readGradient(bytes:Uint8Array,width:number,height:number,offsetX:number,offsetY:number,report:(message:string)=>void) {return codecCall(()=>native.readGradient(bytes,width,height,offsetX,offsetY,code=>report(codecMessage(code))))}
