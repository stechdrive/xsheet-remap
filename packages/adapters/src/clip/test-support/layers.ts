// Fixed legacy fixture builder/inspector. Never imported by application code.
import * as native from "celcodec-legacy/write"
import { codecFunction } from "./codec"
export const mipmapChain: typeof native.mipmapChain = codecFunction(native.mipmapChain)
export const readLayerPixels = codecFunction(native.readLayerPixels)
export const writeMipmap = codecFunction(native.writeMipmap)
export const refreshCaches = codecFunction(native.refreshCaches)
export const appendChild: typeof native.appendChild = codecFunction(native.appendChild)
export const createLayer = codecFunction(native.createLayer)
