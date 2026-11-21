import { invalid, MAX_FRAMES, MAX_LINK_EVENTS, Reader, Writer } from './bytes'

/** Numbers are the three sheet markers. A pair carries a distinct paper token. */
export type LinkValue = string | 0 | 1 | 2 | [string, string]
export type LinkPoint = [frame: number, value: LinkValue]

function numberLabel(value: LinkValue): number | undefined {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,7})$/u.test(value) ? Number(value) : undefined
}

function writeValue(out: Writer, value: LinkValue) {
  if (typeof value === 'number') out.uint(value)
  else if (Array.isArray(value)) {
    out.uint(3)
    out.text(value[0])
    out.text(value[1])
  }
  else {
    const n = numberLabel(value)
    if (n !== undefined) out.uint(5 + n)
    else {
      out.uint(4)
      out.text(value)
    }
  }
}

function readValue(r: Reader): LinkValue {
  const code = r.uint(100_000_004)
  if (code <= 2) return code as 0 | 1 | 2
  if (code === 3) return [r.text(), r.text()]
  return code === 4 ? r.text() : String(code - 5)
}

function mostFrequent(counts: Map<number, number>): number {
  let best = 0, count = 0
  for (const [key, n] of counts) if (n > count) {
    best = key
    count = n
  }
  return best
}

function count(counts: Map<number, number>, key: number) { counts.set(key, (counts.get(key) ?? 0) + 1) }

/** Lossless alternatives: sparse keys, a regular exposure sequence with exceptions,
 * mixed twos/threes, or radix-packed dense numbers. No inference survives decoding. */
export function writePoints(out: Writer, points: LinkPoint[], origin: number) {
  const raw = new Writer()
  raw.uint(0)
  raw.uint(points.length)
  let previous = origin
  for (const [frame, value] of points) {
    raw.int(frame - previous)
    writeValue(raw, value)
    previous = frame
  }
  let best = raw
  const choose = (candidate: Writer) => { if (candidate.bytes.length < best.bytes.length) best = candidate }
  if (points.length >= 3 && points.length <= MAX_LINK_EVENTS) {
    const firstFrame = points[0]![0]
    const gaps = new Map<number, number>()
    for (let i = 1; i < points.length; i++) count(gaps, points[i]![0] - points[i - 1]![0])
    const step = mostFrequent(gaps)
    const nums = points.map(p => numberLabel(p[1]))
    if (step > 0) {
      const offsets = new Map<number, number>()
      for (let i = 0; i < points.length; i++) {
        const index = (points[i]![0] - firstFrame) / step
        if (Number.isInteger(index) && nums[i] !== undefined) count(offsets, nums[i]! - index)
      }
      const start = mostFrequent(offsets)
      const length = Math.floor((points[points.length - 1]![0] - firstFrame) / step) + 1
      if (offsets.size && length <= points.length * 2 && length <= MAX_LINK_EVENTS) {
        const actual = new Map(points)
        if (actual.size === points.length) {
          const changes = new Writer()
          let n = 0, last = firstFrame
          const difference = (frame: number, value?: LinkValue) => {
            changes.int(frame - last)
            last = frame
            changes.uint(value === undefined ? 0 : 1)
            if (value !== undefined) writeValue(changes, value)
            n++
          }
          for (let i = 0; i < length; i++) {
            const frame = firstFrame + i * step, value = actual.get(frame)
            if (value !== String(start + i)) difference(frame, value)
            actual.delete(frame)
          }
          for (const [frame, value] of actual) difference(frame, value)
          const run = new Writer()
          run.uint(1)
          run.int(firstFrame - origin)
          run.uint(step)
          run.int(start)
          run.uint(length)
          run.uint(n)
          run.append(changes.bytes)
          choose(run)
        }
      }
    }
    const first = nums[0]
    if (first !== undefined && nums.every((n, i) => n === first + i) && [...gaps.keys()].every(g => g === 2 || g === 3)) {
      const run = new Writer()
      run.uint(2)
      run.int(firstFrame - origin)
      run.uint(first)
      run.uint(points.length)
      const bits = new Uint8Array(Math.ceil((points.length - 1) / 8))
      for (let i = 1; i < points.length; i++) if (points[i]![0] - points[i - 1]![0] === 3) bits[(i - 1) >> 3]! |= 1 << ((i - 1) % 8)
      run.append(bits)
      choose(run)
    }
    if (gaps.size === 1 && gaps.has(1) && nums.every(n => n !== undefined)) {
      const values = nums as number[]
      let low = values[0]!, high = low
      for (const n of values) {
        low = Math.min(low, n)
        high = Math.max(high, n)
      }
      const radix = high - low + 1
      if (radix <= 65536) {
        const dense = new Writer()
        dense.uint(3)
        dense.int(firstFrame - origin)
        dense.uint(points.length)
        dense.uint(low)
        dense.uint(radix)
        for (let i = 0; i < values.length; i += 64) {
          const end = Math.min(values.length, i + 64)
          let bits = 0n
          for (let j = i; j < end; j++) bits = bits * BigInt(radix) + BigInt(values[j]! - low)
          const bytes = Math.ceil((end - i) * Math.log2(radix) / 8)
          for (let j = 0; j < bytes; j++) {
            dense.bytes.push(Number(bits & 255n))
            bits >>= 8n
          }
        }
        choose(dense)
      }
    }
  }
  out.append(best.bytes)
}

