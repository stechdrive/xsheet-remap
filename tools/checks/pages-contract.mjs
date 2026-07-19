import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const scripts = packageJson.scripts ?? {}
const expectedScripts = {
  'build:pages': 'npm run build:pages -w @xsheet-remap/web',
  'check:pages-artifact': 'node tools/pages/check-pages-artifact.mjs',
}
for (const [name, expected] of Object.entries(expectedScripts)) {
  if (scripts[name] !== expected) throw new Error(`Pages contract mismatch for ${name}: expected "${expected}"`)
}

const workflowPath = path.join(root, '.github', 'workflows', 'pages.yml')
const workflow = fs.readFileSync(workflowPath, 'utf8')
const requiredSnippets = [
  'persist-credentials: false',
  'npm run check',
  'npm run build:pages',
  'npm run check:pages-artifact',
  'path: apps/web/dist-pages',
  'pages: write',
  'id-token: write',
  'name: github-pages',
]
for (const snippet of requiredSnippets) {
  if (!workflow.includes(snippet)) throw new Error(`Pages workflow is missing: ${snippet}`)
}
if (/\bsecrets\s*\./.test(workflow)) throw new Error('Pages workflow must not receive repository secrets')
if (/\bpull_request(?:_target)?\s*:/.test(workflow)) throw new Error('Pages deployments must not run from pull requests')

const actionReferences = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)\s*(?:#.*)?$/gm)].map(match => match[1])
if (actionReferences.length === 0) throw new Error('Pages workflow has no pinned actions')
for (const reference of actionReferences) {
  const separator = reference.lastIndexOf('@')
  const revision = separator >= 0 ? reference.slice(separator + 1) : ''
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error(`Pages action is not pinned to a full commit SHA: ${reference}`)
}

const checkoutCount = actionReferences.filter(reference => reference.startsWith('actions/checkout@')).length
const fullHistoryCheckoutCount = [...workflow.matchAll(/^\s*fetch-depth:\s*0\s*$/gm)].length
if (checkoutCount === 0 || fullHistoryCheckoutCount !== checkoutCount) {
  throw new Error('Every Pages checkout must fetch full history so commit-count versions stay correct')
}

console.log('[pages-contract] passed')
