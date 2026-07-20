interface ClientPoint {
  x: number
  y: number
}

interface SharedUiControlsDriver {
  checks: string[]
  clickActionMenuSummary: (ariaLabel: string) => Promise<void>
  ensureSharedCutMenuOpen: () => Promise<void>
  evaluatePage: <T>(expression: string) => Promise<T>
  mouseClick: (point: ClientPoint) => Promise<void>
  viewportOutsideMenusPoint: () => Promise<ClientPoint>
  waitForNoActionMenu: (label: string) => Promise<void>
  waitForPageCondition: (condition: () => boolean, label?: string) => Promise<void>
}

export async function verifyTopMenuBehaviorScenario(driver: SharedUiControlsDriver): Promise<void> {
  await driver.clickActionMenuSummary('画面切替')
  await driver.waitForPageCondition(() => {
    const rootMenu = document.querySelector<HTMLElement>('.actionMenuPortalContent.appNavMenu')
    if (!rootMenu) return false
    const rootRect = rootMenu.getBoundingClientRect()
    return rootRect.width > 0
      && rootRect.height > 0
      && rootRect.left >= 0
      && rootRect.top >= 0
      && rootRect.right <= window.innerWidth
      && rootRect.bottom <= window.innerHeight
      && document.querySelectorAll('.appTooltip').length === 0
  }, 'hamburger menu visible without tooltip overlap')

  const fileTriggerPoint = await driver.evaluatePage<ClientPoint | null>(`
    (() => {
      const trigger = document.querySelector('.appNavFlyoutTrigger');
      if (!trigger) return null;
      const box = trigger.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()
  `)
  if (!fileTriggerPoint) throw new Error('file flyout trigger not found')
  await driver.mouseClick(fileTriggerPoint)

  await driver.waitForPageCondition(() => {
    const rootMenu = document.querySelector<HTMLElement>('.actionMenuPortalContent.appNavMenu')
    const fileTrigger = document.querySelector<HTMLElement>('.appNavFlyoutTrigger')
    const fileMenu = document.querySelector<HTMLElement>('.appNavFlyoutMenu')
    if (!rootMenu || !fileTrigger || !fileMenu) return false
    const rootRect = rootMenu.getBoundingClientRect()
    const triggerRect = fileTrigger.getBoundingClientRect()
    const fileRect = fileMenu.getBoundingClientRect()
    const items = Array.from(fileMenu.querySelectorAll<HTMLElement>('.appNavMenuItem'))
    const topElement = document.elementFromPoint(fileRect.left + 8, fileRect.top + 8)
    return fileRect.width > 0
      && fileRect.height > 0
      && fileRect.left >= triggerRect.right
      && fileRect.right <= window.innerWidth
      && fileRect.top >= 0
      && fileRect.bottom <= window.innerHeight
      && fileRect.left > rootRect.left
      && items.length > 0
      && items.every(item => item.scrollWidth <= item.clientWidth && window.getComputedStyle(item).whiteSpace === 'nowrap')
      && Boolean(topElement?.closest('.appNavFlyoutMenu'))
      && document.querySelectorAll('.appTooltip').length === 0
  }, 'hamburger file flyout appears to the side above other content')

  await driver.evaluatePage<void>(`
    (() => {
      const trigger = Array.from(document.querySelectorAll('.appNavFlyoutTrigger'))
        .find(item => item.textContent?.trim() === '書き出し');
      if (!(trigger instanceof HTMLElement)) throw new Error('export flyout trigger not found');
      trigger.focus();
    })()
  `)
  await driver.waitForPageCondition(() => {
    const menu = document.querySelector<HTMLElement>('.appNavExportFlyoutMenu')
    if (!menu) return false
    const rect = menu.getBoundingClientRect()
    const items = Array.from(menu.querySelectorAll<HTMLElement>('.appNavMenuItem'))
    return rect.width > 0
      && rect.right <= window.innerWidth
      && items.some(item => item.textContent?.includes('シートテンプレート（JSON）を書き出す'))
      && items.every(item => item.scrollWidth <= item.clientWidth && window.getComputedStyle(item).whiteSpace === 'nowrap')
  }, 'hamburger export commands remain fully visible on one line')

  await driver.mouseClick(await driver.viewportOutsideMenusPoint())
  await driver.waitForNoActionMenu('hamburger menu closes from outside click')
  await driver.clickActionMenuSummary('表示レイヤー')
  await driver.waitForPageCondition(() => {
    const menu = document.querySelector<HTMLElement>('.actionMenuPortalContent.topViewModeMenu')
    const list = menu?.querySelector<HTMLElement>('.viewModeMenuList')
    const buttons = Array.from(list?.querySelectorAll('button') ?? [])
    if (!menu || !list || buttons.length !== 3) return false
    const menuRect = menu.getBoundingClientRect()
    return menuRect.width > 0
      && menuRect.height > 0
      && menuRect.left >= 0
      && menuRect.top >= 0
      && menuRect.right <= window.innerWidth
      && menuRect.bottom <= window.innerHeight
      && window.getComputedStyle(list).display === 'grid'
      && buttons.every(button => window.getComputedStyle(button).whiteSpace === 'nowrap')
      && document.querySelectorAll('.appTooltip').length === 0
  }, 'view mode menu is vertical and visible without tooltip overlap')
  await driver.mouseClick(await driver.viewportOutsideMenusPoint())
  await driver.waitForNoActionMenu('view mode menu closes from outside click')
  driver.checks.push('verified top menus close from outside clicks and render fully visible single-line flyouts above the sheet')
}

