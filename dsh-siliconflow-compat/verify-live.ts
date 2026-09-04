import { homedir } from 'node:os'
import { join } from 'node:path'
import { importHarness } from './harness.js'
const { Context } = await importHarness('vendor/cordis/src/index.ts')
const { default: LlmRuntime, createUserMessage, CallId } = await importHarness('packages/llm/llm/src/index.ts')
const { default: FileSettingsProvider } = await importHarness('packages/settings/settings-file/src/index.ts')
const { default: LocalCredentialProvider } = await importHarness('packages/credentials/credentials-local/src/index.ts')
const PiAi = await importHarness('packages/llm/llm-pi-ai/src/index.ts')
const { assemble } = await importHarness('packages/llm/llm-pi-ai/tests/assemble.ts')
import * as Compat from './index.js'
const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const model = process.env.SILICONFLOW_TEST_MODEL
if (!model) throw new Error('Set SILICONFLOW_TEST_MODEL to an available model id before running the live test')
const ctx = new Context()
try {
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(FileSettingsProvider, { path: join(home, 'settings.yaml'), watch: false })
  await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), watch: false })
  await ctx.plugin(PiAi, {})
  const profile = ctx.settings.describe().find(item => item.ns === 'llm-pi-ai')?.value as { providers?: Record<string, { api?: string }> }
  if (profile?.providers?.siliconflow?.api !== 'openai-responses') throw new Error('Select openai-responses for siliconflow before verifying the bridge')
  await ctx.plugin(Compat)
  const prompt = createUserMessage({ content: [{ type: 'text', text: 'Use lookup_code with code blue. Do not answer without calling the tool.' }], source: { kind: 'user' } })
  const tools = [{ name: 'lookup_code', description: 'Look up the word represented by a code.', parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } }]
  const base = { provider: 'siliconflow', model, maxTokens: 1024, tools, signal: AbortSignal.timeout(60000) }
  const first = await assemble(ctx, { ...base, messages: [prompt] })
  const call = first.message.content.find(x => x.type === 'tool-call')
  console.log(JSON.stringify({ firstFinish: first.finish, tool: call?.name, arguments: call?.arguments }))
  if (!call) throw new Error('Expected tool call')
  const second = await assemble(ctx, { ...base, messages: [prompt, first.message, createUserMessage({ content: [{ type: 'tool-result', toolCallId: CallId(call.id), content: [{ type: 'text', text: 'The code blue means ocean.' }] }], source: { kind: 'plugin', plugin: 'verification' } })] })
  if (second.finish.kind !== 'stop') throw new Error('Tool result round trip did not complete')
  console.log(JSON.stringify({ secondFinish: second.finish, content: second.message.content.filter(x => x.type === 'text') }))

} finally { await ctx.fiber.dispose() }
