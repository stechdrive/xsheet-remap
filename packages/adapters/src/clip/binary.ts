// CLIP format implementation is shared through celcodec; app policy stays here.
import * as native from 'celcodec/binary'
import { codecFunction } from './material/celcodec'
export { utf8, text, concat, view, u32, u64, crc32, adler32, externalId, layerUuid } from 'celcodec/binary'
export const uint64 = codecFunction(native.uint64)
export const named = codecFunction(native.named)
export function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error('CLIP: '+message) }
export function identity(project: string, key: string) { return native.identity('xsheet-remap:clip:1:'+project,key) }
