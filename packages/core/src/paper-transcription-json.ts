/** Bounded JSON reader that rejects duplicate keys, including escaped spellings.
 * Only a whole JSON document or one whole fenced JSON block is accepted. */
export function readPaperTranscriptionJson(source: string): unknown {
  if (source.length > 2_000_000) throw new Error('JSONは2,000,000文字以内に分けてください。')
  let text = source.replace(/^\uFEFF/, '').trim()
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i.exec(text)
  if (fence) text = fence[1]!.trim()
  let position = 0
  const fail = (message: string): never => { throw new Error(`JSONの${position + 1}文字目: ${message}`) }
  const whitespace = () => { while (/[ \t\r\n]/.test(text[position] ?? '\0')) position++ }
  const string = (): string => {
    const start = position++
    while (position < text.length) {
      const character = text[position++]!
      if (character === '\\') { position++; continue }
      if (character === '"') {
        try { return JSON.parse(text.slice(start, position)) as string }
        catch { return fail('文字列の書式が不正です。') }
      }
    }
    return fail('文字列が閉じられていません。')
  }
  const value = (depth: number): unknown => {
    if (depth > 30) return fail('入れ子が深すぎます。')
    whitespace()
    const character = text[position]
    if (character === '"') return string()
    if (character === '{' || character === '[') {
      position++; whitespace()
      const isObject = character === '{', close = isObject ? '}' : ']'
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>
      const list: unknown[] = []
      const keys = new Set<string>()
      if (text[position] === close) { position++; return isObject ? result : list }
      while (position < text.length) {
        whitespace()
        if (isObject) {
          if (text[position] !== '"') return fail('項目名は二重引用符で囲んでください。')
          const key = string()
          if (keys.has(key)) return fail(`項目「${key}」が重複しています。`)
          keys.add(key); whitespace()
          if (text[position++] !== ':') return fail('項目名の後に : が必要です。')
          result[key] = value(depth + 1)
        } else list.push(value(depth + 1))
        whitespace()
        if (text[position] === close) { position++; return isObject ? result : list }
        if (text[position++] !== ',') return fail('区切りの , が必要です。')
      }
      return fail('JSONが途中で切れています。')
    }
    const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(position))
    if (!literal) return fail('JSONの値を読み取れません。説明文を除いて貼り付けてください。')
    position += literal[0].length
    const parsed: unknown = JSON.parse(literal[0])
    if (typeof parsed === 'number' && !Number.isFinite(parsed)) return fail('数値が大きすぎます。')
    return parsed
  }
  const result = value(0)
  whitespace()
  if (position !== text.length) fail('JSONの後に余分な内容があります。')
  return result
}
