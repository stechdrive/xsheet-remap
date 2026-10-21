import type { ReactNode } from 'react'

type AudioIcon = 'razor' | 'snap' | 'lock' | 'unlock' | 'play' | 'pause' | 'record' | 'stop' | 'start' | 'split' | 'undo' | 'redo' | 'settings'

const shapes: Record<AudioIcon, ReactNode> = {
  razor: <><path d="m4 13 9-9 7 7-9 9-7-7Z" /><path d="m8 14 6-6m-4 8 6-6M6 11l2 2m3-7 2 2m-1 10 2-2m2-4 2-2" /></>,
  snap: <><path d="M5 4v10a7 7 0 0 0 14 0V4h-5v10a2 2 0 0 1-4 0V4H5Z" /><path d="M5 9h5m4 0h5" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></>,
  unlock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0m-4 8v2" /></>,
  play: <path d="m8 4 12 8L8 20Z" fill="currentColor" stroke="none" />,
  pause: <path d="M6 4h4v16H6Zm8 0h4v16h-4Z" fill="currentColor" stroke="none" />,
  record: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11v1a6 6 0 0 0 12 0v-1m-6 7v3m-4 0h8" /></>,
  stop: <rect x="5" y="5" width="14" height="14" fill="currentColor" stroke="none" />,
  start: <><path d="M5 4v16" /><path d="m19 4-12 8 12 8Z" fill="currentColor" stroke="none" /></>,
  split: <><path d="M12 3v18M8 7H3v10h5m8-10h5v10h-5M8 10l-2 2 2 2m8-4 2 2-2 2" /></>,
  undo: <path d="M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12" />,
  redo: <path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12" />,
  settings: <path d="m14 4 3 3 4-3a6 6 0 0 1-7 8l-8 8a2 2 0 0 1-3-3l8-8a6 6 0 0 1 3-7Z" />,
}

export function DialogueAudioIcon({ name }: { name: AudioIcon }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{shapes[name]}</svg>
}
