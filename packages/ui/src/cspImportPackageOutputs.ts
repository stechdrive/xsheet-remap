import type { CspImportPackageBuildResult } from '@xsheet-remap/core'
import { exportXdts } from '@xsheet-remap/xdts'

export interface CspImportPackageTextOutput {
  relativePath: string
  contents: string
}

export function cspImportPackageTextOutputs(packageBuild: CspImportPackageBuildResult): CspImportPackageTextOutput[] {
  return [
    {
      relativePath: packageBuild.manifestFileName,
      contents: `${JSON.stringify(packageBuild.manifest, null, 2)}\n`,
    },
    ...(packageBuild.setupOutput
      ? [{
          relativePath: packageBuild.setupOutput.xdtsFileName,
          contents: exportXdts(packageBuild.setupOutput.exportPlan),
        }]
      : []),
    ...packageBuild.cutOutputs.map(output => ({
      relativePath: output.xdtsFileName,
      contents: exportXdts(output.exportPlan),
    })),
  ]
}
