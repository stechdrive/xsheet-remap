import { PAPER_TRANSCRIPTION_FORMAT, PAPER_TRANSCRIPTION_VERSION, type PaperTranscriptionKind } from './paper-transcription-types'

interface Rule {
  type?: 'object' | 'array' | 'string' | 'integer'
  const?: string | number
  enum?: readonly string[]
  properties?: Record<string, Rule>
  required?: string[]
  additionalProperties?: false
  items?: Rule
  minItems?: number
  maxItems?: number
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  oneOf?: Rule[]
}
const text = (maxLength: number, minLength = 0): Rule => ({ type: 'string', minLength, maxLength })
const integer: Rule = { type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }
const object = (properties: Record<string, Rule>, required = Object.keys(properties)): Rule =>
  ({ type: 'object', properties, required, additionalProperties: false })
const array = (items: Rule, maxItems: number, minItems = 1): Rule => ({ type: 'array', items, minItems, maxItems })
const run = (kind: PaperTranscriptionKind, extra: Record<string, Rule> = {}, required: string[] = []): Rule =>
  object({ from: integer, to: integer, kind: { const: kind }, raw: text(500), note: text(1000), ...extra },
    ['from', 'to', 'kind', 'raw', ...required])

/** The prompt, runtime checks and exported JSON Schema share this definition.
 * Deliberately uses a small, CSP-safe subset; no runtime code generation/eval. */
export const paperTranscriptionResponseSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'xsheet-remap paper transcription v1',
  ...object({
    format: { const: PAPER_TRANSCRIPTION_FORMAT },
    version: { const: PAPER_TRANSCRIPTION_VERSION },
    requestId: text(100, 1),
    targets: array(object({
      targetId: text(100, 1),
      runs: array({ oneOf: [
        run('cell', { value: text(100, 1) }, ['value']),
        ...(['empty', 'hold', 'blank', 'inbetween', 'reverse'] as const).map(kind => run(kind)),
        run('uncertain', {
          note: text(1000, 1), frameCandidates: array(integer, 100, 0),
          valueCandidates: array(text(100, 1), 20, 0),
        }, ['note']),
        run('unread', { note: text(1000, 1) }, ['note']),
      ] }, 20000),
    }), 128),
  }),
}

export function paperTranscriptionSchemaErrors(value: unknown): string[] {
  return checkRule(paperTranscriptionResponseSchema, value, '$').slice(0, 20)
}

function checkRule(rule: Rule, value: unknown, path: string): string[] {
  if (rule.oneOf) {
    const results = rule.oneOf.map(branch => checkRule(branch, value, path))
    if (results.filter(errors => !errors.length).length === 1) return []
    const kind = isRecord(value) ? value.kind : undefined
    const branch = rule.oneOf.findIndex(item => item.properties?.kind?.const === kind)
    return branch >= 0 ? results[branch]! : [`${path}.kind: 未対応の種類です。`]
  }
  if (rule.const !== undefined && value !== rule.const) return [`${path}: ${JSON.stringify(rule.const)} が必要です。`]
  if (rule.enum && !rule.enum.includes(String(value))) return [`${path}: 許可されていない値です。`]
  if (rule.type === 'object') {
    if (!isRecord(value)) return [`${path}: オブジェクトが必要です。`]
    const errors: string[] = []
    for (const name of rule.required ?? []) if (!Object.hasOwn(value, name)) errors.push(`${path}.${name}: 必須項目です。`)
    for (const [key, item] of Object.entries(value)) {
      const child = Object.hasOwn(rule.properties ?? {}, key) ? rule.properties![key] : undefined
      if (!child) { if (rule.additionalProperties === false) errors.push(`${path}.${key}: 未対応の項目です。`) }
      else errors.push(...checkRule(child, item, `${path}.${key}`))
      if (errors.length >= 20) break
    }
    return errors
  }
  if (rule.type === 'array') {
    if (!Array.isArray(value)) return [`${path}: 配列が必要です。`]
    if (value.length < (rule.minItems ?? 0) || value.length > (rule.maxItems ?? Infinity)) return [`${path}: 要素数が範囲外です。`]
    const errors: string[] = []
    for (let i = 0; i < value.length && errors.length < 20; i++) errors.push(...checkRule(rule.items!, value[i], `${path}[${i}]`))
    return errors
  }
  if (rule.type === 'string' && (typeof value !== 'string' || Array.from(value).length < (rule.minLength ?? 0) || Array.from(value).length > (rule.maxLength ?? Infinity))) {
    return [`${path}: ${rule.minLength ?? 0}〜${rule.maxLength}文字の文字列が必要です。`]
  }
  if (rule.type === 'integer' && !Number.isSafeInteger(value)) return [`${path}: 安全な整数が必要です。`]
  return []
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
