export interface SoundCueNavigationRequest {
  requestId: number
  cueId: string
}

export type WorkspaceFocusOwner = 'sheet' | 'audio' | 'none'
export type WorkspaceKeyboardScope = 'sheet' | 'global-history' | 'ignore'

export function resolveWorkspaceKeyboardScope(input: {
  owner: WorkspaceFocusOwner
  defaultPrevented: boolean
  modifier: boolean
  key: string
}): WorkspaceKeyboardScope {
  if (input.defaultPrevented) return 'ignore'
  if (input.owner !== 'audio') return 'sheet'
  return input.modifier && (input.key.toLowerCase() === 'z' || input.key.toLowerCase() === 'y')
    ? 'global-history'
    : 'ignore'
}

export function handleWorkspaceKeyboardBoundary(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'key' | 'defaultPrevented' | 'preventDefault'>,
  owner: WorkspaceFocusOwner,
  history: { undo: () => void; redo: () => void },
): boolean {
  const scope = resolveWorkspaceKeyboardScope({
    owner,
    defaultPrevented: event.defaultPrevented,
    modifier: event.ctrlKey || event.metaKey,
    key: event.key,
  })
  if (scope === 'sheet') return false
  if (scope === 'global-history') {
    event.preventDefault()
    if (event.key.toLowerCase() === 'y' || event.shiftKey) history.redo()
    else history.undo()
  }
  return true
}

export type SheetViewportPointerTarget = 'background' | 'sheet-content'

export type SheetViewportPointerIntent =
  | 'begin-pan'
  | 'clear-primary-selection'
  | 'delegate'

export interface PrimaryPointerActivation {
  targetId: string
  timeStamp: number
  clientX: number
  clientY: number
}

export function primaryPointerActivation(
  targetId: string,
  timeStamp: number,
  clientX: number,
  clientY: number,
): PrimaryPointerActivation {
  return { targetId, timeStamp, clientX, clientY }
}

export function nextSoundCueNavigationRequest(
  current: SoundCueNavigationRequest | null,
  cueId: string,
): SoundCueNavigationRequest {
  return {
    requestId: (current?.requestId ?? 0) + 1,
    cueId,
  }
}

export function resolveSheetViewportPointerIntent(input: {
  pointerType: string
  button: number
  spacePanReady: boolean
  target: SheetViewportPointerTarget
}): SheetViewportPointerIntent {
  const isMiddlePan = input.pointerType === 'mouse' && input.button === 1
  const isSpacePan = input.pointerType === 'mouse' && input.button === 0 && input.spacePanReady
  if (isMiddlePan || isSpacePan) return 'begin-pan'
  if (input.button === 0 && input.target === 'background') return 'clear-primary-selection'
  return 'delegate'
}

export function sheetViewportPointerTarget(
  target: EventTarget | null,
  viewport: HTMLElement,
): SheetViewportPointerTarget {
  if (target === viewport) return 'background'
  if (target instanceof HTMLElement && target.classList.contains('sheetPageStack')) return 'background'
  return 'sheet-content'
}

export function isRepeatedPrimaryPointerActivation(
  previous: PrimaryPointerActivation | null,
  current: PrimaryPointerActivation,
  options: { maxDelayMs?: number; maxDistancePx?: number } = {},
): boolean {
  if (!previous || previous.targetId !== current.targetId) return false
  const delay = current.timeStamp - previous.timeStamp
  if (delay < 0 || delay > (options.maxDelayMs ?? 500)) return false
  return Math.hypot(current.clientX - previous.clientX, current.clientY - previous.clientY)
    <= (options.maxDistancePx ?? 4)
}

export function advancePrimaryPointerActivation(
  previous: PrimaryPointerActivation | null,
  current: PrimaryPointerActivation,
): { repeated: boolean; next: PrimaryPointerActivation | null } {
  const repeated = isRepeatedPrimaryPointerActivation(previous, current)
  return { repeated, next: repeated ? null : current }
}
