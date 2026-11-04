import { useEffect, useState } from 'react'
import projectLicense from '../../../LICENSE?raw'

export const licenseHelpDescription = '本アプリ、使用ライブラリ、フォント・音声素材のライセンスと出典を確認できます。'

type ComponentNotice = {
  id: string; group: string; name: string; version: string; license: string
  source: string; textIds: string[]; information?: string; links?: string[]
}
type LicenseData = { catalog: { components: ComponentNotice[]; texts: Record<string, string> }; acknowledgements: string }
const groups = [['web', 'アプリのライブラリ'], ['assets', 'フォント・音声素材'], ['windows', 'Windows版の構成ライブラリ']] as const

function ComponentLicense({ component, texts }: { component: ComponentNotice; texts: Record<string, string> }) {
  const [expanded, setExpanded] = useState(false)
  return <details className="licenseEntry" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><strong>{component.name}</strong> <span>{component.version} · {component.license}</span></summary>
    {expanded && <div>
      {component.information && <p>{component.information}</p>}
      {[component.source, ...(component.links ?? [])].filter(Boolean).map(url => <p key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></p>)}
      {component.textIds.map(id => <pre key={id}>{texts[id]}</pre>)}
    </div>}
  </details>
}

export function LicenseNotices() {
  const [data, setData] = useState<LicenseData | null>(null)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    import('./license-data').then(value => { if (active) setData(value) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [attempt])
  const search = query.trim().toLocaleLowerCase()
  const components = data?.catalog.components.filter(component => `${component.name} ${component.version} ${component.license}`.toLocaleLowerCase().includes(search)) ?? []
  return (
    <article className="licenseNotices" aria-label="ライセンス・謝辞">
      <h2>xsheet-remap</h2>
      <details className="licenseEntry"><summary>本アプリのライセンス（MIT）</summary><pre>{projectLicense}</pre></details>
      {!data && !error && <p role="status">ライセンスを読み込んでいます…</p>}
      {error && !data && <p role="alert">ライセンスを読み込めませんでした。<button type="button" onClick={() => { setError(false); setAttempt(value => value + 1) }}>再読み込み</button></p>}
      {data && <>
        <label className="licenseSearch">ライブラリ名・ライセンスで検索
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} />
        </label>
        <p className="licenseCount" role="status">{components.length}件</p>
        {!components.length && <p>一致するライブラリはありません。</p>}
        {groups.map(([key, title]) => {
          const entries = components.filter(component => component.group === key)
          return entries.length > 0 && <section key={key} aria-label={title}><h3>{title}</h3>
            {entries.map(component => <ComponentLicense key={component.id} component={component} texts={data.catalog.texts} />)}
          </section>
        })}
        <details className="licenseEntry"><summary>形式研究の謝辞・出典と補足</summary><pre>{data.acknowledgements}</pre></details>
      </>}
    </article>
  )
}
