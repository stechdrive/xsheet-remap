import * as native from 'celcodec/binary'
import { readContainer as readNativeContainer } from 'celcodec/read'
import { codecFunction } from './celcodec'
export { Reader, crc32 } from 'celcodec/binary'
export const inflate=codecFunction(native.inflate)
export const readContainer=codecFunction(readNativeContainer)
export function check(condition:unknown,message:string):asserts condition{if(!condition)throw new Error('CLIP: '+message)}
