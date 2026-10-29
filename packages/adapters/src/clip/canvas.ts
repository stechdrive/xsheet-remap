// CLIP format implementation is shared through celcodec; app policy stays here.
import * as native from "celcodec/write"
import { codecFunction } from "./material/celcodec"
export const inspectCanvas = codecFunction(native.inspectCanvas)
export const resizeCanvas = codecFunction(native.resizeCanvas)
