import { CdpClient } from './cdp-client'

interface ClientPoint {
  x: number
  y: number
}

export async function assetBrowserCardPointByName(client: CdpClient, name: string): Promise<ClientPoint> {
  const point = await evaluatePage<ClientPoint | null>(client, `
    (() => {
      const cards = Array.from(document.querySelectorAll('.assetBrowserItems .assetCard'));
      const card = cards.find(item =>
        item.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(name)}
      );
      if (!card) return null;
      card.scrollIntoView({ block: 'center', inline: 'nearest' });
      const box = card.getBoundingClientRect();
      return { x: box.left + Math.min(40, box.width / 2), y: box.top + Math.min(28, box.height / 2) };
    })()
  `)
  if (!point) throw new Error(`asset browser card not found: ${name}`)
  return point
}

export async function clickStackGuideCardByLabel(client: CdpClient, label: string): Promise<void> {
  await mouseClick(client, await stackGuideCardPointByLabel(client, label))
}

export async function dragAssetBrowserCardToStackGuide(
  client: CdpClient,
  fileName: string,
  label: string,
): Promise<void> {
  const source = await assetBrowserCardPointByName(client, fileName)
  let target = source
  let mouseDown = false
  try {
    await dispatchMouse(client, 'mouseMoved', source, 'none', 0)
    await dispatchMouse(client, 'mousePressed', source, 'left', 1, 1)
    mouseDown = true
    await dispatchMouse(client, 'mouseMoved', { x: source.x - 24, y: source.y + 8 }, 'left', 1)
    await waitForCondition(
      () => evaluatePage<boolean>(client, "Boolean(document.querySelector('.cspTreeAssetDropZone.active'))"),
      10000,
      'CSP asset drop zones',
    )
    target = await stackGuideAssetDropZonePoint(client, label)
    const steps = 8
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps
      await dispatchMouse(client, 'mouseMoved', {
        x: source.x + (target.x - source.x) * ratio,
        y: source.y + (target.y - source.y) * ratio,
      }, 'left', 1)
    }
  } finally {
    if (mouseDown) await dispatchMouse(client, 'mouseReleased', target, 'left', 0, 1)
  }
}

export async function waitForStackGuideCardAsset(
  client: CdpClient,
  label: string,
  fileName: string,
): Promise<void> {
  await waitForCondition(
    () => evaluatePage<boolean>(client, `
      (() => {
        const tracks = Array.from(document.querySelectorAll('.cspTreeTrack'));
        const track = tracks.find(item => item.querySelector('.cspTreeTrackName')?.textContent?.trim() === ${JSON.stringify(label)});
        const assetState = track?.querySelector('.cspTreeAssetState');
        return assetState?.getAttribute('aria-label') === ${JSON.stringify(`素材: ${fileName}`)};
      })()
    `),
    10000,
    `stack guide card ${label} asset ${fileName}`,
  )
}

async function stackGuideCardPointByLabel(client: CdpClient, label: string): Promise<ClientPoint> {
  const point = await evaluatePage<ClientPoint | null>(client, `
    (() => {
      const tracks = Array.from(document.querySelectorAll('.cspTreeTrack'));
      const track = tracks.find(item => item.querySelector('.cspTreeTrackName')?.textContent?.trim() === ${JSON.stringify(label)});
      const card = track?.querySelector('.cspTreeCel') || track?.querySelector('.cspTreeTrackRow');
      if (!card) return null;
      card.scrollIntoView({ block: 'center', inline: 'nearest' });
      const box = card.getBoundingClientRect();
      return { x: box.left + Math.min(40, box.width / 2), y: box.top + Math.min(20, box.height / 2) };
    })()
  `)
  if (!point) throw new Error(`stack guide card not found: ${label}`)
  return point
}

async function stackGuideAssetDropZonePoint(client: CdpClient, label: string): Promise<ClientPoint> {
  const point = await evaluatePage<ClientPoint | null>(client, `
    (() => {
      const tracks = Array.from(document.querySelectorAll('.cspTreeTrack'));
      const track = tracks.find(item => item.querySelector('.cspTreeTrackName')?.textContent?.trim() === ${JSON.stringify(label)});
      const dropZone = track?.querySelector('.cspTreeAssetDropZone.active');
      if (!dropZone) return null;
      dropZone.scrollIntoView({ block: 'center', inline: 'nearest' });
      const box = dropZone.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()
  `)
  if (!point) throw new Error(`active stack guide asset drop zone not found: ${label}`)
  return point
}

async function mouseClick(client: CdpClient, point: ClientPoint): Promise<void> {
  await dispatchMouse(client, 'mouseMoved', point, 'none', 0)
  await dispatchMouse(client, 'mousePressed', point, 'left', 1, 1)
  await dispatchMouse(client, 'mouseReleased', point, 'left', 0, 1)
}

async function dispatchMouse(
  client: CdpClient,
  type: string,
  point: ClientPoint,
  button: 'none' | 'left',
  buttons: number,
  clickCount?: number,
): Promise<void> {
  await client.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button, buttons, clickCount })
}

async function evaluatePage<T>(client: CdpClient, expression: string): Promise<T> {
  const result = await client.send<{
    result: { value?: T }
    exceptionDetails?: { text: string; exception?: { description?: string; value?: string } }
  }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.exception?.value ?? result.exceptionDetails.text)
  }
  return result.result.value as T
}

async function waitForCondition<T>(condition: () => Promise<T | null | false | undefined>, timeoutMs: number, label: string): Promise<T> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const value = await condition()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for ${label}`)
}
