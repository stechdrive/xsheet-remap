import { describe, expect, it } from 'vitest'
import { codecMessage } from './celcodec'

describe('vector brush diagnostic messages', () => {
  it('explains approximated brush features without reporting a corrupt document', () => {
    const codes = ['MISSING_BRUSH_GRAPH', 'UNSUPPORTED_BRUSH_SEQUENCE', 'UNSUPPORTED_BRUSH_COLOR', 'UNSUPPORTED_BRUSH_INPUT'] as const
    for (const code of codes) {
      const message = codecMessage(code)
      expect(message).toMatch(/近似|再現できません/)
      expect(message).not.toMatch(/CLIP形式|CLIPデータが不正|残りのストローク/)
    }
    expect(codecMessage('INVALID_BRUSH_PATTERN')).toContain('ブラシ先端の参照情報が不正')
  })
})
