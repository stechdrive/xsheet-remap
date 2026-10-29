// CLIP format implementation is shared through celcodec; app policy stays here.
import * as native from "celcodec/write"
import { codecFunction } from "./material/celcodec"
export const normalizedUuid = codecFunction(native.normalizedUuid)
export const optionalRows = codecFunction(native.optionalRows)
export const clipLabelColor = codecFunction(native.clipLabelColor)
export const clipLayerKind = codecFunction(native.clipLayerKind)
