// Native format implementation is provided by the local celcodec package.
import * as native from 'celcodec/material'
import { codecFunction } from './celcodec'
export const cropPixels = codecFunction(native.cropPixels)
