// Native format implementation is provided by the local celcodec package.
import * as native from 'celcodec/material'
import { codecCall, codecMessage } from './celcodec'
export type { BrushTexture } from 'celcodec/material'
export function createBrushTexture(style:Parameters<typeof native.createBrushTexture>[0], image:Parameters<typeof native.createBrushTexture>[1], report:(message:string)=>void,pixelAligned=false){return codecCall(()=>native.createBrushTexture(style,image,code=>report(codecMessage(code)),pixelAligned))}
