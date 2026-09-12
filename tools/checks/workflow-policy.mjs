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
  require(checks.some(([, job]) => runs(job).includes('npm run check:dependency-audit')), 'Dependency audit must gate publication')
  const smokes = Object.entries(jobs).filter(([, job]) => phase(job, 'browser:ci'))
  require(smokes.length === 1 && smokes[0]?.[0] === buildId, 'Pages smoke must inspect the candidate in its build job')
  const buildSteps = build?.steps ?? []
  const buildIndex = buildSteps.findIndex(step => step.run === 'npm run verify:pages')
  const smokeIndex = buildSteps.findIndex(step => step.run === 'npm run verify:browser:ci')
  const uploadIndex = buildSteps.findIndex(step => step.uses?.startsWith('actions/upload-pages-artifact@'))
  require(buildIndex >= 0 && buildIndex < smokeIndex && smokeIndex < uploadIndex, 'Build, smoke acceptance and Pages upload must run in that order')
  require(!buildSteps.slice(smokeIndex + 1, uploadIndex).some(step => step.run && step.run !== 'npm run check:pages-artifact'), 'Do not modify the candidate between smoke acceptance and upload')
  require(uses(build, 'actions/upload-pages-artifact').some(step => step.with?.path === 'apps/web/dist-pages'), 'Publish the same inspected candidate directory')
  const nativeJobs = Object.entries(jobs).filter(([, job]) => phase(job, 'native') && phase(job, 'importer'))
  require(nativeJobs.length === 1, 'Native and importer checks must have an independent Windows gate')
  for (const [, job] of nativeJobs) {
    require(job['runs-on'] === 'windows-latest', 'Native checks require Windows')
    require(needs(job).includes('plan'), 'Native selection must consume the shared change plan')
    for (const name of ['native', 'importer']) {
      const step = job.steps.find(step => step.run === `npm run verify:${name}`)
      require(step?.if === `needs.plan.outputs.${name} == 'true'`, `${name} selection must use the shared plan output`)
    }
  }
  const deploys = Object.entries(jobs).filter(([, job]) => uses(job, 'actions/deploy-pages').length)
  require(deploys.length === 1, 'Use one deployment job')
  for (const [id, job] of deploys) {
    require(!job.if, 'Deployment must use the default successful-needs condition')
    for (const gate of [buildId, ...checks.map(([key]) => key), ...nativeJobs.map(([key]) => key)]) require(needs(job).includes(gate), `Deployment ${id} must wait for ${gate}`)
    require(job.permissions?.pages === 'write' && job.permissions?.['id-token'] === 'write', 'Deployment needs narrowly scoped Pages permissions')
  }
  require(workflow.permissions?.contents === 'read' && Object.keys(workflow.permissions).length === 1, 'Default permissions must be contents: read only')
  require(Object.keys(workflow.on ?? {}).every(event => ['push', 'workflow_dispatch'].includes(event)), 'Publishing is restricted to trusted push/manual events')
  require(JSON.stringify(workflow.on?.push?.branches) === '["main"]', 'Publishing push events must target main')
  require(workflow.concurrency?.['cancel-in-progress'] === true, 'Superseded deployment runs must be cancelled')
  for (const [id, job] of Object.entries(jobs)) {
    require(!runs(job).some(line => /^npm run (?:verify:browser(?:\s|$)|verify:local(?:\s|$)|e2e:canvaskit(?:\s|$))/.test(line)), 'Full interaction acceptance belongs in local preflight, not the Pages CI gate')
    require(!job['continue-on-error'], `Do not ignore a failed job: ${id}`)
    require(!(job.steps ?? []).some(step => step['continue-on-error']), `Do not ignore failed steps in ${id}`)
    if (!uses(job, 'actions/deploy-pages').length) require(!job.permissions || Object.values(job.permissions).every(value => value === 'read'), `Non-deployment job ${id} must not receive write permissions`)
    for (const step of job.steps ?? []) {
      if (/^npm run (?:check(?:$|:dependency-audit$)|verify:(?:pages$|browser:ci$))/.test(step.run ?? '')) require(!step.if, 'Required candidate checks cannot be conditionally skipped')
      if (step.uses) require(/@[0-9a-f]{40}$/.test(step.uses), `Pin action revision: ${step.uses}`)
      if (step.uses?.startsWith('actions/checkout@')) require(step.with?.['fetch-depth'] === 0 && step.with?.['persist-credentials'] === false, 'Checkout must use full history without persisted credentials')
      require(!JSON.stringify(step).match(/secrets\s*[.[\]]/), 'Pages jobs must not receive repository secrets')
    }
  }
  return errors
}
