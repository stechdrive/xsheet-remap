import type { PaperPaintDriver } from '../paper-paint-contract'

/** A router log or synthesized HTML drop is insufficient evidence of an Explorer drop. */
export async function verifyNativeFileDrop(driver: PaperPaintDriver, paths: string[], perform: () => Promise<void>) {
  const start = await driver.evaluate<number>('(window.__xsheetDropDiagnostics || []).length')
  await perform()
  return driver.evaluate(`new Promise((resolve, reject) => {
    const normalize = path => path.split(String.fromCharCode(92)).join('/').toLowerCase();
    const expected = ${JSON.stringify(paths)}.map(normalize);
    const started = Date.now();
    const check = () => {
      const events = (window.__xsheetDropDiagnostics || []).slice(${start});
      const drop = events.find(event => event.source?.startsWith('native:') && event.type === 'drop'
        && expected.every(path => (event.paths || []).map(normalize).includes(path)));
      if (drop) { resolve(drop); return; }
      if (Date.now() - started > 8000) {
        reject(new Error('Explorer input did not deliver the expected native file drop: ' + JSON.stringify({ expected, events }))); return;
      }
      setTimeout(check, 100);
    };
    check();
  })`)
}
