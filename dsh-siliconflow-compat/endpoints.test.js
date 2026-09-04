import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEndpoint } from './index.js'

test('official endpoints work across protocols, regions, trailing slashes and pasted operation URLs', () => {
  for (const host of ['api.siliconflow.cn', 'api.siliconflow.com']) {
    for (const suffix of ['', '/', '/v1', '/v1/', '/v1/messages', '/v1/responses', '/v1/chat/completions']) {
      assert.equal(normalizeEndpoint('anthropic-messages', `https://${host}${suffix}`), `https://${host}`)
      for (const api of ['openai-completions', 'openai-responses']) {
        assert.equal(normalizeEndpoint(api, `https://${host}${suffix}`), `https://${host}/v1`)
      }
    }
  }
})

test('private paths, nonofficial hosts, query parameters and unknown protocols remain explicit', () => {
  for (const value of [undefined, '', 'invalid', 'https://proxy.example/v1', 'https://api.siliconflow.cn/proxy/v1', 'https://api.siliconflow.cn/v1?tenant=x', 'https://api.siliconflow.cn:8443/v1']) {
    assert.equal(normalizeEndpoint('anthropic-messages', value), value)
  }
  assert.equal(normalizeEndpoint('unknown', 'https://api.siliconflow.cn/v1'), 'https://api.siliconflow.cn/v1')
})
