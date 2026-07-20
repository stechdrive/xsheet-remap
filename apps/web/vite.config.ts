import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const isPages = mode === 'pages'
  return {
    plugins: [
      react(),
      ...(isPages ? [pagesDisableOcrPlugin(), pagesPublicAssetsPlugin(), pagesHtmlSecurityPlugin()] : []),
    ],
    base: './',
    publicDir: isPages ? false : 'public',
    build: {
      outDir: isPages ? 'dist-pages' : 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          entryFileNames: isPages ? 'assets/[name]-[hash].js' : 'assets/[name].js',
          chunkFileNames: isPages ? 'assets/[name]-[hash].js' : 'assets/[name].js',
          assetFileNames: isPages ? 'assets/[name]-[hash][extname]' : 'assets/[name][extname]',
        },
      },
    },
    server: {
      port: 5173,
      strictPort: false,
    },
  }
})

function pagesPublicAssetsPlugin() {
  const assets = [
    ['icons/icon.svg', path.join(webRoot, 'public/icons/icon.svg')],
    ['icons/icon-192.png', path.join(webRoot, 'public/icons/icon-192.png')],
    ['icons/icon-512.png', path.join(webRoot, 'public/icons/icon-512.png')],
    ['templates/standard-a3/timesheet.png', path.join(webRoot, 'public/templates/standard-a3/timesheet.png')],
    ['vad/models/silero_vad.onnx', path.join(webRoot, 'public/vad/models/silero_vad.onnx')],
    ['manifest.webmanifest', path.join(webRoot, 'pages/manifest.webmanifest')],
  ] as const
  return {
    name: 'xsheet-pages-public-assets',
    apply: 'build' as const,
    buildStart(this: { emitFile(file: { type: 'asset'; fileName: string; source: Uint8Array }): void }) {
      for (const [fileName, sourcePath] of assets) {
        this.emitFile({ type: 'asset', fileName, source: fs.readFileSync(sourcePath) })
      }
    },
  }
}

function pagesDisableOcrPlugin() {
  const disabledModule = path.resolve(webRoot, '../../packages/ui/src/sheetRecognition.pages.ts')
  return {
    name: 'xsheet-pages-disable-ocr',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined) {
      if (source === './sheetRecognition' && importer?.replace(/\\/g, '/').endsWith('/packages/ui/src/runtimeFeatures.ts')) {
        return disabledModule
      }
      return null
    },
  }
}

function pagesHtmlSecurityPlugin() {
  return {
    name: 'xsheet-pages-html-security',
    apply: 'build' as const,
    transformIndexHtml: {
      order: 'pre' as const,
      handler() {
        return [
          { tag: 'meta', attrs: { name: 'description', content: 'ブラウザで動作するデジタルタイムシート' }, injectTo: 'head' as const },
          { tag: 'meta', attrs: { name: 'theme-color', content: '#214854' }, injectTo: 'head' as const },
          { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head' as const },
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; manifest-src 'self'",
            },
            injectTo: 'head' as const,
          },
          { tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' }, injectTo: 'head' as const },
          { tag: 'link', attrs: { rel: 'icon', href: './icons/icon.svg', type: 'image/svg+xml' }, injectTo: 'head' as const },
        ]
      },
    },
  }
}
