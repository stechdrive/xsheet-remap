import { isTauriHost } from './environment'

export interface NativeDropPosition {
  x: number
  y: number
}

export interface NativeDragDropPayload {
  type: 'enter' | 'over' | 'drop' | 'leave'
  paths?: string[]
  position?: NativeDropPosition
}

export type NativeDragDropSource = 'webview' | 'window' | 'event'

export interface NativeWindowBounds {
  width: number
  height: number
  x?: number
  y?: number
}

export interface NativeWindowState {
  width: number
  height: number
  maximized: boolean
}

export interface NativeWindowLayout {
  width: number
  height: number
  minWidth: number
  minHeight: number
  position?: Pick<NativeWindowBounds, 'x' | 'y'>
  physicalSize?: boolean
  center?: boolean
  maximized?: boolean
}

export async function invokeDesktopCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriHost()) throw new Error(`Desktop command is unavailable outside Tauri: ${command}`)
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

export async function nativeFileSource(path: string): Promise<string> {
  if (!isTauriHost()) return path
  const { convertFileSrc } = await import('@tauri-apps/api/core')
  return convertFileSrc(path)
}

export async function listenDesktopEvent<T>(eventName: string, handler: (payload: T) => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event')
  return listen<T>(eventName, event => handler(event.payload))
}

export async function subscribeNativeDragDrop(
  handler: (payload: NativeDragDropPayload, source: NativeDragDropSource) => void,
  sources: NativeDragDropSource[] = ['webview'],
): Promise<() => void> {
  if (!isTauriHost()) return () => undefined
  const unlisteners: Array<() => void> = []
  try {
    for (const source of sources) {
      if (source === 'webview') {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview')
        unlisteners.push(await getCurrentWebview().onDragDropEvent(event => {
          handler(normalizeNativeDragDropPayload(event.payload), source)
        }))
      } else if (source === 'window') {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        unlisteners.push(await getCurrentWindow().onDragDropEvent(event => {
          handler(normalizeNativeDragDropPayload(event.payload), source)
        }))
      } else {
        unlisteners.push(await listenDesktopEvent<unknown>('tauri://drag-drop', payload => {
          handler(normalizeNativeDragDropPayload(payload), source)
        }))
      }
    }
  } catch (error) {
    unlisteners.forEach(unlisten => unlisten())
    throw error
  }
  return () => unlisteners.forEach(unlisten => unlisten())
}

export async function configureCurrentNativeWindow(layout: NativeWindowLayout): Promise<void> {
  const { getCurrentWindow, LogicalSize, PhysicalPosition, PhysicalSize } = await import('@tauri-apps/api/window')
  const currentWindow = getCurrentWindow()
  await currentWindow.setMinSize(new LogicalSize(layout.minWidth, layout.minHeight))
  await currentWindow.setSize(layout.physicalSize
    ? new PhysicalSize(layout.width, layout.height)
    : new LogicalSize(layout.width, layout.height))
  if (typeof layout.position?.x === 'number' && typeof layout.position.y === 'number') {
    await currentWindow.setPosition(new PhysicalPosition(layout.position.x, layout.position.y))
  } else if (layout.center !== false) {
    await currentWindow.center()
  }
  if (layout.maximized) await currentWindow.maximize()
  await currentWindow.show()
}

export async function currentNativeWindowBounds(): Promise<NativeWindowBounds> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const currentWindow = getCurrentWindow()
  const [size, position] = await Promise.all([currentWindow.innerSize(), currentWindow.outerPosition()])
  return {
    width: Math.round(size.width),
    height: Math.round(size.height),
    x: Math.round(position.x),
    y: Math.round(position.y),
  }
}

export async function currentNativeWindowState(): Promise<NativeWindowState> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const currentWindow = getCurrentWindow()
  const [size, scaleFactor, maximized] = await Promise.all([
    currentWindow.innerSize(),
    currentWindow.scaleFactor(),
    currentWindow.isMaximized(),
  ])
  return {
    width: Math.round(size.width / Math.max(Number.EPSILON, scaleFactor)),
    height: Math.round(size.height / Math.max(Number.EPSILON, scaleFactor)),
    maximized,
  }
}

export async function watchCurrentNativeWindowBounds(handler: () => void): Promise<() => void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const currentWindow = getCurrentWindow()
  const unlisteners = await Promise.all([
    currentWindow.onResized(handler),
    currentWindow.onMoved(handler),
  ])
  return () => unlisteners.forEach(unlisten => unlisten())
}

export async function watchCurrentNativeWindowSize(handler: () => void): Promise<() => void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow().onResized(handler)
}

export async function closeCurrentNativeWindow(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().close()
}

function normalizeNativeDragDropPayload(value: unknown): NativeDragDropPayload {
  if (!value || typeof value !== 'object') return { type: 'leave' }
  const input = value as Record<string, unknown>
  const type = input.type === 'enter' || input.type === 'over' || input.type === 'drop' || input.type === 'leave'
    ? input.type
    : 'leave'
  const position = input.position && typeof input.position === 'object'
    ? input.position as Record<string, unknown>
    : undefined
  return {
    type,
    paths: Array.isArray(input.paths) ? input.paths.filter((path): path is string => typeof path === 'string') : undefined,
    position: typeof position?.x === 'number' && typeof position.y === 'number'
      ? { x: position.x, y: position.y }
      : undefined,
  }
}
