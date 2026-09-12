/** WebKit may report the final conversion key as keyCode 229 without isComposing. */
export function isCompositionKey(event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean {
  return event.isComposing || event.keyCode === 229
}
