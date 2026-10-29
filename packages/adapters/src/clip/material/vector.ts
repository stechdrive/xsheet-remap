// Native format implementation is provided by the local celcodec package.
import * as native from 'celcodec/material'
import { codecCall, codecFunction, codecMessage } from './celcodec'
import type { VectorStroke, VectorBrushes } from 'celcodec/material'
export type { VectorStroke, VectorBrushes, VectorPoint, BrushPattern } from 'celcodec/material'
export const readVectorStrokes=codecFunction(native.readVectorStrokes)
export const sampleVectorStroke=codecFunction(native.sampleVectorStroke)
export function renderVectors(strokes:VectorStroke[],brushes:VectorBrushes,width:number,height:number,offsetX=0,offsetY=0,report:(message:string)=>void=()=>{}) { return codecCall(()=>native.renderVectors(strokes,brushes,width,height,offsetX,offsetY,code=>report(codecMessage(code)))) }
