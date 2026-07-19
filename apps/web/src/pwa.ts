export function registerPagesServiceWorker(): void {
  if (!('serviceWorker' in navigator)) {
    document.documentElement.dataset.pwaStatus = 'unsupported'
    return
  }
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(async registration => {
        await navigator.serviceWorker.ready
        document.documentElement.dataset.pwaStatus = 'ready'
        registration.update().catch(() => undefined)
      })
      .catch(() => {
        document.documentElement.dataset.pwaStatus = 'failed'
      })
  }, { once: true })
}
