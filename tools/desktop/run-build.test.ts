import { describe, expect, it } from 'vitest'
import { formatDesktopBuildPlan, parseDesktopBuildArgs } from './run-build.mjs'

describe('desktop build intent', () => {
  it('requires a concrete development target and keeps release-local untouched', () => {
    const plan = parseDesktopBuildArgs(['--mode', 'development', '--target', 'editor'])
    expect(plan.executables).toEqual(['xsheet-editor.exe'])
    expect(plan.outputRoots).toEqual(['dev-local'])
    expect(formatDesktopBuildPlan(plan)).toContain('targets=editor')
  })

  it('supports an explicit set of development targets', () => {
    const plan = parseDesktopBuildArgs(['--mode=development', '--target=editor,template'])
    expect(plan.executables).toEqual(['xsheet-editor.exe', 'xsheet-template.exe'])
  })

  it('does not widen a missing development target to all applications', () => {
    expect(() => parseDesktopBuildArgs(['--mode', 'development'])).toThrow(/explicit --target/)
  })

  it('only permits a coherent all-app release build', () => {
    expect(() => parseDesktopBuildArgs(['--mode', 'release', '--target', 'editor'])).toThrow(/--target all/)
    const plan = parseDesktopBuildArgs(['--mode', 'release', '--target', 'all'])
    expect(plan.executables).toHaveLength(4)
    expect(plan.outputRoots).toEqual(['dev-local', 'release-local'])
  })
})
