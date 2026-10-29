// Native format implementation is provided by the local celcodec package.
import * as native from 'celcodec/material'
import { codecCall, codecFunction, codecMessage } from './celcodec'
export const readTextAttributes = codecFunction(native.readTextAttributes)
export function readTextObjects(row: Parameters<typeof native.readTextObjects>[0], dpi:number, report:(message:string)=>void=()=>{}):native.ClipTextObject[] { return codecCall(()=>native.readTextObjects(row,dpi,code=>report(codecMessage(code)))) }
