// Native format implementation is provided by the local celcodec package.
import * as native from 'celcodec/material'
import { codecFunction } from './celcodec'
export const readLayerKind = codecFunction(native.readLayerKind)
export const readMediaItemKind = codecFunction(native.readMediaItemKind)
export const readPaletteColor = codecFunction(native.readPaletteColor)
export const isPaper = codecFunction(native.isPaper)
export const hasLayerMask = codecFunction(native.hasLayerMask)
