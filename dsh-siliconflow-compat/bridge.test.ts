import { importHarness } from './harness.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { Context } = await importHarness('vendor/cordis/src/index.ts')
const { default: LlmRuntime,  createUserMessage } = await importHarness('packages/llm/llm/src/index.ts')
const { default: FileSettings } = await importHarness('packages/settings/settings-file/src/index.ts')
const { default: Credentials } = await importHarness('packages/credentials/credentials-local/src/index.ts')
const PiAi = await importHarness('packages/llm/llm-pi-ai/src/index.ts')
const { assemble } = await importHarness('packages/llm/llm-pi-ai/tests/assemble.ts')
const { siliconflowReplies } = await importHarness('packages/llm/llm-pi-ai/tests/siliconflow-events.ts')
import * as Compat from './index.js'
import { bridgeEndpoint } from './bridge.js'

async function harness(fn: (ctx: InstanceType<typeof Context>, fiber: { dispose(): Promise<unknown> }) => Promise<void>, hasKey = true) {
  const root = await mkdtemp(join(tmpdir(), 'siliconflow-bridge-'))
  const ctx = new Context()
  try {
    await writeFile(join(root, 'settings.yaml'), '{}')
    await writeFile(join(root, 'credentials.yaml'), `version: 1\nrefs: ${hasKey ? '\n  BRIDGE_TEST_KEY: test-key' : '{}'}\n`, { mode: 0o600 })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(FileSettings, { path: join(root, 'settings.yaml'), watch: false })
    await ctx.plugin(Credentials, { path: join(root, 'credentials.yaml'), watch: false })
    await ctx.plugin(PiAi, { providers: { siliconflow: { api: 'openai-responses', baseURL: 'https://api.siliconflow.cn/v1', apiKeyEnv: 'BRIDGE_TEST_KEY', models: [{ id: 'model' }] } } })
    const fiber = ctx.plugin(Compat)
    await fiber
    await fn(ctx, fiber)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}
const request = () => ({ provider: 'siliconflow', model: 'model', messages: [createUserMessage({ content: [{ type: 'text' as const, text: 'hi' }], source: { kind: 'user' as const } })] })

test('Responses selection reaches Messages, preserves auth and restores native dispatch on unload', async () => {
  const originalFetch = globalThis.fetch
  const paths: string[] = []
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init)
    paths.push(new URL(req.url).pathname)
    assert.equal(req.headers.get('authorization'), 'Bearer test-key')
    if (req.url.endsWith('/responses')) return new Response('Not Found', { status: 404 })
    assert.equal(req.url, 'https://api.siliconflow.cn/v1/messages')
    const body = await req.json()
    assert.equal(body.messages[0].role, 'user')
    assert.ok(JSON.stringify(body.messages[0].content).includes('hi'))
    return new Response(siliconflowReplies[1].body, { headers: { 'content-type': 'text/event-stream' } })
  }
  try {
    await harness(async (ctx, fiber) => {
      const result = await assemble(ctx, request())
      assert.deepEqual(result.finish, { kind: 'stop' })
      assert.deepEqual(result.message.content, [{ type: 'text', text: 'hello' }])
      await fiber.dispose()
      const native = await assemble(ctx, request())
      assert.equal(native.finish.kind, 'error')
    })
    assert.deepEqual(paths, ['/v1/messages', '/v1/responses'])
  } finally { globalThis.fetch = originalFetch }
})

test('a missing credential remains a terminal credential failure', async () => {
  await harness(async ctx => {
    const result = await assemble(ctx, request())
    assert.equal(result.finish.kind, 'error')
    assert.equal(result.finish.failure?.code, 'MISSING_CREDENTIAL')
  }, false)
})

test('caller cancellation stays aborted', async () => {
  await harness(async ctx => {
    const result = await assemble(ctx, { ...request(), signal: AbortSignal.abort() })
    assert.equal(result.finish.kind, 'aborted')
  })
})


test('the bridge excludes other providers and private gateways', () => {
  assert.equal(bridgeEndpoint({ api: 'openai-responses' }, 'openai'), undefined)
  assert.equal(bridgeEndpoint({ api: 'openai-responses' }, 'siliconflow'), 'https://api.siliconflow.cn')
  assert.equal(bridgeEndpoint({ api: 'openai-responses', baseURL: 'https://gateway.example/v1' }, 'siliconflow'), undefined)
  assert.equal(bridgeEndpoint({ api: 'anthropic-messages', baseURL: 'https://api.siliconflow.cn' }, 'siliconflow'), undefined)
})
