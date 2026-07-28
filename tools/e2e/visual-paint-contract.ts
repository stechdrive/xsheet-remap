export interface VisualPaintContractDriver {
  evaluate<T>(expression: string): Promise<T>
  captureScreenshot(): Promise<string>
}

export interface VisualPaintContract {
  selector: string
  expectedCount: number
  label: string
  minimumChangedPixels?: number
}

interface PaintRegion {
  left: number
  top: number
  width: number
  height: number
}

export async function assertSelectorsContributePaint(
  driver: VisualPaintContractDriver,
  contract: VisualPaintContract,
): Promise<number[]> {
  const { selector, expectedCount, label, minimumChangedPixels = 3 } = contract
  const regions = await driver.evaluate<PaintRegion[]>(`
    Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map(element => {
        const rect = element.getBoundingClientRect();
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(window.innerWidth, rect.right);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        return {
          left,
          top,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top),
        };
      })
  `)
  if (regions.length !== expectedCount) {
    throw new Error(`${label} expected ${expectedCount} elements, found ${regions.length}`)
  }
  if (regions.some(region => region.width <= 0 || region.height <= 0)) {
    throw new Error(`${label} contained an empty or off-screen paint region: ${JSON.stringify(regions)}`)
  }

  const visibleScreenshot = await driver.captureScreenshot()
  let hiddenScreenshot: string
  try {
    await driver.evaluate<void>(`
      (() => {
        const style = document.createElement('style');
        style.id = 'e2e-visual-paint-mask';
        style.textContent = ${JSON.stringify(`${selector} { visibility: hidden !important; }`)};
        document.head.append(style);
      })()
    `)
    await waitForAnimationFrames(driver)
    hiddenScreenshot = await driver.captureScreenshot()
  } finally {
    await driver.evaluate<void>(`document.getElementById('e2e-visual-paint-mask')?.remove()`)
    await waitForAnimationFrames(driver)
  }

  const changedPixels = await compareScreenshotRegions(driver, visibleScreenshot, hiddenScreenshot, regions)
  if (changedPixels.some(count => count < minimumChangedPixels)) {
    throw new Error(`${label} did not contribute visible pixels in the actual EXE screenshot: ${JSON.stringify(changedPixels)}`)
  }
  return changedPixels
}

async function compareScreenshotRegions(
  driver: VisualPaintContractDriver,
  visibleScreenshot: string,
  hiddenScreenshot: string,
  regions: PaintRegion[],
): Promise<number[]> {
  return driver.evaluate<number[]>(`
    (async () => {
      const load = async source => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + source;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('2D canvas is unavailable for visual paint comparison');
        context.drawImage(image, 0, 0);
        return { image, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
      };
      const [visible, hidden] = await Promise.all([
        load(${JSON.stringify(visibleScreenshot)}),
        load(${JSON.stringify(hiddenScreenshot)}),
      ]);
      if (visible.image.naturalWidth !== hidden.image.naturalWidth || visible.image.naturalHeight !== hidden.image.naturalHeight) {
        throw new Error('visual paint comparison screenshots have different dimensions');
      }
      const scaleX = visible.image.naturalWidth / window.innerWidth;
      const scaleY = visible.image.naturalHeight / window.innerHeight;
      return ${JSON.stringify(regions)}.map(region => {
        const left = Math.max(0, Math.floor(region.left * scaleX) - 2);
        const top = Math.max(0, Math.floor(region.top * scaleY) - 2);
        const right = Math.min(visible.image.naturalWidth, Math.ceil((region.left + region.width) * scaleX) + 2);
        const bottom = Math.min(visible.image.naturalHeight, Math.ceil((region.top + region.height) * scaleY) + 2);
        let changed = 0;
        for (let y = top; y < bottom; y += 1) {
          for (let x = left; x < right; x += 1) {
            const offset = (y * visible.image.naturalWidth + x) * 4;
            const delta = Math.abs(visible.pixels[offset] - hidden.pixels[offset])
              + Math.abs(visible.pixels[offset + 1] - hidden.pixels[offset + 1])
              + Math.abs(visible.pixels[offset + 2] - hidden.pixels[offset + 2])
              + Math.abs(visible.pixels[offset + 3] - hidden.pixels[offset + 3]);
            if (delta >= 24) changed += 1;
          }
        }
        return changed;
      });
    })()
  `)
}

async function waitForAnimationFrames(driver: VisualPaintContractDriver): Promise<void> {
  await driver.evaluate<void>(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
}
