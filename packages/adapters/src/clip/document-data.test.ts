import { expect, it } from 'vitest'
import { clipSourceBytes, clipSourceDataUrl } from './document-data'

it.each([0, 256, 32769, 1024 * 1024])('preserves every original CLIP byte across Base64 encoding (%i bytes)', length => {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) bytes[i] = i % 256
  const source = clipSourceDataUrl(bytes)
  expect(clipSourceBytes(source)).toEqual(bytes)
  expect(clipSourceDataUrl(clipSourceBytes(source))).toBe(source)
})

it('rejects non-Base64 and malformed data instead of returning altered source bytes', () => {
  expect(() => clipSourceBytes('data:application/x-clip-studio,abc')).toThrow('元データ')
  expect(() => clipSourceBytes('data:application/x-clip-studio;base64,!')).toThrow()
})
