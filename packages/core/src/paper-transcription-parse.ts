import { paperTranscriptionSchemaErrors } from './paper-transcription-schema'
import { readPaperTranscriptionJson } from './paper-transcription-json'
import { isNullLabel } from './project-shared'
import type { PaperTranscriptionRequest, PaperTranscriptionResult } from './paper-transcription-types'

export function parsePaperTranscription(source: string, request: PaperTranscriptionRequest): PaperTranscriptionResult {
  const value = readPaperTranscriptionJson(source)
  const errors = paperTranscriptionSchemaErrors(value)
  if (errors.length) throw new Error(errors.join('\n'))
  return validatePaperTranscription(value as PaperTranscriptionResult, request)
}

export function validatePaperTranscription(result: PaperTranscriptionResult, request: PaperTranscriptionRequest): PaperTranscriptionResult {
  const errors = paperTranscriptionSchemaErrors(result)
  if (errors.length) throw new Error(errors.join('\n'))
  if (result.requestId !== request.requestId) throw new Error('解析依頼IDが一致しません。この依頼への返答を読み込んでください。')
  const seen = new Set<string>()
  for (const [index, entry] of result.targets.entries()) {
    const target = request.targets.find(item => item.targetId === entry.targetId)
    const path = `targets[${index}] (${entry.targetId})`
    if (!target) throw new Error(`${path}: 依頼にない対象です。`)
    if (seen.has(entry.targetId)) throw new Error(`${path}: 対象が重複しています。`)
    seen.add(entry.targetId)
    let nextFrame = target.from
    for (const [runIndex, run] of entry.runs.entries()) {
      const location = `${path}.runs[${runIndex}]`
      if (run.from !== nextFrame || run.to < run.from || run.to > target.to) {
        throw new Error(`${location}: ${nextFrame}コマ目から順番に、欠落・重複なく${target.to}コマ目まで記録してください。`)
      }
      if (['cell', 'blank', 'inbetween', 'reverse'].includes(run.kind) && run.from !== run.to) throw new Error(`${location}: 記入のあるコマは一件ずつ記録してください。継続コマはempty／holdで分けます。`)
      if (run.kind === 'cell' && (!run.value?.trim() || run.value !== run.value.trim() || Array.from(run.value).some(character => character.charCodeAt(0) < 32))) throw new Error(`${location}.value: 前後の空白や制御文字を含まないセル番号を指定してください。`)
      if (run.kind === 'cell' && (isNullLabel(run.value!) || run.value === '/' || run.value === '.')) throw new Error(`${location}.value: カラセル・中割・逆シートの記号は専用のkindにしてください。意味が不明ならuncertainにします。`)
      if (run.kind === 'empty' && run.raw !== '') throw new Error(`${location}.raw: 記入なしは空文字列にしてください。`)
      if (run.frameCandidates?.some(frame => frame < run.from || frame > run.to)
        || new Set(run.frameCandidates).size !== (run.frameCandidates?.length ?? 0)) throw new Error(`${location}.frameCandidates: 候補はこの要確認区間内の重複しないコマ番号にしてください。`)
      nextFrame = run.to + 1
    }
    if (nextFrame !== target.to + 1) throw new Error(`${path}: ${nextFrame}〜${target.to}コマ目が欠落しています。未処理部分はunreadで記録してください。`)
  }
  const missing = request.targets.filter(target => !seen.has(target.targetId))
  if (missing.length) throw new Error(`対象が欠落しています: ${missing.map(target => target.targetId).join(', ')}。未処理の対象もunreadで記録してください。`)
  return result
}
