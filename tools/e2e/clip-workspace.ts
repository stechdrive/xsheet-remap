import { expect, type Page } from '@playwright/test'

/** Current Remap UI only. Missing controls are a failure, not a reason to enter the former Editor UI. */
export async function enterClipAssembly(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'CLIP組み立て', exact: true }).click()
  await expect(page.locator('.clipLayerPanel')).toBeVisible()
}

export function clipLayerNamed(page: Page, name: string) {
  return page.locator('.clipLayerRow').filter({ has: page.locator('.clipLayerName', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) })
}
