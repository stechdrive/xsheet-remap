import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { load } from 'js-yaml'
import { inspectPagesWorkflow } from './workflow-policy.mjs'

const candidate = () => load(readFileSync('.github/workflows/pages.yml', 'utf8')) as { jobs: Record<string, { needs?: string[]; steps: { run?: string; uses?: string; if?: string; with?: Record<string, unknown> }[] }> }
describe('Pages publication gates', () => {
  it('accepts the actual workflow regardless of comments or display names', () => {
    expect(inspectPagesWorkflow(candidate())).toEqual([])
  })
  it('rejects publication without the tested candidate build', () => {
    const workflow = candidate(); workflow.jobs.deploy.needs = ['check', 'native']
    expect(inspectPagesWorkflow(workflow)).toContain('Deployment deploy must wait for build')
  })
  it('rejects rebuilding after smoke acceptance', () => {
    const workflow = candidate()
    const smoke = workflow.jobs.build.steps.findIndex(step => step.run === 'npm run verify:browser:ci')
    workflow.jobs.build.steps.splice(smoke + 1, 0, { run: 'npm run build:web' })
    expect(inspectPagesWorkflow(workflow)).toContain('Do not modify the candidate between smoke acceptance and upload')
  })
  it('requires smoke acceptance after the build and retains full gestures locally', () => {
    const workflow = candidate()
    const smoke = workflow.jobs.build.steps.findIndex(step => step.run === 'npm run verify:browser:ci')
    const [step] = workflow.jobs.build.steps.splice(smoke, 1)
    workflow.jobs.build.steps.unshift(step)
    workflow.jobs.build.steps.push({ run: 'npm run verify:browser -- --project=webkit-touch' })
    expect(inspectPagesWorkflow(workflow)).toContain('Build, smoke acceptance and Pages upload must run in that order')
    expect(inspectPagesWorkflow(workflow)).toContain('Full interaction acceptance belongs in local preflight, not the Pages CI gate')
  })
  it('does not count commented-out commands as checks', () => {
    const workflow = candidate()
    workflow.jobs.check.steps.find(step => step.run === 'npm run check')!.run = '# npm run check'
    expect(inspectPagesWorkflow(workflow)).toContain('A repository check must gate publication')
  })
  it('rejects a missing audit or an individual required check being skipped', () => {
    const workflow = candidate()
    workflow.jobs.check.steps = workflow.jobs.check.steps.filter(step => step.run !== 'npm run check:dependency-audit')
    workflow.jobs.check.steps.find(step => step.run === 'npm run check')!.if = 'false'
    workflow.jobs.build.steps.find(step => step.run === 'npm run verify:browser:ci')!.if = 'false'
    expect(inspectPagesWorkflow(workflow)).toContain('Dependency audit must gate publication')
    expect(inspectPagesWorkflow(workflow)).toContain('Required candidate checks cannot be conditionally skipped')
  })
  it('rejects floating actions and persisted credentials', () => {
    const workflow = candidate()
    workflow.jobs.check.steps[0].uses = 'actions/checkout@main'
    workflow.jobs.check.steps[0].with!['persist-credentials'] = true
    expect(inspectPagesWorkflow(workflow)).toContain('Pin action revision: actions/checkout@main')
    expect(inspectPagesWorkflow(workflow)).toContain('Checkout must use full history without persisted credentials')
  })
})
