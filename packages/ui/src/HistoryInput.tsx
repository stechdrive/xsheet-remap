import { useId, type InputHTMLAttributes, type Ref } from 'react'
import { recentValuesWithPinned } from './recentValueHistory'

export function HistoryInput({
  history,
  pinned = [],
  historyLimit,
  inputRef,
  ...inputProps
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'list'> & {
  history: readonly string[]
  pinned?: readonly string[]
  historyLimit: number
  inputRef?: Ref<HTMLInputElement>
}) {
  const listId = `history-input-${useId().replace(/:/g, '')}`
  const values = recentValuesWithPinned(history, pinned, historyLimit)
  return (
    <>
      <input {...inputProps} ref={inputRef} list={listId} />
      <datalist id={listId}>
        {values.map(value => <option key={value} value={value} />)}
      </datalist>
    </>
  )
}
