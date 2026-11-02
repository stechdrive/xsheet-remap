// Fixed legacy fixture builder/inspector. Never imported by application code.
import * as native from "celcodec-legacy/write"
import { codecFunction } from "./codec"
export const normalizedUuid: typeof native.normalizedUuid = codecFunction(native.normalizedUuid)
export const optionalRows = codecFunction(native.optionalRows)
export const clipLabelColor = codecFunction(native.clipLabelColor)
export const clipLayerKind = codecFunction(native.clipLayerKind)
