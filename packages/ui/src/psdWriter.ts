export type PsdLayer = {
  name: string
  imageData: ImageData
  opacity?: number
}

type PreparedLayer = {
  name: string
  top: number
  left: number
  bottom: number
  right: number
  width: number
  height: number
  opacity: number
  channels: {
    alpha: Uint8Array
    red: Uint8Array
    green: Uint8Array
    blue: Uint8Array
  }
}

export function writeRgbPsd({
  width,
  height,
  dpi,
  layers,
  composite,
}: {
  width: number
  height: number
  dpi?: number
  layers: PsdLayer[]
  composite: ImageData
}): Uint8Array {
  const normalizedWidth = Math.max(1, Math.round(width))
  const normalizedHeight = Math.max(1, Math.round(height))
  const preparedLayers = layers.map(layer => prepareLayer(layer, normalizedWidth, normalizedHeight))
  const writer = new BinaryWriter()
  writer.ascii('8BPS')
  writer.u16(1)
  writer.zero(6)
  writer.u16(3)
  writer.u32(normalizedHeight)
  writer.u32(normalizedWidth)
  writer.u16(8)
  writer.u16(3)

  writer.u32(0)
  writer.bytes(imageResources(dpi))
  writer.bytes(layerAndMaskInfo(preparedLayers))
  writer.bytes(compositeImageData(composite, normalizedWidth, normalizedHeight))
  return writer.toUint8Array()
}

export function alphaComposite(bottom: ImageData, top: ImageData): ImageData {
  const width = bottom.width
  const height = bottom.height
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('failed to create composite canvas')
  const output = context.createImageData(width, height)
  for (let index = 0; index < output.data.length; index += 4) {
    const topAlpha = top.data[index + 3] / 255
    const bottomAlpha = bottom.data[index + 3] / 255
    const outAlpha = topAlpha + bottomAlpha * (1 - topAlpha)
    for (let channel = 0; channel < 3; channel += 1) {
      const topColor = top.data[index + channel]
      const bottomColor = bottom.data[index + channel]
      output.data[index + channel] = outAlpha <= 0
        ? 255
        : Math.round((topColor * topAlpha + bottomColor * bottomAlpha * (1 - topAlpha)) / outAlpha)
    }
    output.data[index + 3] = Math.round(outAlpha * 255)
  }
  return output
}

function imageResources(dpi?: number): Uint8Array {
  const writer = new BinaryWriter()
  const resolution = Math.max(1, Math.round(dpi ?? 72))
  writer.ascii('8BIM')
  writer.u16(1005)
  writer.pascalStringEven('')
  writer.u32(16)
  writer.fixed16_16(resolution)
  writer.u16(1)
  writer.u16(1)
  writer.fixed16_16(resolution)
  writer.u16(1)
  writer.u16(1)
  const bytes = writer.toUint8Array()
  const outer = new BinaryWriter()
  outer.u32(bytes.length)
  outer.bytes(bytes)
  return outer.toUint8Array()
}

function layerAndMaskInfo(layers: PreparedLayer[]): Uint8Array {
  const layerInfo = new BinaryWriter()
  layerInfo.i16(layers.length)
  for (const layer of layers) {
    writeLayerRecord(layerInfo, layer)
  }
  for (const layer of layers) {
    writeLayerPixels(layerInfo, layer)
  }
  if (layerInfo.length % 2 !== 0) layerInfo.u8(0)

  const layerAndMask = new BinaryWriter()
  layerAndMask.u32(layerInfo.length)
  layerAndMask.bytes(layerInfo.toUint8Array())
  layerAndMask.u32(0)
  if (layerAndMask.length % 2 !== 0) layerAndMask.u8(0)

  const outer = new BinaryWriter()
  outer.u32(layerAndMask.length)
  outer.bytes(layerAndMask.toUint8Array())
  return outer.toUint8Array()
}

function writeLayerRecord(writer: BinaryWriter, layer: PreparedLayer) {
  writer.i32(layer.top)
  writer.i32(layer.left)
  writer.i32(layer.bottom)
  writer.i32(layer.right)
  writer.u16(4)
  writer.i16(-1)
  writer.u32(2 + layer.width * layer.height)
  writer.i16(0)
  writer.u32(2 + layer.width * layer.height)
  writer.i16(1)
  writer.u32(2 + layer.width * layer.height)
  writer.i16(2)
  writer.u32(2 + layer.width * layer.height)
  writer.ascii('8BIM')
  writer.ascii('norm')
  writer.u8(layer.opacity)
  writer.u8(0)
  writer.u8(0)
  writer.u8(0)

  const extra = new BinaryWriter()
  extra.u32(0)
  extra.u32(0)
  extra.pascalStringPadded(layer.name, 4)
  extra.bytes(layerUnicodeNameInfo(layer.name))
  writer.u32(extra.length)
  writer.bytes(extra.toUint8Array())
}

