export type TemplateImageMetadata = {
  width: number
  height: number
  ppiX?: number
  ppiY?: number
}

export async function readTemplateImageMetadata(file: File, dataUrl: string): Promise<TemplateImageMetadata | null> {
  let binary: TemplateImageMetadata | null = null
  try {
    binary = parseTemplateImageMetadata(await file.arrayBuffer())
  } catch {
    // Decoding the image below is the compatibility fallback for unsupported formats.
  }
  const decoded = await readImageDimensionsFromDataUrl(dataUrl)
  if (!binary && !decoded) return null
  return {
    width: binary?.width ?? decoded!.width,
    height: binary?.height ?? decoded!.height,
    ...(binary?.ppiX ? { ppiX: binary.ppiX } : {}),
    ...(binary?.ppiY ? { ppiY: binary.ppiY } : {}),
  }
}

export function parseTemplateImageMetadata(buffer: ArrayBuffer): TemplateImageMetadata | null {
  const bytes = new Uint8Array(buffer)
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return parsePngMetadata(bytes)
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return parseJpegMetadata(bytes)
  return null
}

export function readImageDimensionsFromDataUrl(dataUrl: string): Promise<{ width: number; height: number } | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null)
  return new Promise(resolve => {
    const image = new Image()
    let settled = false
    const timeout = globalThis.setTimeout(() => finish(null), 1500)
    function finish(size: { width: number; height: number } | null) {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timeout)
      image.onload = null
      image.onerror = null
      resolve(size && size.width > 0 && size.height > 0 ? size : null)
    }
    image.onload = () => finish({
      width: Math.max(1, Math.round(image.naturalWidth || image.width)),
      height: Math.max(1, Math.round(image.naturalHeight || image.height)),
    })
    image.onerror = () => finish(null)
    image.src = dataUrl
  })
}

function parsePngMetadata(bytes: Uint8Array): TemplateImageMetadata | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  let ppiX: number | undefined
  let ppiY: number | undefined
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = ascii(bytes, offset + 4, 4)
    const dataOffset = offset + 8
    if (type === 'pHYs' && length >= 9 && dataOffset + 9 <= bytes.length && bytes[dataOffset + 8] === 1) {
      ppiX = view.getUint32(dataOffset) * 0.0254
      ppiY = view.getUint32(dataOffset + 4) * 0.0254
    }
    offset = dataOffset + length + 4
  }
  return width > 0 && height > 0 ? { width, height, ...(ppiX ? { ppiX } : {}), ...(ppiY ? { ppiY } : {}) } : null
}

function parseJpegMetadata(bytes: Uint8Array): TemplateImageMetadata | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0
  let height = 0
  let ppiX: number | undefined
  let ppiY: number | undefined
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break
    const marker = bytes[offset + 1]
    offset += 2
    if (marker === 0xd9 || marker === 0xda) break
    const length = view.getUint16(offset)
    if (length < 2 || offset + length > bytes.length) break
    const dataOffset = offset + 2
    if (marker === 0xe0 && length >= 16 && ascii(bytes, dataOffset, 5) === 'JFIF\0') {
      const unit = bytes[dataOffset + 7]
      const densityX = view.getUint16(dataOffset + 8)
      const densityY = view.getUint16(dataOffset + 10)
      if (unit === 1) {
        ppiX = densityX
        ppiY = densityY
      } else if (unit === 2) {
        ppiX = densityX * 2.54
        ppiY = densityY * 2.54
      }
    }
    if (marker === 0xe1 && length >= 16 && ascii(bytes, dataOffset, 6) === 'Exif\0\0') {
      const exifDensity = parseExifDensity(bytes, dataOffset + 6, length - 8)
      ppiX = exifDensity?.ppiX ?? ppiX
      ppiY = exifDensity?.ppiY ?? ppiY
    }
    if (isStartOfFrame(marker) && length >= 8) {
      height = view.getUint16(dataOffset + 1)
      width = view.getUint16(dataOffset + 3)
    }
    offset += length
  }
  return width > 0 && height > 0 ? { width, height, ...(ppiX ? { ppiX } : {}), ...(ppiY ? { ppiY } : {}) } : null
}

function parseExifDensity(bytes: Uint8Array, tiffOffset: number, length: number): { ppiX?: number; ppiY?: number } | null {
  if (length < 8 || tiffOffset + length > bytes.length) return null
  const order = ascii(bytes, tiffOffset, 2)
  const littleEndian = order === 'II'
  if (!littleEndian && order !== 'MM') return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const read16 = (offset: number) => view.getUint16(offset, littleEndian)
  const read32 = (offset: number) => view.getUint32(offset, littleEndian)
  if (read16(tiffOffset + 2) !== 42) return null
  const ifdOffset = tiffOffset + read32(tiffOffset + 4)
  if (ifdOffset + 2 > tiffOffset + length) return null
  const entryCount = read16(ifdOffset)
  let xResolution: number | undefined
  let yResolution: number | undefined
  let resolutionUnit = 2
  for (let index = 0; index < entryCount; index += 1) {
    const entry = ifdOffset + 2 + index * 12
    if (entry + 12 > tiffOffset + length) break
    const tag = read16(entry)
    const type = read16(entry + 2)
    const count = read32(entry + 4)
    if ((tag === 0x011a || tag === 0x011b) && type === 5 && count >= 1) {
      const rationalOffset = tiffOffset + read32(entry + 8)
      if (rationalOffset + 8 <= tiffOffset + length) {
        const denominator = read32(rationalOffset + 4)
        const value = denominator ? read32(rationalOffset) / denominator : undefined
        if (tag === 0x011a) xResolution = value
        else yResolution = value
      }
    } else if (tag === 0x0128 && type === 3 && count >= 1) {
      resolutionUnit = read16(entry + 8)
    }
  }
  const multiplier = resolutionUnit === 3 ? 2.54 : 1
  return {
    ...(xResolution ? { ppiX: xResolution * multiplier } : {}),
    ...(yResolution ? { ppiY: yResolution * multiplier } : {}),
  }
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}
