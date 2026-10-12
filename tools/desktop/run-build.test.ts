import { describe, expect, it } from 'vitest'
import { formatDesktopBuildPlan, parseDesktopBuildArgs } from './run-build.mjs'

describe('desktop build intent', () => {
  it('requires a concrete development target and keeps release-local untouched', () => {
    const plan = parseDesktopBuildArgs(['--mode', 'development', '--target', 'remap'])
    expect(plan.executables).toEqual(['xsheet-remap.exe'])
    expect(plan.outputRoots).toEqual(['dev-local'])
    expect(formatDesktopBuildPlan(plan)).toContain('targets=remap')
  })

  it('supports an explicit set of development targets', () => {
    const plan = parseDesktopBuildArgs(['--mode=development', '--target=remap,template'])
    expect(plan.executables).toEqual(['xsheet-remap.exe', 'xsheet-template.exe'])
  })

  it('does not widen a missing development target to all applications', () => {
    expect(() => parseDesktopBuildArgs(['--mode', 'development'])).toThrow(/explicit --target/)
  })

  it('only permits a coherent all-app release build', () => {
    expect(() => parseDesktopBuildArgs(['--mode', 'release', '--target', 'remap'])).toThrow(/--target all/)
    const plan = parseDesktopBuildArgs(['--mode', 'release', '--target', 'all'])
    expect(plan.executables).toHaveLength(3)
    expect(plan.outputRoots).toEqual(['dev-local', 'release-local'])
  })
})
