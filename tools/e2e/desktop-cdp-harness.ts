import { writeFile } from 'node:fs/promises'
import { CdpClient } from './cdp-client'

export interface ClientPoint {
  x: number
  y: number
}

interface CdpListTarget {
  id: string
  type: string
  title: string
  url: string
  webSocketDebuggerUrl?: string
}

export class DesktopCdpHarness {
  private constructor(private readonly client: CdpClient) {}

  static async connect(
    port: number,
    predicate: (target: CdpListTarget) => boolean = target => !target.url.includes('window=asset-preview'),
  ): Promise<DesktopCdpHarness> {
    const target = await waitForCondition(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json`).catch(() => null)
      if (!response?.ok) return null
      const targets = await response.json() as CdpListTarget[]
      return targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl && predicate(item)) ?? null
    }, 15_000, 'main CDP target')
    if (!target.webSocketDebuggerUrl) throw new Error('CDP target did not expose a websocket URL')
    const client = await CdpClient.connect(target.webSocketDebuggerUrl)
    await client.send('Runtime.enable')
    await client.send('Page.enable')
    await client.send('DOM.enable')
    await client.send('Input.setIgnoreInputEvents', { ignore: false })
    return new DesktopCdpHarness(client)
  }

  close(): void {
    this.client.close()
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.client.send<T>(method, params)
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send<{
      result: { value?: T }
      exceptionDetails?: { text: string; exception?: { description?: string; value?: string } }
    }>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.exception?.value ?? result.exceptionDetails.text)
    }
    return result.result.value as T
  }

  waitFor<T>(
    condition: () => T | null | false | undefined | Promise<T | null | false | undefined>,
    timeoutMs: number,
    label: string,
  ): Promise<T> {
    return waitForCondition(condition, timeoutMs, label)
  }

  async waitForPageCondition(condition: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
    const expression = `(${condition.toString()})()`
    await this.waitFor(() => this.evaluate<boolean>(expression), timeoutMs, label)
  }

  async waitForSelector(selector: string, timeoutMs = 10_000): Promise<void> {
    await this.waitFor(
      () => this.evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),
      timeoutMs,
      selector,
    )
  }

  async centerOf(selector: string): Promise<ClientPoint> {
    const point = await this.evaluate<ClientPoint | null>(`
      (() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return null;
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : null;
      })()
    `)
    if (!point) throw new Error(`visible element not found: ${selector}`)
    return point
  }

  async clickSelector(selector: string, options: { button?: 'left' | 'right'; modifiers?: number } = {}): Promise<void> {
    await this.mouseClick(await this.centerOf(selector), options)
  }

  async clickButton(label: string): Promise<void> {
    const point = await this.evaluate<ClientPoint | null>(`
      (() => {
        const label = ${JSON.stringify(label)};
        const button = Array.from(document.querySelectorAll('button'))
          .find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label);
        if (!(button instanceof HTMLButtonElement)) return null;
        button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const rect = button.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()
    `)
    if (!point) throw new Error(`button not found: ${label}`)
    await this.mouseClick(point)
  }

  async mouseClick(
    point: ClientPoint,
    options: { button?: 'left' | 'right'; modifiers?: number; clickCount?: number } = {},
  ): Promise<void> {
    const button = options.button ?? 'left'
    const modifiers = options.modifiers ?? 0
    const clickCount = options.clickCount ?? 1
    const buttonMask = button === 'left' ? 1 : 2
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0, modifiers,
    })
    for (let currentCount = 1; currentCount <= clickCount; currentCount += 1) {
      await this.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: point.x, y: point.y, button, buttons: buttonMask,
        clickCount: currentCount, modifiers,
      })
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: point.x, y: point.y, button, buttons: 0,
        clickCount: currentCount, modifiers,
      })
    }
  }

  async mouseDrag(
    start: ClientPoint,
    end: ClientPoint,
    options: { modifiers?: number; steps?: number } = {},
  ): Promise<void> {
    const modifiers = options.modifiers ?? 0
    const steps = options.steps ?? 8
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: start.x, y: start.y, button: 'none', buttons: 0, modifiers,
    })
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1, modifiers,
    })
    for (let index = 1; index <= steps; index += 1) {
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: start.x + (end.x - start.x) * index / steps,
        y: start.y + (end.y - start.y) * index / steps,
        button: 'left',
        buttons: 1,
        modifiers,
      })
    }
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1, modifiers,
    })
  }

  async keyPress(key: string, modifiers = 0): Promise<void> {
    const code = virtualKeyCode(key)
    const printable = key.length === 1 && modifiers === 0
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      text: printable ? key : undefined,
      unmodifiedText: printable ? key : undefined,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
      modifiers,
    })
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
      modifiers,
    })
  }

  keyboardShortcut(key: string, extraModifiers = 0): Promise<void> {
    return this.keyPress(key, 2 | extraModifiers)
  }

  async setFileInputFiles(selector: string, files: string[]): Promise<void> {
    const document = await this.send<{ root: { nodeId: number } }>('DOM.getDocument', {})
    const target = await this.send<{ nodeId: number }>('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector,
    })
    if (!target.nodeId) throw new Error(`file input not found: ${selector}`)
    await this.send('DOM.setFileInputFiles', { nodeId: target.nodeId, files })
    await this.evaluate<void>(`
      (() => {
        const input = document.querySelector(${JSON.stringify(selector)});
        if (!(input instanceof HTMLInputElement)) throw new Error('file input disappeared');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `)
  }

  async setFormFieldValue(selector: string, value: string): Promise<void> {
    await this.evaluate<void>(`
      (() => {
        const field = document.querySelector(${JSON.stringify(selector)});
        const supported = field instanceof HTMLInputElement
          || field instanceof HTMLTextAreaElement
          || field instanceof HTMLSelectElement;
        if (!supported) throw new Error('form field not found: ${selector}');
        const prototype = field instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : field instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (!setter) throw new Error('native value setter not found: ${selector}');
        setter.call(field, ${JSON.stringify(value)});
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `)
  }

  async captureScreenshot(path: string): Promise<void> {
    const result = await this.send<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    })
    await writeFile(path, Buffer.from(result.data, 'base64'))
  }

  async debugSnapshot(): Promise<Record<string, unknown>> {
    return this.evaluate<Record<string, unknown>>(`
      (() => ({
        readyState: document.readyState,
        bodyText: document.body.textContent?.replace(/\\s+/g, ' ').slice(0, 1000),
        audioRoot: (() => {
          const root = document.querySelector('.dialogueAudioTimeline');
          return root ? { ...root.dataset, className: root.className } : null;
        })(),
        clips: Array.from(document.querySelectorAll('.dialogueAudioClipHandle')).map(item => {
          const rect = item.getBoundingClientRect()
          const centerX = rect.left + rect.width / 2
          const centerY = rect.top + rect.height / 2
          const hit = document.elementFromPoint(centerX, centerY)
          return {
            ...item.dataset,
            className: item.className,
            rect: {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            },
            centerHit: hit instanceof Element
              ? {
                  tagName: hit.tagName,
                  className: hit.getAttribute('class'),
                  clipId: hit.getAttribute('data-clip-id'),
                }
              : null,
          }
        }),
        segments: Array.from(document.querySelectorAll('.dialogueSpeechSegment')).map(item => ({ ...item.dataset, label: item.getAttribute('aria-label'), className: item.className })),
        soundCues: Array.from(document.querySelectorAll('.soundCue')).map(item => ({ ...item.dataset, label: item.getAttribute('aria-label'), className: item.getAttribute('class') })),
      }))()
    `)
  }
}

export async function waitForCondition<T>(
  condition: () => T | null | false | undefined | Promise<T | null | false | undefined>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const start = Date.now()
  let lastValue: T | null | false | undefined
  while (Date.now() - start < timeoutMs) {
    lastValue = await condition()
    if (lastValue) return lastValue
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for ${label}; last=${String(lastValue)}`)
}

function virtualKeyCode(key: string): number {
  if (key.length === 1) return key.toUpperCase().charCodeAt(0)
  return {
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Delete: 46,
    Enter: 13,
    Escape: 27,
    Home: 36,
    End: 35,
  }[key] ?? 0
}
