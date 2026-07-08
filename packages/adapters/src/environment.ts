export function isTauriHost(): boolean {
  return isTauriLikeWindow(window)
}

export function isTauriLikeWindow(input: Pick<Window, 'location'> & { __TAURI_INTERNALS__?: unknown }): boolean {
  return input.location.hostname === 'tauri.localhost' || Boolean(input.__TAURI_INTERNALS__)
}
