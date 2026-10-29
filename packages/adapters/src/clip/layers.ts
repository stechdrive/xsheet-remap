// CLIP format implementation is shared through celcodec; app policy stays here.
import * as native from "celcodec/write"
import { codecFunction } from "./material/celcodec"
export const mipmapChain = codecFunction(native.mipmapChain)
export const readLayerPixels = codecFunction(native.readLayerPixels)
export const writeMipmap = codecFunction(native.writeMipmap)
export const refreshCaches = codecFunction(native.refreshCaches)
export const appendChild = codecFunction(native.appendChild)
export const createLayer = codecFunction(native.createLayer)
