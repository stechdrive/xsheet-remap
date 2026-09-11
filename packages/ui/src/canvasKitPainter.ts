import type { Canvas, CanvasKit, Paint, Path, SkPicture } from 'canvaskit-wasm'
import type { CanvasKitFonts } from './canvasKitRuntime'
import type { CanvasKitImages } from './canvasKitImages'
import { skiaMatrix, type CanvasKitScene, type SceneNode, type SceneShape } from './canvasKitScene'
import { drawCanvasKitText } from './canvasKitParagraph'

export function makeScenePath(kit: CanvasKit, shape: SceneShape): Path | null {
  if (shape.kind === 'path') return shape.d ? kit.Path.MakeFromSVGString(shape.d) : null
  const builder = new kit.PathBuilder()
  if (shape.kind === 'rect') {
    const { x, y, width, height } = shape.rect
    const rect = kit.XYWHRect(x, y, width, height)
    if (shape.rx || shape.ry) builder.addRRect(kit.RRectXY(rect, Math.min(width / 2, shape.rx), Math.min(height / 2, shape.ry)))
    else builder.addRect(rect)
  } else if (shape.kind === 'ellipse') builder.addOval(kit.XYWHRect(shape.cx - shape.rx, shape.cy - shape.ry, shape.rx * 2, shape.ry * 2))
  else if (shape.points.length >= 4) builder.addPolygon(shape.points, shape.close)
  return builder.detachAndDelete()
}

export function recordCanvasKitScene(kit: CanvasKit, fonts: CanvasKitFonts, images: CanvasKitImages, scene: CanvasKitScene): SkPicture {
  const recorder = new kit.PictureRecorder()
  const canvas = recorder.beginRecording(kit.XYWHRect(-32, -32, scene.width + 64, scene.height + 64))
  const paint = new kit.Paint()
  paint.setAntiAlias(true)
  const rgba = (value: string, alpha: number) => {
    const color = kit.parseColorString(value)
    color[3] *= alpha
    return color
  }
  const drawShape = (node: SceneNode) => {
    if (!node.shape) return
    const path = makeScenePath(kit, node.shape)
    if (!path) return
    try {
      if (node.paint.evenOdd) path.setFillType(kit.FillType.EvenOdd)
      if (node.paint.fill !== 'none' && node.shape.kind !== 'polygon' || (node.shape.kind === 'polygon' && node.shape.close && node.paint.fill !== 'none')) {
        paint.setStyle(kit.PaintStyle.Fill); paint.setColor(rgba(node.paint.fill, node.paint.fillOpacity))
        canvas.drawPath(path, paint)
      }
      if (node.paint.stroke !== 'none' && node.paint.strokeWidth > 0) {
        paint.setStyle(kit.PaintStyle.Stroke); paint.setColor(rgba(node.paint.stroke, node.paint.strokeOpacity))
        paint.setStrokeWidth(node.paint.strokeWidth)
        paint.setStrokeCap(node.paint.cap === 'round' ? kit.StrokeCap.Round : node.paint.cap === 'square' ? kit.StrokeCap.Square : kit.StrokeCap.Butt)
        paint.setStrokeJoin(node.paint.join === 'round' ? kit.StrokeJoin.Round : node.paint.join === 'bevel' ? kit.StrokeJoin.Bevel : kit.StrokeJoin.Miter)
        paint.setStrokeMiter(node.paint.miter)
        const dash = node.paint.dash.length % 2 ? [...node.paint.dash, ...node.paint.dash] : node.paint.dash
        const effect = dash.length && dash.every(value => value >= 0) && dash.some(value => value > 0) ? kit.PathEffect.MakeDash(dash, node.paint.dashOffset) : null
        paint.setPathEffect(effect)
        try {
          if (node.paint.nonScaling) {
            // Apply the complete viewBox transform to the path, not the pen width.
            canvas.restore(); canvas.save()
            const transformed = new kit.PathBuilder().addPath(path, skiaMatrix(node.matrix))!.detachAndDelete()
            try { canvas.drawPath(transformed, paint) } finally { transformed.delete() }
          } else canvas.drawPath(path, paint)
        } finally { paint.setPathEffect(null); effect?.delete() }
      }
    } finally { path.delete() }
  }
  const drawNode = (node: SceneNode) => {
    const saveCount = canvas.getSaveCount()
    let layerPaint: Paint | null = null
    canvas.save()
    try {
    for (const clip of node.clips) {
      const path = makeScenePath(kit, clip.shape)
      if (!path) continue
      const transformed = new kit.PathBuilder().addPath(path, skiaMatrix(clip.matrix))!.detachAndDelete()
      path.delete()
      canvas.clipPath(transformed, kit.ClipOp.Intersect, true)
      transformed.delete()
    }
    const layer = node.opacity !== 1 || node.blend === 'multiply'
    if (layer) {
      layerPaint = new kit.Paint(); layerPaint.setAlphaf(node.opacity)
      if (node.blend === 'multiply') layerPaint.setBlendMode(kit.BlendMode.Multiply)
      canvas.saveLayer(layerPaint)
    }
    canvas.save(); canvas.concat(skiaMatrix(node.matrix))
    drawShape(node)
    if (node.text) drawCanvasKitText(kit, canvas, fonts, node, node.text)
    if (node.image) {
      const image = images.get(node.image)
      if (image) {
        paint.setStyle(kit.PaintStyle.Fill); paint.setColor(kit.WHITE)
        const { x, y, width, height } = node.image.rect
        canvas.drawImageRectOptions(image, kit.XYWHRect(0, 0, image.width(), image.height()), kit.XYWHRect(x, y, width, height),
          node.image.pixelated ? kit.FilterMode.Nearest : kit.FilterMode.Linear, kit.MipmapMode.None, paint)
      }
    }
    canvas.restore()
    node.children.forEach(drawNode)
    if (layer) canvas.restore()
    canvas.restore()
    } finally { layerPaint?.delete(); canvas.restoreToCount(saveCount) }
  }
  try {
    scene.nodes.forEach(drawNode)
    return recorder.finishRecordingAsPicture()
  } finally { paint.delete(); recorder.delete() }
}

export function paintCanvasKitPicture(kit: CanvasKit, canvas: Canvas, picture: SkPicture, x: number, y: number, scaleX: number, scaleY: number, ratio: number) {
  canvas.clear(kit.TRANSPARENT)
  canvas.save()
  canvas.scale(ratio, ratio); canvas.translate(x, y); canvas.scale(scaleX, scaleY)
  canvas.drawPicture(picture)
  canvas.restore()
}
