import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { sha256, sourceIdentity, verifyExecutable } from './evidence.mjs'
import { assertSupportedRuntime, runtimeIdentity } from '../checks/runtime.mjs'

// These are acceptance observations, not a script that drives the desktop.
export const computerUseScenarios = [
  { id: 'template-entry', checks: [
    ['corrector-entry', 'Correctorからテンプレート編集を開き、名前の編集が下書きに保存される'],
    ['draft-recovery', 'テストで起動した編集プロセスだけを終了して開き直し、下書きを復元できる。Correctorの選択は変わらない'],
    ['remap-entry', 'Remapのメニューからテンプレート編集を開ける。元のシートウィンドウも残る'],
  ] },
  { id: 'template-authoring', checks: [
    ['timeline-drag-history', 'タイムラインを実マウスで移動し、表示更新と1回のUndo/Redoを確認する'],
    ['memo-drag-history', 'MEMO領域を実マウスで移動し、Undoとキャンバス外でのハンドル非表示を確認する'],
    ['numeric-drag-history', '数値入力後のドラッグが正しい領域に作用し、入力とドラッグを個別にUndoできる'],
  ] },
  { id: 'explorer-import', checks: [
    ['folder-drop', '通常起動からCLIP組み立てへ切り替え、Explorerのフォルダを右CLIPツリーへ1回ドロップして全画像を登録する'],
    ['multiple-file-drop', 'Explorerで複数画像を選択して1回ドロップし、選択した全ファイルだけが登録される'],
    ['quick-look', '登録画像のクイックルックが表示され、Escapeで現在のCLIPツリーへ戻れる'],
  ] },
  { id: 'real-dnd', checks: [
    ['layer-assignment-history', '右CLIPツリーからセルへ実ドラッグし、割当と直後のUndo/Redoを確認する。元画像は残る'],
    ['range-outside', '範囲を無効な領域へドラッグして離し、内容と履歴が変わらず次の操作ができる'],
    ['range-history', '範囲移動を確定し、範囲全体が1回のUndo/Redoで戻る。プレビュー中に元データは変わらない'],
    ['mode-return', 'シート編集からCLIP組み立てへ戻っても右CLIPツリーの元レイヤーが保持される'],
  ] },
]
const pointerPath = 'reference-local/desktop-acceptance/computer-use/current.json'
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const nonempty = value => typeof value === 'string' && value.trim().length > 0

function within(root, relative) {
  if (!nonempty(relative) || path.isAbsolute(relative)) throw new Error('Evidence paths must be relative')
  const full = path.resolve(root, relative)
  const resolvedRoot = fs.realpathSync(root)
  const resolved = fs.existsSync(full) ? fs.realpathSync(full) : full
  const outside = path.relative(resolvedRoot, resolved)
  if (outside === '..' || outside.startsWith(`..${path.sep}`) || path.isAbsolute(outside)) throw new Error('Evidence path leaves its directory')
  return full
}

export function desktopArtifacts(root, identity) {
  if (identity.platform !== 'win32') throw new Error('Desktop acceptance requires Windows EXEs')
  const buildState = readJson(path.join(root, 'dev-local/build-state.json'))
  const artifacts = {}
  for (const [key, name] of [['remap', 'xsheet-remap.exe'], ['corrector', 'xsheet-corrector.exe']]) {
    const exePath = path.join(root, 'dev-local', name)
    const verified = verifyExecutable({ exePath, bytes: fs.readFileSync(exePath), buildState, identity })
    if (!nonempty(verified.buildSessionId)) throw new Error('EXE build session is missing')
    artifacts[key] = { executable: `dev-local/${name}`, sha256: verified.sha256, commit: verified.commit,
      buildSessionId: verified.buildSessionId, version: verified.version, runtime: verified.runtime ?? null }
  }
  if (artifacts.remap.buildSessionId !== artifacts.corrector.buildSessionId) throw new Error('Build both EXEs in the same session before desktop acceptance')
  return artifacts
}

