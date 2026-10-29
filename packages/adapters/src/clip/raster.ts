// CLIP format implementation is shared through celcodec; app policy stays here.
import * as native from "celcodec/write"
import { codecFunction } from "./material/celcodec"
export const attributeSize = codecFunction(native.attributeSize)
export const decodeRaster = codecFunction(native.decodeRaster)
export const encodeRaster = codecFunction(native.encodeRaster)
export const placePixels = codecFunction(native.placePixels)
export const reducePixels = codecFunction(native.reducePixels)
export const png = codecFunction(native.png)
export type { Pixels } from "celcodec/write"
