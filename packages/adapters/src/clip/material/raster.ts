// Native format implementation is provided by the local celcodec package.
import * as native from 'celcodec/material'
import { codecFunction } from './celcodec'
export const readAttribute = codecFunction(native.readAttribute)
export const readRaster = codecFunction(native.readRaster)
export type { OffscreenAttribute } from 'celcodec/material'
