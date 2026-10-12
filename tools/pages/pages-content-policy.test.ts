import { describe, expect, it } from 'vitest'
import { containsUnexpectedOcrIdentifier } from './pages-content-policy.mjs'

const notice = '# Third-party notices\nPaddleOCR.js and PP-OCRv5: Apache-2.0\n'
const literal = JSON.stringify(notice)
const inspect = (content: string, fileName = 'assets/app.js') => containsUnexpectedOcrIdentifier(fileName, content, notice)

describe('Pages OCR content policy', () => {
  it('accepts the complete license notice embedded as a string or a static template', () => {
    expect(inspect(`const notice = ${literal}; render(notice);`)).toBe(false)
    expect(inspect('const notice = `' + notice + '`;')).toBe(false)
    expect(inspect('const notice = `' + notice.replaceAll('\n', '\r\n') + '`;')).toBe(false)
  })

  it('still rejects OCR imports, calls and other strings next to an allowed notice', () => {
    for (const code of ['import("@paddleocr/paddleocr-js");', 'PaddleOCR.recognize();', 'const model = "PP-OCRv5";']) {
      expect(inspect(`const notice = ${literal}; ${code}`)).toBe(true)
      expect(inspect(`${code} const notice = ${literal};`)).toBe(true)
    }
  })

  it('does not exempt partial, modified or interpolated notices', () => {
    expect(inspect('const notice = "PaddleOCR.js";')).toBe(true)
    expect(inspect(`const notice = ${JSON.stringify(notice + 'extra code')};`)).toBe(true)
    expect(inspect('const notice = `' + notice + '${value}`;')).toBe(true)
  })

  it('keeps rejecting identifiers in non-JavaScript assets and malformed JavaScript', () => {
    expect(inspect(notice, 'assets/model.json')).toBe(true)
    expect(inspect(`<script>const notice = ${literal}</script>`, 'index.html')).toBe(true)
    expect(inspect(`const notice = ${literal}; function (`)).toBe(true)
  })
})
