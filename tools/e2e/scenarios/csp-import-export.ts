import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface ClientPoint {
  x: number
  y: number
}

interface CspImportExportScenarioDependencies {
  cutRoot: string
  checks: string[]
  mouseClick: (point: ClientPoint) => Promise<void>
  centerOfSelector: (selector: string) => Promise<ClientPoint>
  waitForPageCondition: (predicate: () => boolean, label: string) => Promise<void>
  clickButtonByText: (label: string) => Promise<void>
  evaluatePage: <T>(expression: string) => Promise<T>
  waitForCondition: <T>(check: () => Promise<T> | T, timeoutMs: number, label: string) => Promise<T>
}

export async function verifyCspImportExportScenario({
  cutRoot,
  checks,
  mouseClick,
  centerOfSelector,
  waitForPageCondition,
  clickButtonByText,
  evaluatePage,
  waitForCondition,
}: CspImportExportScenarioDependencies): Promise<void> {
  const outputDirectory = join(cutRoot, 'xsheet-csp-import')
  const staleOutput = join(outputDirectory, 'obsolete-from-previous-export.xdts')
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(staleOutput, 'stale', 'utf8')

  await mouseClick(await centerOfSelector('details.appNavMenu > summary[aria-label="画面切替"]'))
  await waitForPageCondition(() => Boolean(document.querySelector('.actionMenuContent.appNavMenu')), 'main navigation menu')
  await clickButtonByText('書き出し')
  await clickButtonByText('CSP自動登録データを書き出す…')
  await waitForPageCondition(() => {
    const dialog = document.querySelector('.timingExportDialog')
    const text = dialog?.textContent ?? ''
    return text.includes('xsheet-csp-import')
      && text.includes('画像付き 0件')
      && text.includes('キーのみ 1件')
      && text.includes('xsheet-importerへ選択またはドロップ')
      && !text.includes('画像素材が未割当')
  }, 'CSP import export plan summary')
  const displayedPath = await evaluatePage<string>(`
    document.querySelector('.cspImportDestination code')?.textContent ?? ''
  `)
  if (displayedPath.includes('\\\\?\\')) {
    throw new Error(`CSP export dialog leaked a Windows device path: ${displayedPath}`)
  }
  if (!displayedPath.endsWith('xsheet-csp-import')) {
    throw new Error(`CSP export dialog showed an unexpected destination: ${displayedPath}`)
  }
  checks.push('showed the fixed cut-folder destination, helper handoff, and neutral key-only summary without a device path')

  await clickButtonByText('書き出す')
  await waitForPageCondition(() => !document.querySelector('.timingExportDialog'), 'CSP import export dialog close')
  await waitForPageCondition(() => {
    const notice = document.querySelector('.exportOperationNotice')
    return (notice?.textContent ?? '').includes('CSP自動登録データを書き出しました')
      && Array.from(notice?.querySelectorAll('button') ?? []).some(button => button.textContent?.trim() === 'フォルダを開く')
  }, 'non-modal CSP export completion notice')

  const manifestPath = join(outputDirectory, 'csp-import.xci')
  await waitForCondition(async () => access(manifestPath).then(() => true).catch(() => false), 10000, 'written csp-import.xci')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    schemaVersion?: number
    assetRoot?: string
    cuts?: Array<{ tracks?: Array<{ cels?: Array<{ cspCellName?: string; material?: unknown }> }> }>
  }
  const cels = manifest.cuts?.flatMap(cut => cut.tracks?.flatMap(track => track.cels ?? []) ?? []) ?? []
  if (manifest.schemaVersion !== 4 || manifest.assetRoot !== '..') {
    throw new Error('written CSP import manifest does not match the helper v4 relative-root contract')
  }
  if (!cels.some(cel => cel.cspCellName === 'A1' && cel.material === undefined)) {
    throw new Error('written CSP import manifest did not preserve the unassigned A1 cell as a key-only registration')
  }
  const outputNames = await readdir(outputDirectory)
  if (outputNames.includes('obsolete-from-previous-export.xdts')) {
    throw new Error('managed CSP export left a stale file from the previous package')
  }
  if (!outputNames.some(name => name.toLowerCase().endsWith('.xdts'))) {
    throw new Error('managed CSP export did not write an XDTS file')
  }
  checks.push('replaced the managed output atomically, removed stale files, and wrote a helper-compatible key-only manifest')
  checks.push('reported completion in the status bar without a save-complete modal')
}
