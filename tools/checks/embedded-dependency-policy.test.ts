import { describe, expect, it } from 'vitest'
import {
  checkEmbeddedDependencies,
  compareVersions,
  evaluatePaddleWorkerPolicy,
  readEmbeddedJsYamlVersion,
} from './embedded-dependency-policy.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const worker = (version: string) => `/*! js-yaml ${version} https://github.com/nodeca/js-yaml @license MIT */`

describe('embedded dependency policy', () => {
  it('parses and compares dependency versions', () => {
    expect(readEmbeddedJsYamlVersion(worker('4.1.1'))).toBe('4.1.1')
    expect(compareVersions('4.3.1', '4.3.1')).toBe(0)
    expect(compareVersions('4.3.2', '4.3.1')).toBeGreaterThan(0)
    expect(compareVersions('4.2.9', '4.3.1')).toBeLessThan(0)
  })

  it('accepts a fully patched dependency and worker', () => {
    expect(evaluatePaddleWorkerPolicy({
      externalVersion: '4.3.1',
      workerSource: worker('4.3.1'),
    })).toMatchObject({ status: 'patched', embeddedVersion: '4.3.1' })
  })

  it('accepts only the reviewed PaddleOCR worker exception', () => {
    expect(evaluatePaddleWorkerPolicy({
      externalVersion: '4.3.1',
      workerSource: worker('4.1.1'),
    })).toMatchObject({ status: 'fixed-model-exception', embeddedVersion: '4.1.1' })

    expect(() => evaluatePaddleWorkerPolicy({
      externalVersion: '4.3.1',
      workerSource: worker('4.2.0'),
    })).toThrow(/unreviewed vulnerable js-yaml 4\.2\.0/)
  })

  it('rejects a vulnerable resolved dependency or an unidentifiable worker', () => {
    expect(() => evaluatePaddleWorkerPolicy({
      externalVersion: '4.3.0',
      workerSource: worker('4.1.1'),
    })).toThrow(/resolved js-yaml 4\.3\.0 is vulnerable/)
    expect(() => readEmbeddedJsYamlVersion('no dependency banner')).toThrow(/does not expose/)
  })

  it('checks the emitted worker when an artifact root is supplied', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xsheet-embedded-dependency-'))
    try {
      fs.mkdirSync(path.join(root, 'node_modules', 'js-yaml'), { recursive: true })
      fs.writeFileSync(
        path.join(root, 'node_modules', 'js-yaml', 'package.json'),
        JSON.stringify({ version: '4.3.1' }),
      )
      fs.mkdirSync(path.join(root, 'build', 'assets'), { recursive: true })
      fs.writeFileSync(path.join(root, 'build', 'assets', 'worker-entry-test.js'), worker('4.1.1'))

      expect(checkEmbeddedDependencies(root, 'build')).toMatchObject({
        status: 'fixed-model-exception',
        source: path.join('build', 'assets'),
        workerFile: 'worker-entry-test.js',
      })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
