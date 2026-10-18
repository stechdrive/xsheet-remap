import type { ClipLayerNode } from '@xsheet-remap/core'

export const clipLayerKindLabel: Record<ClipLayerNode['kind'], string> = { folder: 'レイヤーフォルダー', animation: 'アニメーションフォルダー', raster: 'ラスターレイヤー', other: 'その他のレイヤー（元のCLIPを保持）' }
type Icon = ClipLayerNode['kind'] | 'eye' | 'trash' | 'image' | 'chevron' | 'lock' | 'search'

/** Independently drawn palette symbols; no CSP image assets are shipped. */
export function ClipLayerIcon({ kind, add = false }: { kind: Icon; add?: boolean }) {
  return <svg className="clipLayerIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {(kind === 'folder' || kind === 'animation') && <><path d="M3 6V4h7l2 2h9v14H3Z" /><path d="M3 9h18" />{kind === 'animation' && <><rect x="6" y="11" width="12" height="6" /><path d="M9 11v6m6-6v6" /></>}</>}
    {kind === 'raster' && <><path d="M5 3h10l4 4v14H5Z" /><path d="M15 3v5h4" /></>}
    {kind === 'other' && <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="m12 7 5 5-5 5-5-5Z" /></>}
    {kind === 'eye' && <><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></>}
    {kind === 'trash' && <><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" /></>}
    {kind === 'image' && <><rect x="3" y="4" width="18" height="16" rx="1" /><circle cx="8" cy="9" r="1.5" /><path d="m4 18 6-6 4 4 3-3 4 5" /></>}
    {kind === 'chevron' && <path d="m9 5 7 7-7 7" />}
    {kind === 'lock' && <><rect x="6" y="10" width="12" height="10" rx="1" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></>}
    {kind === 'search' && <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>}
    {add && <><circle cx="18" cy="18" r="5" fill="var(--clip-palette-bg, #eee)" /><path d="M18 15v6m-3-3h6" /></>}
  </svg>
}
