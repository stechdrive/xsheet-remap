import type { RecognitionCandidate } from '@xsheet-remap/core'

const OCR_MAX_LABEL_LENGTH = 8

export function normalizeRecognitionLabel(rawText: string): string | null {
  const withEnclosedCharacters = Array.from(rawText).map(expandEnclosedCharacter).join('')
  const normalized = withEnclosedCharacters
    .normalize('NFKC')
    .replace(/[\s\u00a0]+/g, '')
    .replace(/[◯〇]/g, '○')
  const allowed = Array.from(normalized)
    .filter(character => /[0-9A-Za-zぁ-ゖァ-ヺ一-龯々〆ヶー○△▽□◇◎]/u.test(character))
    .join('')
  if (!allowed || allowed.length > OCR_MAX_LABEL_LENGTH) return null
  if (!/[0-9A-Za-zぁ-ゖァ-ヺ一-龯々〆ヶ]/u.test(allowed)) return null
  return allowed
}

export function deduplicateRecognitionCandidates(candidates: RecognitionCandidate[]): RecognitionCandidate[] {
  const byTarget = new Map<string, RecognitionCandidate>()
  for (const candidate of candidates) {
    const key = `${candidate.sheetRole}\u0000${candidate.paperTrack}\u0000${candidate.frame}`
    const current = byTarget.get(key)
    if (!current || candidate.confidence > current.confidence) byTarget.set(key, candidate)
  }
  return [...byTarget.values()].sort((a, b) =>
    a.frame - b.frame
    || a.sheetRole.localeCompare(b.sheetRole)
    || a.paperTrack.localeCompare(b.paperTrack, 'ja'),
  )
}

function expandEnclosedCharacter(character: string): string {
  const codePoint = character.codePointAt(0) ?? 0
  if (codePoint >= 0x2460 && codePoint <= 0x2473) return `○${codePoint - 0x245f}`
  if (codePoint >= 0x24b6 && codePoint <= 0x24cf) return `○${String.fromCharCode(65 + codePoint - 0x24b6)}`
  if (codePoint >= 0x24d0 && codePoint <= 0x24e9) return `○${String.fromCharCode(97 + codePoint - 0x24d0)}`
  if (codePoint >= 0x3251 && codePoint <= 0x325f) return `○${codePoint - 0x323c}`
  if (codePoint >= 0x32b1 && codePoint <= 0x32bf) return `○${codePoint - 0x328c}`
  if (codePoint >= 0x32d0 && codePoint <= 0x32fe) return `○${character.normalize('NFKC')}`
  return character
}
