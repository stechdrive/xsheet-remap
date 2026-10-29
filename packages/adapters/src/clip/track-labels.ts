// CLIP format implementation is shared through celcodec; app policy stays here.
import * as native from "celcodec/write"
import { codecFunction } from "./material/celcodec"
export const ensureTrackLabelStorage = codecFunction(native.ensureTrackLabelStorage)
export const writeTrackLabels = codecFunction(native.writeTrackLabels)
