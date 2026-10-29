// CLIP format implementation is shared through celcodec; app policy stays here.
import * as native from "celcodec/write"
import { codecFunction } from "./material/celcodec"
export const ensureAnimationStorage = codecFunction(native.ensureAnimationStorage)
export const ensureAnimationFolderStorage = codecFunction(native.ensureAnimationFolderStorage)