export function prepareComputerUseAcceptance(root, identity = sourceIdentity(root)) {
  const artifacts = desktopArtifacts(root, identity)
  const runId = `${Date.now()}-${randomUUID()}`
  const directory = `reference-local/desktop-acceptance/computer-use/${runId}`
  const record = { schemaVersion: 1, inputMode: 'codex-computer-use', tool: '@oai/sky', status: 'pending',
    runId, preparedAt: new Date().toISOString(), startedAt: null, finishedAt: null, operator: '', identity, artifacts,
    scenarios: computerUseScenarios.map(scenario => ({ id: scenario.id, checks: scenario.checks.map(([id, expected]) => ({
      id, expected, status: 'pending', steps: [], observed: '', screenshots: [],
    })) })) }
  fs.mkdirSync(path.join(root, directory, 'screenshots'), { recursive: true })
  const recordPath = `${directory}/record.json`
  fs.writeFileSync(path.join(root, recordPath), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  fs.writeFileSync(path.join(root, directory, 'prepared.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  fs.writeFileSync(path.join(root, pointerPath), JSON.stringify({ recordPath }, null, 2) + '\n')
  return recordPath
}

function sameKeys(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length || new Set(actual.map(item => item.id)).size !== expected.length
    || expected.some(id => !actual.some(item => item.id === id))) throw new Error(`Incomplete or duplicate ${label}`)
}

export function validateComputerUseAcceptance(root, recordPath, identity, now = Date.now()) {
  const fullPath = within(root, recordPath)
  const bytes = fs.readFileSync(fullPath), record = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
  if (record.schemaVersion !== 1 || record.inputMode !== 'codex-computer-use' || record.tool !== '@oai/sky') throw new Error('Codex Computer Use evidence is required; legacy/protocol-only evidence is not accepted')
  if (record.status !== 'passed' || !nonempty(record.operator)) throw new Error('Computer Use acceptance is incomplete')
  if (Object.keys(identity).some(key => JSON.stringify(record.identity?.[key]) !== JSON.stringify(identity[key]))) throw new Error('Computer Use evidence does not match the current source and runtime')
  const artifacts = desktopArtifacts(root, identity)
  if (JSON.stringify(record.artifacts) !== JSON.stringify(artifacts)) throw new Error('Computer Use evidence does not match the current EXE hashes/build sessions')
  const dates = [record.preparedAt, record.startedAt, record.finishedAt].map(value => typeof value === 'string' ? Date.parse(value) : NaN)
  if (dates.some(value => !Number.isFinite(value)) || dates[0] > dates[1] || dates[1] >= dates[2] || dates[2] > now) throw new Error('Computer Use evidence has invalid observation times')
  sameKeys(record.scenarios, computerUseScenarios.map(scenario => scenario.id), 'desktop scenarios')
  const directory = path.dirname(fullPath)
  const scenarios = computerUseScenarios.map(required => {
    const scenario = record.scenarios.find(item => item.id === required.id)
    sameKeys(scenario.checks, required.checks.map(([id]) => id), `${required.id} checks`)
    for (const check of scenario.checks) {
      if (check.status !== 'passed' || !nonempty(check.observed) || !Array.isArray(check.steps) || !check.steps.length || !check.steps.every(nonempty)) throw new Error(`Unverified Computer Use check: ${required.id}/${check.id}`)
      if (!Array.isArray(check.screenshots) || !check.screenshots.length) throw new Error(`Screenshot evidence is missing: ${check.id}`)
      for (const screenshot of check.screenshots) {
        if (!nonempty(screenshot.screenshotId)) throw new Error('Computer Use screenshot ID is missing')
        const capturedAt = Date.parse(screenshot.capturedAt)
        if (!Number.isFinite(capturedAt) || capturedAt < dates[1] || capturedAt > dates[2]) throw new Error('Screenshot is outside the recorded observation')
        const image = fs.readFileSync(within(directory, screenshot.path))
        const png = image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        const jpeg = image[0] === 255 && image[1] === 216 && image[2] === 255
        if ((!png && !jpeg) || sha256(image) !== screenshot.sha256) throw new Error('Screenshot content/hash does not match the recorded evidence')
      }
    }
    return { scenario: required.id, inputMode: record.inputMode, checks: scenario.checks.length, directory: path.relative(root, directory).replaceAll('\\', '/') }
  })
  return { recordPath, recordSha256: sha256(bytes), startedAt: record.startedAt, finishedAt: record.finishedAt, artifacts, scenarios }
}

export function readComputerUseAcceptance(root, identity, selectedPath = null) {
  const pointer = path.join(root, pointerPath)
  if (!selectedPath && !fs.existsSync(pointer)) throw new Error('Computer Use evidence is missing. Run npm run desktop:prepare, perform the checklist with Codex Computer Use, then npm run verify:desktop.')
  const recordPath = selectedPath ?? readJson(pointer).recordPath
  return validateComputerUseAcceptance(root, recordPath, identity)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertSupportedRuntime(runtimeIdentity())
  if (process.argv.slice(2).join(' ') !== 'prepare') throw new Error('Usage: npm run desktop:prepare')
  const recordPath = prepareComputerUseAcceptance(process.cwd())
  console.log(`[desktop] Prepared pending Computer Use checklist: ${recordPath}`)
  console.log('[desktop] No GUI action has been performed. Complete the actual EXE observations before verify:desktop.')
}
