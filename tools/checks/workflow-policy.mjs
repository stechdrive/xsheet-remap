export const deploymentCondition = `\${{ !cancelled() &&
  needs.plan.result == 'success' &&
  needs.check.result == 'success' &&
  needs.audit.result == 'success' &&
  needs.build.result == 'success' &&
  ((needs.plan.outputs.native == 'true' && needs.native.result == 'success') ||
   (needs.plan.outputs.native == 'false' && needs.native.result == 'skipped')) }}`
const normalize = value => String(value).replace(/\s+/g, ' ').trim()

// Inspect parsed YAML and execution edges, never comments or display names.
export function inspectPagesWorkflow(workflow) {
  const errors = []
  const require = (condition, message) => { if (!condition) errors.push(message) }
  const jobs = workflow.jobs ?? {}
  const needs = job => [job?.needs ?? []].flat()
  const runs = job => (job?.steps ?? []).flatMap(step => typeof step.run === 'string' ? step.run.split(/\r?\n/).map(line => line.trim()) : [])
  const phase = (job, name) => runs(job).includes(`npm run ${name === 'check' ? 'check' : `verify:${name}`}`)
  const uses = (job, action) => (job?.steps ?? []).filter(step => step.uses?.startsWith(`${action}@`))
  const origins = Object.entries(jobs).filter(([, job]) => phase(job, 'pages'))
  require(origins.length === 1, 'Build the Pages candidate in exactly one job')
  const [buildId, build] = origins[0] ?? []
  const checks = Object.entries(jobs).filter(([, job]) => phase(job, 'check'))
  require(checks.length > 0, 'A repository check must gate publication')
  const audits = Object.entries(jobs).filter(([, job]) => runs(job).includes('npm run check:dependency-audit'))
  require(audits.length === 1 && audits[0][0] === 'audit' && !audits[0][1].if, 'Dependency audit must gate publication')
  require(checks.length === 1 && checks[0][0] === 'check' && !checks[0][1].if, 'Repository checks must run unconditionally')
  for (const [, job] of audits) {
    const setup = job.steps.findIndex(step => step.run === 'npm run setup:rust-audit' && !step.if)
    const audit = job.steps.findIndex(step => step.run === 'npm run check:dependency-audit')
    require(setup >= 0 && audit > setup, 'Install the pinned Rust auditor before the dependency gate')
  }
  const smokes = Object.entries(jobs).filter(([, job]) => phase(job, 'browser:ci'))
  require(smokes.length === 1 && smokes[0]?.[0] === buildId, 'Pages smoke must inspect the candidate in its build job')
  const buildSteps = build?.steps ?? []
  const buildIndex = buildSteps.findIndex(step => step.run === 'npm run verify:pages')
  const smokeIndex = buildSteps.findIndex(step => step.run === 'npm run verify:browser:ci')
  const uploadIndex = buildSteps.findIndex(step => step.uses?.startsWith('actions/upload-pages-artifact@'))
  require(buildIndex >= 0 && buildIndex < smokeIndex && smokeIndex < uploadIndex, 'Build, smoke acceptance and Pages upload must run in that order')
  require(!buildSteps.slice(smokeIndex + 1, uploadIndex).some(step => step.run && step.run !== 'npm run check:pages-artifact'), 'Do not modify the candidate between smoke acceptance and upload')
  require(uses(build, 'actions/upload-pages-artifact').some(step => step.with?.path === 'apps/web/dist-pages'), 'Publish the same inspected candidate directory')
  const importerJobs = Object.entries(jobs).filter(([, job]) => phase(job, 'importer'))
  require(importerJobs.length === 1 && importerJobs[0][0] === 'check', 'Importer coverage must be verified in the full-check job')
  const nativeJobs = Object.entries(jobs).filter(([, job]) => phase(job, 'native'))
  require(nativeJobs.length === 1 && nativeJobs[0][0] === 'native', 'Native checks must have an independent Windows gate')
  for (const [, job] of nativeJobs) {
    require(job['runs-on'] === 'windows-latest', 'Native checks require Windows')
    require(needs(job).includes('plan'), 'Native selection must consume the shared change plan')
    require(job.if === "needs.plan.outputs.native == 'true'", 'Native job selection must use the shared plan output')
    require(!job.steps.find(step => step.run === 'npm run verify:native')?.if, 'Selected native checks cannot be skipped')
  }
  const deploys = Object.entries(jobs).filter(([, job]) => uses(job, 'actions/deploy-pages').length)
  require(deploys.length === 1, 'Use one deployment job')
  for (const [id, job] of deploys) {
    require(normalize(job.if) === normalize(deploymentCondition), 'Deployment must require successful gates and only allow plan-excluded native skips')
    for (const gate of ['plan', buildId, ...checks.map(([key]) => key), ...audits.map(([key]) => key), ...nativeJobs.map(([key]) => key)]) require(needs(job).includes(gate), `Deployment ${id} must wait for ${gate}`)
    require(job.permissions?.pages === 'write' && job.permissions?.['id-token'] === 'write', 'Deployment needs narrowly scoped Pages permissions')
  }
  require(workflow.permissions?.contents === 'read' && Object.keys(workflow.permissions).length === 1, 'Default permissions must be contents: read only')
  require(Object.keys(workflow.on ?? {}).every(event => ['push', 'workflow_dispatch'].includes(event)), 'Publishing is restricted to trusted push/manual events')
  require(JSON.stringify(workflow.on?.push?.branches) === '["main"]', 'Publishing push events must target main')
  require(workflow.concurrency?.['cancel-in-progress'] === true, 'Superseded deployment runs must be cancelled')
  for (const [id, job] of Object.entries(jobs)) {
    const installIndex = (job.steps ?? []).findIndex(step => step.run === 'npm ci')
    if (installIndex >= 0) {
      const runtimeIndex = job.steps.findIndex(step => step.run === 'npm run check:runtime' && !step.if)
      const setupIndex = job.steps.findIndex(step => step.uses?.startsWith('actions/setup-node@') && !step.if)
      require(setupIndex >= 0 && runtimeIndex > setupIndex && runtimeIndex < installIndex, `Check the selected Node and bundled npm before installing dependencies in ${id}`)
    }
    require(!runs(job).some(line => /^npm (?:install|i)\s+(?:-g|--global)(?:\s|$)/.test(line)), 'Use the npm bundled with the selected Node; do not replace it in CI')
    require(!runs(job).some(line => /^npm run (?:verify:browser(?:\s|$)|verify:local(?:\s|$)|e2e:canvaskit(?:\s|$))/.test(line)), 'Full interaction acceptance belongs in local preflight, not the Pages CI gate')
    require(!job['continue-on-error'], `Do not ignore a failed job: ${id}`)
    require(!(job.steps ?? []).some(step => step['continue-on-error']), `Do not ignore failed steps in ${id}`)
    if (!uses(job, 'actions/deploy-pages').length) require(!job.permissions || Object.values(job.permissions).every(value => value === 'read'), `Non-deployment job ${id} must not receive write permissions`)
    for (const step of job.steps ?? []) {
      if (/^npm run (?:check(?:$|:dependency-audit$)|verify:(?:pages$|browser:ci$|importer$))/.test(step.run ?? '')) require(!step.if, 'Required candidate checks cannot be conditionally skipped')
      if (step.uses) require(/@[0-9a-f]{40}$/.test(step.uses), `Pin action revision: ${step.uses}`)
      if (step.uses?.startsWith('actions/checkout@')) require(step.with?.['fetch-depth'] === 0 && step.with?.['persist-credentials'] === false, 'Checkout must use full history without persisted credentials')
      require(!JSON.stringify(step).match(/secrets\s*[.[\]]/), 'Pages jobs must not receive repository secrets')
    }
  }
  return errors
}
