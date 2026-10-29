// Native format implementation is provided by the local celcodec package.
import { createCanvasRenderer, type CanvasContext } from 'celcodec/canvas'
import { createRenderCanvas, releaseCanvas } from './render-resources'
import type { ClipLayer, ClipPixels } from './types'
import type { MaterialQuad, TextObject } from './rendering'
function withRenderer<T>(render:(r:ReturnType<typeof createCanvasRenderer<OffscreenCanvas>>)=>T):T {
 const renderer=createCanvasRenderer(createRenderCanvas,{release:releaseCanvas})
 try{return render(renderer)}finally{renderer.dispose()}
}
export function pixelCanvas(pixels:ClipPixels):OffscreenCanvas{return withRenderer(r=>r.detach(r.pixelCanvas(pixels)))}
export function placeMaterial(pixels:ClipPixels,quad:MaterialQuad){return withRenderer(r=>{const result=r.placeMaterial(pixels,quad);r.detach(result.canvas);return result})}
export function drawTextObject(ctx:OffscreenCanvasRenderingContext2D,text:TextObject):void{withRenderer(r=>r.drawTextObject(ctx as unknown as CanvasContext,text))}
export function renderClipMaterial(layer:ClipLayer,width:number,height:number){return withRenderer(r=>{const result=r.renderClipMaterial(layer,width,height);if(result)r.detach(result.canvas);return result})}
