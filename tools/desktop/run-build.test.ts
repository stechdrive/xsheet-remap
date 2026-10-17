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
    const plan = parseDesktopBuildArgs(['--mode=development', '--target=remap,corrector'])
    expect(plan.executables).toEqual(['xsheet-remap.exe', 'xsheet-corrector.exe'])
  })

  it('does not widen a missing development target to all applications', () => {
    expect(() => parseDesktopBuildArgs(['--mode', 'development'])).toThrow(/explicit --target/)
  })

  it('rejects the retired standalone Template executable target', () => {
    expect(() => parseDesktopBuildArgs(['--mode', 'development', '--target', 'template'])).toThrow(/unknown desktop build target/)
  })

  it('only permits a coherent all-app release build', () => {
    expect(() => parseDesktopBuildArgs(['--mode', 'release', '--target', 'remap'])).toThrow(/--target all/)
    const plan = parseDesktopBuildArgs(['--mode', 'release', '--target', 'all'])
    expect(plan.executables).toEqual(['xsheet-remap.exe', 'xsheet-corrector.exe'])
    expect(plan.outputRoots).toEqual(['dev-local', 'release-local'])
  })
})
