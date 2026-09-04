import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from './index.js'

test('plugin changes only baseURL and stops writing after disposal', async () => {
  const listeners = new Map()
  const writes = []
  let dispose
  const profile = { api: 'anthropic-messages', baseURL: 'https://api.siliconflow.cn/v1', apiKeyEnv: 'KEY' }
  await apply({
    inject: () => {},
    effect: effect => { dispose = effect() },
    on: (event, fn) => listeners.set(event, fn),
    settings: {
      describe: () => [{ ns: 'llm-pi-ai', revision: 2, value: { providers: { customName: profile } } }],
      mutate: async (ns, ops, revision) => {
        writes.push({ ns, ops, revision })
        profile.baseURL = ops[0].value
      },
    },
  })
  await listeners.get('ready')()
  assert.deepEqual(writes, [{ ns: 'llm-pi-ai', revision: 2, ops: [{ op: 'set', path: ['providers', 'customName', 'baseURL'], value: 'https://api.siliconflow.cn' }] }])
  await listeners.get('settings/updated')('llm-pi-ai')
  assert.equal(writes.length, 1)
  dispose()
  profile.baseURL = 'https://api.siliconflow.cn/v1'
  await listeners.get('settings/updated')('llm-pi-ai')
  assert.equal(writes.length, 1)
})
