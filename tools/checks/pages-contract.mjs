import fs from 'node:fs'
import { load } from 'js-yaml'
import { inspectPagesWorkflow } from './workflow-policy.mjs'

const errors = inspectPagesWorkflow(load(fs.readFileSync('.github/workflows/pages.yml', 'utf8')))
if (errors.length) throw new Error(errors.join('\n'))
console.log('[pages-contract] successful gates, immutable candidate and least-privilege actions verified')
