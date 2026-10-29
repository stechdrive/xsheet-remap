// Native format implementation is provided by the local celcodec package.
import * as native from 'celcodec/material'
import { codecFunction } from './celcodec'
export const readBrushDynamics = codecFunction(native.readBrushDynamics)
export const brushRandom = codecFunction(native.brushRandom)
export type { BrushDynamics } from 'celcodec/material'
