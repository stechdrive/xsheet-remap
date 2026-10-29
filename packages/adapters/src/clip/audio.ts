// CLIP format implementation is shared through celcodec; app policy stays here.
import * as native from "celcodec/read"
import { codecFunction } from "./material/celcodec"
export const readAudioTiming = codecFunction(native.readAudioTiming)
export const readClipAudio = codecFunction(native.readClipAudio)
export type { ClipAudioReadResult, ClipAudioTiming } from "celcodec/read"
