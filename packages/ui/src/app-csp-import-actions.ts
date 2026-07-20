import { openDirectoryInFileManager, saveBinaryFile, writeCspImportPackage } from '@xsheet-remap/adapters'
import type { ExportOperationNotice } from './appTypes'
import type { CspImportExportPlan } from './cspImportExportPlan'

export async function saveCspImportExportPlan(plan: CspImportExportPlan): Promise<ExportOperationNotice> {
  if (plan.target.mode === 'portable-zip') {
    if (!plan.portable) throw new Error('Web版のCSP自動登録ZIPを準備できませんでした。')
    await saveBinaryFile(plan.portable.archiveBytes, plan.portable.archiveFileName, 'application/zip')
    return { message: `${plan.portable.archiveFileName} のダウンロードを開始しました。` }
  }
  if (plan.target.mode !== 'native-cut-folder' || !plan.packageBuild.assetRootPath) {
    throw new Error('カットフォルダを再接続してください。')
  }
  const result = await writeCspImportPackage({
    assetRootPath: plan.packageBuild.assetRootPath,
    outputDirectoryName: plan.packageBuild.outputDirectoryName,
    files: plan.files,
  })
  return {
    message: `CSP自動登録データを書き出しました: ${plan.packageBuild.outputDirectoryName}\\${plan.packageBuild.manifestFileName}`,
    directoryPath: result.outputDirectoryPath,
  }
}

export async function openCspImportExportDirectory(path: string): Promise<void> {
  await openDirectoryInFileManager(path)
}
