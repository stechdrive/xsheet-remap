import projectLicense from '../../../LICENSE?raw'
import thirdPartyNotices from '../../../THIRD_PARTY_NOTICES.md?raw'

export const licenseHelpDescription = '使用しているライブラリと、CLIP解析で参考にした公開資料のライセンス・謝辞です。'

export function LicenseNotices() {
  return (
    <article className="licenseNotices" aria-label="ライセンス・謝辞">
      <h2>xsheet-remap</h2>
      <pre>{projectLicense}</pre>
      <h2>ライセンス・謝辞</h2>
      <pre>{thirdPartyNotices}</pre>
    </article>
  )
}
