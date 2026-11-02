// Fixed legacy fixture builder/inspector. Never imported by application code.
import * as native from "celcodec-legacy/write"
import { codecFunction } from "./codec"
export const ensureTrackLabelStorage = codecFunction(native.ensureTrackLabelStorage)
export const writeTrackLabels = codecFunction(native.writeTrackLabels)
