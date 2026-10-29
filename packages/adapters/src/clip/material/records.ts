// Native format implementation is provided by the local celcodec package.
export { num, str } from 'celcodec/binary'
export type { ClipValue, ClipRow } from 'celcodec/binary'
export const errorMessage = (e: unknown): string => e instanceof Error ? e.message : String(e)