function layerUnicodeNameInfo(name: string): Uint8Array {
  const payload = new BinaryWriter()
  payload.unicodeString(name)
  const writer = new BinaryWriter()
  writer.ascii('8BIM')
  writer.ascii('luni')
  writer.u32(payload.length)
  writer.bytes(payload.toUint8Array())
  if (writer.length % 2 !== 0) writer.u8(0)
  return writer.toUint8Array()
}

function writeLayerPixels(writer: BinaryWriter, layer: PreparedLayer) {
  writeRawChannel(writer, layer.channels.alpha)
  writeRawChannel(writer, layer.channels.red)
  writeRawChannel(writer, layer.channels.green)
  writeRawChannel(writer, layer.channels.blue)
}

function compositeImageData(imageData: ImageData, width: number, height: number): Uint8Array {
  const channels = splitChannels(imageData, width, height)
  const writer = new BinaryWriter()
  writer.u16(0)
  writer.bytes(channels.red)
  writer.bytes(channels.green)
  writer.bytes(channels.blue)
  return writer.toUint8Array()
}

function writeRawChannel(writer: BinaryWriter, bytes: Uint8Array) {
  writer.u16(0)
  writer.bytes(bytes)
}

function prepareLayer(layer: PsdLayer, width: number, height: number): PreparedLayer {
  if (layer.imageData.width !== width || layer.imageData.height !== height) {
    throw new Error(`PSD layer size mismatch: ${layer.name}`)
  }
  return {
    name: layer.name,
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    width,
    height,
    opacity: clampByte(layer.opacity ?? 255),
    channels: splitChannels(layer.imageData, width, height),
  }
}

function splitChannels(imageData: ImageData, width: number, height: number): PreparedLayer['channels'] {
  const size = width * height
  const red = new Uint8Array(size)
  const green = new Uint8Array(size)
  const blue = new Uint8Array(size)
  const alpha = new Uint8Array(size)
  for (let pixel = 0; pixel < size; pixel += 1) {
    const offset = pixel * 4
    red[pixel] = imageData.data[offset]
    green[pixel] = imageData.data[offset + 1]
    blue[pixel] = imageData.data[offset + 2]
    alpha[pixel] = imageData.data[offset + 3]
  }
  return { alpha, red, green, blue }
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

class BinaryWriter {
  private chunks: Uint8Array[] = []
  length = 0

  u8(value: number) {
    this.push(Uint8Array.of(value & 0xff))
  }

  u16(value: number) {
    this.push(Uint8Array.of((value >> 8) & 0xff, value & 0xff))
  }

  i16(value: number) {
    this.u16(value < 0 ? 0x10000 + value : value)
  }

  u32(value: number) {
    this.push(Uint8Array.of(
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ))
  }

  i32(value: number) {
    this.u32(value < 0 ? 0x100000000 + value : value)
  }

  fixed16_16(value: number) {
    this.u32(Math.round(value * 65536))
  }

  unicodeString(value: string) {
    this.u32(value.length)
    for (let index = 0; index < value.length; index += 1) {
      this.u16(value.charCodeAt(index))
    }
  }

  ascii(value: string) {
    const bytes = new Uint8Array(value.length)
    for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0x7f
    this.push(bytes)
  }

  pascalStringEven(value: string) {
    const bytes = encodeAsciiPascal(value, 255)
    this.u8(bytes.length)
    this.bytes(bytes)
    if ((1 + bytes.length) % 2 !== 0) this.u8(0)
  }

  pascalStringPadded(value: string, multiple: number) {
    const bytes = encodeAsciiPascal(value, 255)
    this.u8(bytes.length)
    this.bytes(bytes)
    while (this.length % multiple !== 0) this.u8(0)
  }

  zero(count: number) {
    this.push(new Uint8Array(count))
  }

  bytes(value: Uint8Array) {
    this.push(value)
  }

  toUint8Array(): Uint8Array {
    const output = new Uint8Array(this.length)
    let offset = 0
    for (const chunk of this.chunks) {
      output.set(chunk, offset)
      offset += chunk.length
    }
    return output
  }

  private push(bytes: Uint8Array) {
    this.chunks.push(bytes)
    this.length += bytes.length
  }
}

function encodeAsciiPascal(value: string, maxLength: number): Uint8Array {
  const normalized = value.replace(/[^\x20-\x7e]/g, '_').slice(0, maxLength)
  const bytes = new Uint8Array(normalized.length)
  for (let index = 0; index < normalized.length; index += 1) bytes[index] = normalized.charCodeAt(index)
  return bytes
}
