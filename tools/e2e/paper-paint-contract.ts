export interface PaperPaintDriver { evaluate<T>(expression: string): Promise<T> }

/** Wait for submitted Skia frames, including async font/image loads, rather than DOM presence. */
export function waitForPaperPaint(driver: PaperPaintDriver, requirePaper = true, timeoutMs = 30_000): Promise<unknown> {
  return driver.evaluate(`new Promise((resolve, reject) => {
    let frame, previous = '', stable = 0, last = [];
    const finish = (error) => { clearTimeout(timer); cancelAnimationFrame(frame); error ? reject(error) : resolve(last); };
    const timer = setTimeout(() => finish(new Error('CanvasKit paint did not settle: ' + JSON.stringify(last))), ${timeoutMs});
    const visible = source => {
      let b = source.getBoundingClientRect();
      let left = Math.max(0, b.left), top = Math.max(0, b.top), right = Math.min(innerWidth, b.right), bottom = Math.min(innerHeight, b.bottom);
      for (let parent = source; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (parent === source) continue;
        b = parent.getBoundingClientRect();
        if (/auto|scroll|hidden|clip/.test(style.overflowX)) { left = Math.max(left, b.left); right = Math.min(right, b.right); }
        if (/auto|scroll|hidden|clip/.test(style.overflowY)) { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
      }
      return right > left && bottom > top;
    };
    const check = () => {
      const sources = Array.from(document.querySelectorAll('.sheetSvg, .templatePreviewSvg, .paperTimelineMoveSnapshotSvg, .templateInteractionSvg, .templateHandleSvg, .hoverCellSvg')).filter(visible);
      last = sources.map(source => {
        const canvas = source.nextElementSibling;
        return { source: source.classList.value, state: source.dataset.canvaskitState, builds: source.dataset.canvaskitSceneBuilds,
          ready: source.dataset.canvaskitReady, draws: canvas?.dataset?.canvasKitDraws,
          backing: canvas instanceof HTMLCanvasElement && !canvas.hidden ? canvas.width * canvas.height : 0 };
      });
      if (last.some(item => item.state === 'fallback' || item.state === 'context-lost')) {
        finish(new Error('CanvasKit is unavailable during the operation: ' + JSON.stringify(last))); return;
      }
      const ready = (!${requirePaper} || sources.length > 0) && last.every(item => item.state === 'active' && item.ready === 'true' && item.backing > 1);
      const signature = JSON.stringify(last);
      stable = ready && signature === previous ? stable + 1 : 0;
      previous = signature;
      if (stable >= 2) { finish(); return; }
      frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
  })`)
}
