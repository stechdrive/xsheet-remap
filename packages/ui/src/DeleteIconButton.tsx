import type { ButtonHTMLAttributes } from 'react'
import { Tooltip } from './Tooltip'

export function TrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={['trashIcon', className].filter(Boolean).join(' ')} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
      <path d="M10 10v6M14 10v6" />
    </svg>
  )
}

type DeleteIconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children' | 'type'> & {
  label: string
  tooltip?: string
}

export function DeleteIconButton({ label, tooltip = label, className = '', ...buttonProps }: DeleteIconButtonProps) {
  return (
    <Tooltip label={tooltip}>
      <button
        {...buttonProps}
        type="button"
        className={['deleteIconButton', className].filter(Boolean).join(' ')}
        aria-label={label}
      >
        <TrashIcon />
      </button>
    </Tooltip>
  )
}
