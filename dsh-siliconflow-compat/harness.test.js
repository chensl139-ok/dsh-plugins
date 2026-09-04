import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { harnessRoot, importHarness } from './harness.js'

test('explicit checkout path takes precedence', () => {
  assert.equal(harnessRoot('/configured-checkout'), '/configured-checkout')
})

test('missing source reports how to configure the checkout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'missing-harness-'))
  try {
    await assert.rejects(importHarness('missing-module.ts', dir), /set DSH_HARNESS_ROOT or plugin config.harnessRoot/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
