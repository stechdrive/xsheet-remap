// Native format implementation is provided by the local celcodec package.
import * as native from 'celcodec/material'
import { codecFunction } from './celcodec'
export const readAdjustment = codecFunction(native.readAdjustment)