export async function verifySharedCutMenuControlsScenario(driver: SharedUiControlsDriver): Promise<void> {
  await driver.ensureSharedCutMenuOpen()
  const addPoint = await driver.evaluatePage<ClientPoint | null>(`
    (() => {
      const menu = document.querySelector('.cutSwitchMenu.actionMenuPortalContent');
      const select = menu?.querySelector('select[aria-label="兼用カット"]');
      const add = menu?.querySelector('.cutSwitchAddButton');
      const remove = menu?.querySelector('.cutSwitchDeleteButton');
      if (!(select instanceof HTMLSelectElement)
        || !(add instanceof HTMLButtonElement)
        || !(remove instanceof HTMLButtonElement)
        || !add.classList.contains('cutSwitchIconButton')
        || !remove.classList.contains('cutSwitchIconButton')
        || add.textContent?.trim()
        || remove.textContent?.trim()
        || document.querySelector('.processPaletteGroup, .cutSwitchControl')) return null;
      const box = add.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()
  `)
  if (!addPoint) throw new Error('shared cut icon controls not found')
  await driver.mouseClick(addPoint)
  await driver.waitForPageCondition(() => {
    const input = document.querySelector<HTMLInputElement>('.cutSwitchAddForm input[aria-label="追加する兼用カット名"]')
    const confirm = document.querySelector<HTMLButtonElement>('.cutSwitchAddConfirmButton')
    const cancel = document.querySelector<HTMLButtonElement>('.cutSwitchAddCancelButton')
    return input?.value === '002'
      && !input.hasAttribute('maxlength')
      && Boolean(confirm?.classList.contains('cutSwitchIconButton'))
      && Boolean(cancel?.classList.contains('cutSwitchIconButton'))
  }, 'shared cut add action opens an unrestricted name editor with confirm and cancel icons')
  const cancelPoint = await driver.evaluatePage<ClientPoint | null>(`
    (() => {
      const button = document.querySelector('.cutSwitchAddCancelButton');
      if (!button) return null;
      const box = button.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()
  `)
  if (!cancelPoint) throw new Error('shared cut add cancel button not found')
  await driver.mouseClick(cancelPoint)
  await driver.waitForPageCondition(
    () => !document.querySelector('.cutSwitchAddForm'),
    'shared cut add editor cancels without creating a cut',
  )
  const checkboxPoint = await driver.evaluatePage<ClientPoint | null>(`
    (() => {
      const menu = document.querySelector('.cutSwitchMenu.actionMenuPortalContent');
      const select = menu?.querySelector('select[aria-label="兼用カット"]');
      const add = menu?.querySelector('.cutSwitchAddButton');
      const remove = menu?.querySelector('.cutSwitchDeleteButton');
      const checkbox = menu?.querySelector('input[aria-label="兼用カット名"]');
      if (!(select instanceof HTMLSelectElement)
        || !(add instanceof HTMLButtonElement)
        || !(remove instanceof HTMLButtonElement)
        || !(checkbox instanceof HTMLInputElement)) return null;
      const box = checkbox.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()
  `)
  if (!checkboxPoint) throw new Error('consolidated shared cut menu controls not found')
  await driver.mouseClick(checkboxPoint)
  await driver.waitForPageCondition(
    () => !document.querySelector<HTMLInputElement>('.cutSwitchMenu.actionMenuPortalContent input[aria-label="兼用カット名"]')?.checked,
    'shared cut name display disabled from the menu',
  )
  await driver.mouseClick(checkboxPoint)
  await driver.waitForPageCondition(
    () => Boolean(document.querySelector<HTMLInputElement>('.cutSwitchMenu.actionMenuPortalContent input[aria-label="兼用カット名"]')?.checked),
    'shared cut name display restored from the menu',
  )
  await driver.mouseClick(await driver.viewportOutsideMenusPoint())
  await driver.waitForNoActionMenu('shared cut menu closes before sheet interaction')
  driver.checks.push('verified shared-cut icon controls, arbitrary-name editor, cancel action, and name display toggle in one persistent menu')
}
