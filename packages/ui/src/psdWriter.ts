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
  writer.u32(layer.channels.alpha.length)
  writer.i16(0)
  writer.u32(layer.channels.red.length)
  writer.i16(1)
  writer.u32(layer.channels.green.length)
  writer.i16(2)
  writer.u32(layer.channels.blue.length)
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
  writer.bytes(layer.channels.alpha)
  writer.bytes(layer.channels.red)
  writer.bytes(layer.channels.green)
  writer.bytes(layer.channels.blue)
}

function compositeImageData(imageData: ImageData, width: number, height: number): Uint8Array {
  const channels = splitChannels(imageData, width, height)
  return encodedImageData([channels.red, channels.green, channels.blue], width, height)
}

function rawImageData(channels: Uint8Array[]): Uint8Array {
  const writer = new BinaryWriter()
  writer.u16(0)
  for (const channel of channels) writer.bytes(channel)
  return writer.toUint8Array()
}

function encodedImageData(channels: Uint8Array[], width: number, height: number): Uint8Array {
  // PSD PackBits stores a separate byte count and packet stream for each row,
  // in channel order. The merged preview shares one compression code/table.
  const rawLength = width * height * channels.length
  const rowLengths = new Uint8Array(height * channels.length * 2)
  if (rowLengths.length >= rawLength) return rawImageData(channels)
  const lengthsView = new DataView(rowLengths.buffer)
  const packed = new BinaryWriter()
  const rowBuffer = new Uint8Array(width + Math.ceil(width / 128))
  let rowIndex = 0
  for (const channel of channels) {
    for (let y = 0; y < height; y++) {
      const length = packBitsRow(channel, y * width, width, rowBuffer)
      // PSD (unlike PSB) has 16-bit scanline lengths. Also keep noisy scans
      // from growing when the packet and scanline-table overhead exceeds raw.
      if (length > 0xffff || rowLengths.length + packed.length + length >= rawLength) {
        return rawImageData(channels)
      }
      lengthsView.setUint16(rowIndex++ * 2, length)
      packed.bytes(rowBuffer.slice(0, length))
    }
  }
  const writer = new BinaryWriter()
  writer.u16(1)
  writer.bytes(rowLengths)
  writer.bytes(packed.toUint8Array())
  return writer.toUint8Array()
}

function packBitsRow(bytes: Uint8Array, start: number, width: number, output: Uint8Array): number {
  const end = start + width
  let inputOffset = start
  let outputOffset = 0
  while (inputOffset < end) {
    let runLength = 1
    while (runLength < 128 && inputOffset + runLength < end && bytes[inputOffset + runLength] === bytes[inputOffset]) runLength++
    if (runLength >= 3) {
      output[outputOffset++] = 257 - runLength
      output[outputOffset++] = bytes[inputOffset]
      inputOffset += runLength
      continue
    }
    const literalStart = inputOffset
    inputOffset += runLength
    while (inputOffset < end && inputOffset - literalStart < 128) {
      runLength = 1
      while (runLength < 128 && inputOffset + runLength < end && bytes[inputOffset + runLength] === bytes[inputOffset]) runLength++
      if (runLength >= 3) break
      inputOffset += Math.min(runLength, 128 - (inputOffset - literalStart))
    }
    const literalLength = inputOffset - literalStart
    output[outputOffset++] = literalLength - 1
    output.set(bytes.subarray(literalStart, inputOffset), outputOffset)
    outputOffset += literalLength
  }
  return outputOffset
}

function prepareLayer(layer: PsdLayer, width: number, height: number): PreparedLayer {
  if (layer.imageData.width !== width || layer.imageData.height !== height) {
    throw new Error(`PSD layer size mismatch: ${layer.name}`)
  }
  const channels = splitChannels(layer.imageData, width, height)
  return {
    name: layer.name,
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    width,
    height,
    opacity: clampByte(layer.opacity ?? 255),
    channels: {
      alpha: encodedImageData([channels.alpha], width, height),
      red: encodedImageData([channels.red], width, height),
      green: encodedImageData([channels.green], width, height),
      blue: encodedImageData([channels.blue], width, height),
    },
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
