import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import type { ClipLayerNode } from '@xsheet-remap/core'
import { ClipLayerIcon, clipLayerKindLabel } from './ClipLayerIcons'
import { clipBlendLabel } from './ClipLayerAppearance'
import { TooltipTarget } from './Tooltip'
import './styles/clip-layers.css'

/** Shared palette row. Selection/import/editing actions belong to its caller. */
export function ClipLayerTreeItem({ node, depth, selected, expanded, onToggle, leading, thumbnail, thumbnailLabel, onThumbnail, name, badges, children, className = '', rowProps, path }: {
  node: ClipLayerNode; depth: number; selected: boolean; expanded?: boolean; onToggle: () => void
  leading: ReactNode; thumbnail?: string; thumbnailLabel: string; onThumbnail: () => void
  name?: ReactNode; badges?: ReactNode; children?: ReactNode; className?: string
  rowProps?: HTMLAttributes<HTMLDivElement>; path: string
}) {
  const isFolder = node.kind === 'folder' || node.kind === 'animation'
  const rgb = node.labelColor?.slice(1).match(/../g)?.map(value => parseInt(value, 16))
  const labelInk = rgb && (rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 < 140) ? '#fff' : '#303633'
  return <div role="treeitem" aria-label={node.name} aria-selected={selected} aria-expanded={isFolder ? expanded : undefined} className={`clipLayerItem ${className}`} style={{ '--clip-layer-indent': `${depth * 12}px`, '--clip-label-color': node.labelColor ?? 'transparent', '--clip-label-ink': node.labelColor ? labelInk : '#303633' } as CSSProperties}>
    <div {...rowProps} className={`clipLayerRow ${selected ? 'selected' : ''}`} data-clip-layer-id={node.id} data-clip-layer-parent={isFolder ? node.id : node.parentId ?? '__root__'}>
      {leading}
      <TooltipTarget label={[node.locked ? '保護されたレイヤー' : '', node.labelColor ? `ラベルカラー ${node.labelColor}` : ''].filter(Boolean).join(' / ')}>{tooltip => <span {...tooltip} className="clipLayerLock" role={node.labelColor ? 'img' : undefined} aria-label={node.labelColor ? `${node.name}のラベルカラー ${node.labelColor}` : undefined}>{node.locked && <ClipLayerIcon kind="lock" />}</span>}</TooltipTarget>
      <span className="clipLayerIndent" />
      {isFolder ? <button className={`clipLayerDisclosure ${expanded ? 'expanded' : ''}`} type="button" aria-label={`${node.name}を${expanded ? '折りたたむ' : '展開'}`} onClick={event => { event.stopPropagation(); onToggle() }}><ClipLayerIcon kind="chevron" /></button> : <span className="clipDisclosureSpace" />}
      <TooltipTarget label={`${clipLayerKindLabel[node.kind]} · ${thumbnailLabel}`}>{tooltip => <button {...tooltip} className={`clipLayerThumbnail ${thumbnail ? 'hasImage' : ''}`} type="button" aria-label={thumbnailLabel} onClick={event => { event.stopPropagation(); onThumbnail() }}>{thumbnail ? <img src={thumbnail} alt="" draggable={false} loading="lazy" /> : <ClipLayerIcon kind={node.kind} />}</button>}</TooltipTarget>
      <div className="clipLayerCaption">
        <span className="clipLayerInfo"><span>{node.kind === 'audio' ? '音声レイヤー' : `${Math.round(node.opacity * 100)}% ${clipBlendLabel(node.blendMode)}${node.kind === 'video' ? ' · 動画' : ''}`}</span>{badges}</span>
        {name ?? <TooltipTarget label={`${path} · ${clipLayerKindLabel[node.kind]}`}>{tooltip => <span {...tooltip} className="clipLayerName">{node.name}</span>}</TooltipTarget>}
      </div>
    </div>
    {isFolder && expanded && <div role="group">{children}</div>}
  </div>
}
