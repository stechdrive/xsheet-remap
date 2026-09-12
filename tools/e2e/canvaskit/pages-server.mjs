import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
export async function startPagesServer({ root = path.resolve('apps/web/dist-pages'), port = 0, host = '127.0.0.1', worker = undefined } = {}) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'pages-artifact.json'), 'utf8'))
  const allowed = new Set(['pages-artifact.json', ...manifest.files.map(file => file.path)])
  const requests = []
  const prefix = '/xsheet-remap/'
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      if (!['GET', 'HEAD'].includes(request.method) || !pathname.startsWith(prefix)) { response.writeHead(404).end(); return }
      const relative = pathname.slice(prefix.length) || 'index.html'
      if (!allowed.has(relative) || relative.split('/').some(part => part === '..' || part.includes('\\'))) { response.writeHead(404).end(); return }
      requests.push(relative)
      const bytes = relative === 'sw.js' && worker ? Buffer.from(worker()) : await fs.readFile(path.join(root, relative))
      response.writeHead(200, { 'Content-Type': types[path.extname(relative)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
      response.end(request.method === 'HEAD' ? undefined : bytes)
    } catch { response.writeHead(500).end() }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve) })
  return { url: `http://${host}:${server.address().port}${prefix}`, manifest, requests,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startPagesServer({ port: 5178 })
  console.log(`[pages-test-server] ${server.url}`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0) })
}