export function readPoints(r: Reader, origin: number): LinkPoint[] {
  const mode = r.uint(3)
  if (mode === 0) {
    const size = r.uint(MAX_LINK_EVENTS)
    r.events(size)
    let frame = origin
    return Array.from({ length: size }, () => {
      frame += r.int()
      return [frame, readValue(r)]
    })
  }
  let frame = origin + r.int()
  if (mode === 1) {
    const stride = r.uint(MAX_FRAMES), first = r.int(100_000_000), length = r.uint(MAX_LINK_EVENTS)
    if (!stride || !length || stride * (length - 1) > MAX_FRAMES * 2) invalid()
    r.events(length)
    const values = new Map<number, LinkValue>()
    for (let i = 0; i < length; i++) values.set(frame + i * stride, String(first + i))
    const changes = r.uint(MAX_LINK_EVENTS)
    for (let i = 0; i < changes; i++) {
      frame += r.int()
      if (r.uint(1)) {
        if (!values.has(frame)) r.events(1)
        values.set(frame, readValue(r))
      }
      else values.delete(frame)
    }
    return [...values].sort((a, b) => a[0] - b[0])
  }
  if (mode === 2) {
    const first = r.uint(99_999_999), size = r.uint(MAX_LINK_EVENTS)
    if (!size) invalid()
    r.events(size)
    const bits = r.take(Math.ceil((size - 1) / 8))
    return Array.from({ length: size }, (_, i) => {
      const value: LinkPoint = [frame, String(first + i)]
      frame += 2 + ((bits[i >> 3]! >> (i % 8)) & 1)
      return value
    })
  }
  const size = r.uint(MAX_LINK_EVENTS), low = r.uint(99_999_999), radix = r.uint(65536)
  if (!radix) invalid()
  r.events(size)
  const result: LinkPoint[] = []
  for (let i = 0; i < size; i += 64) {
    const length = Math.min(64, size - i), bytes = r.take(Math.ceil(length * Math.log2(radix) / 8))
    let value = 0n
    for (let j = bytes.length - 1; j >= 0; j--) value = (value << 8n) | BigInt(bytes[j]!)
    for (let j = length - 1; j >= 0; j--) {
      result[i + j] = [frame + i + j, String(low + Number(value % BigInt(radix)))]
      value /= BigInt(radix)
    }
    if (value) invalid()
  }
  return result
}
