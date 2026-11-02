import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { load } from 'js-yaml'
import { deploymentCondition, inspectPagesWorkflow } from './workflow-policy.mjs'

const candidate = () => load(readFileSync('.github/workflows/pages.yml', 'utf8')) as { jobs: Record<string, { if?: string; needs?: string[]; steps: { run?: string; uses?: string; if?: string; with?: Record<string, unknown> }[] }> }
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
    workflow.jobs.audit.steps = workflow.jobs.audit.steps.filter(step => step.run !== 'npm run check:dependency-audit')
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
  it('rejects skipping the fixed Rust audit tool installation', () => {
    const workflow = candidate()
    workflow.jobs.audit.steps.find(step => step.run === 'npm run setup:rust-audit')!.if = 'false'
    expect(inspectPagesWorkflow(workflow)).toContain('Install the pinned Rust auditor before the dependency gate')
  })
  it.each(['check', 'audit', 'native', 'build'])('requires runtime acceptance before npm ci in %s', id => {
    const workflow = candidate()
    const steps = workflow.jobs[id].steps
    const runtime = steps.findIndex(step => step.run === 'npm run check:runtime')
    const [step] = steps.splice(runtime, 1)
    expect(inspectPagesWorkflow(workflow)).toContain(`Check the selected Node and bundled npm before installing dependencies in ${id}`)
    steps.push(step)
    expect(inspectPagesWorkflow(workflow)).toContain(`Check the selected Node and bundled npm before installing dependencies in ${id}`)
  })
  it('rejects bypassing gates at job level or skipping importer coverage', () => {
    const workflow = candidate()
    workflow.jobs.audit.if = 'false'
    workflow.jobs.native.if = 'false'
    workflow.jobs.check.steps.find(step => step.run === 'npm run verify:importer')!.if = 'false'
    workflow.jobs.deploy.if = '${{ !cancelled() }}'
    expect(inspectPagesWorkflow(workflow)).toContain('Dependency audit must gate publication')
    expect(inspectPagesWorkflow(workflow)).toContain('Native job selection must use the shared plan output')
    expect(inspectPagesWorkflow(workflow)).toContain('Required candidate checks cannot be conditionally skipped')
    expect(inspectPagesWorkflow(workflow)).toContain('Deployment must require successful gates and only allow plan-excluded native skips')
  })
  it('evaluates the actual deployment condition against failed, skipped and cancelled needs', () => {
    // This expression uses only JS-compatible operators and literals from the
    // pinned policy; evaluate that expression rather than a duplicate predicate.
    const evaluate = new Function('needs', 'cancelled', `return ${deploymentCondition.slice(3, -2)}`)
    const needs = { plan: { result: 'success', outputs: { native: 'true' } },
      check: { result: 'success' }, audit: { result: 'success' }, build: { result: 'success' }, native: { result: 'success' } }
    expect(evaluate(needs, () => false)).toBe(true)
    expect(evaluate(needs, () => true)).toBe(false)
    for (const gate of ['plan', 'check', 'audit', 'build', 'native'] as const) {
      for (const result of ['failure', 'cancelled', 'skipped']) {
        expect(evaluate({ ...needs, [gate]: { ...needs[gate], result } }, () => false)).toBe(false)
      }
    }
    needs.plan.outputs.native = 'false'
    needs.native.result = 'skipped'
    expect(evaluate(needs, () => false)).toBe(true)
    expect(evaluate(needs, () => true)).toBe(false)
    needs.plan.outputs.native = ''
    expect(evaluate(needs, () => false)).toBe(false)
  })
  it.each([
    'npm install --global npm@11.7.0',
    'npm install --global (Get-Content package.json -Raw | ConvertFrom-Json).packageManager',
    `npm install --global "$(node -p "require('./package.json').packageManager")"`,
  ])('rejects a skipped runtime check or replacing the bundled npm: %s', command => {
    const workflow = candidate()
    workflow.jobs.check.steps.find(step => step.run === 'npm run check:runtime')!.if = 'false'
    workflow.jobs.check.steps.push({ run: command })
    expect(inspectPagesWorkflow(workflow)).toContain('Check the selected Node and bundled npm before installing dependencies in check')
    expect(inspectPagesWorkflow(workflow)).toContain('Use the npm bundled with the selected Node; do not replace it in CI')
  })
})
