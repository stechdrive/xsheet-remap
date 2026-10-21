import { invokeDesktopCommand, isTauriHost } from '@xsheet-remap/adapters'

export type RemapHelpTopic = 'sheet' | 'clip' | 'template'
export type RemapHelpLocation = {
  topic: RemapHelpTopic
  view: 'quick' | 'detailed' | 'licenses'
  chapter?: string
}

export function readRemapHelpLocation(search: string): RemapHelpLocation {
  const params = new URLSearchParams(search)
  const topic = params.get('topic')
  const view = params.get('view')
  return {
    topic: topic === 'clip' || topic === 'template' ? topic : 'sheet',
    view: view === 'detailed' || view === 'licenses' ? view : 'quick',
    chapter: params.get('chapter') || undefined,
  }
}

export function remapHelpUrl(location: RemapHelpLocation): URL {
  const url = new URL(window.location.href)
  url.search = new URLSearchParams({ app: 'help', topic: location.topic, view: location.view }).toString()
  if (location.chapter) url.searchParams.set('chapter', location.chapter)
  url.hash = ''
  return url
}

export async function openRemapHelp(location: RemapHelpLocation): Promise<void> {
  if (isTauriHost()) {
    await invokeDesktopCommand('open_help_window', { location })
    return
  }
  const opened = window.open(remapHelpUrl(location).href, '_blank')
  if (!opened) throw new Error('ブラウザのポップアップを許可して、もう一度開いてください。')
  // Detach the same-origin help immediately; a non-null handle lets us detect blocking.
  opened.opener = null
}
