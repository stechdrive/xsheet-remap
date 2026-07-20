import type { MemoAppearance } from './types'

export const DEFAULT_MEMO_APPEARANCE: Readonly<MemoAppearance> = Object.freeze({
  inkOpacity: 1,
  textOpacity: 1,
  text: Object.freeze({
    color: '#000000',
    fontSizeUnits: 1,
  }),
  background: Object.freeze({
    enabled: false,
    color: '#fff6a8',
    opacity: 0.28,
  }),
})

export function normalizeMemoAppearance(value?: Partial<MemoAppearance> | null): MemoAppearance {
  const background = value?.background
  const text = value?.text
  return {
    inkOpacity: normalizeOpacity(value?.inkOpacity, DEFAULT_MEMO_APPEARANCE.inkOpacity),
    textOpacity: normalizeOpacity(value?.textOpacity, DEFAULT_MEMO_APPEARANCE.textOpacity),
    text: {
      color: typeof text?.color === 'string' && text.color.trim()
        ? text.color
        : DEFAULT_MEMO_APPEARANCE.text.color,
      fontSizeUnits: Number.isFinite(text?.fontSizeUnits)
        ? Math.max(0.25, text!.fontSizeUnits)
        : DEFAULT_MEMO_APPEARANCE.text.fontSizeUnits,
    },
    background: {
      enabled: background?.enabled === true,
      color: typeof background?.color === 'string' && background.color.trim()
        ? background.color
        : DEFAULT_MEMO_APPEARANCE.background.color,
      opacity: normalizeOpacity(background?.opacity, DEFAULT_MEMO_APPEARANCE.background.opacity),
    },
  }
}

function normalizeOpacity(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value!)) : fallback
}
