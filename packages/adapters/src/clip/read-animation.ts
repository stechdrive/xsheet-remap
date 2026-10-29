// CLIP format implementation is shared through celcodec; app policy stays here.
import * as native from "celcodec/read"
import { codecFunction } from "./material/celcodec"
export const readAnimation = codecFunction(native.readAnimation)
