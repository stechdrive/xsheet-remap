import { isTauriHost } from '@xsheet-remap/adapters'

export function DocumentFileButton({ label, accept, onOpen, onLoad, className = '', shortcut }: {
  label: string
  accept: string
  onOpen: () => void
  onLoad: (files: FileList | null) => void
  className?: string
  shortcut?: string
}) {
  return isTauriHost()
    ? <button type="button" className={`fileButton ${className}`} onClick={onOpen} aria-keyshortcuts={shortcut}>{label}</button>
    : <label className={`fileButton ${className}`}>
      {label}
      <input type="file" accept={accept} aria-keyshortcuts={shortcut} onChange={event => { onLoad(event.currentTarget.files); event.currentTarget.value = '' }} />
    </label>
}
