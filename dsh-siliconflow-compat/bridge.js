/** Harness-level Responses compatibility; the upstream wire API is Anthropic Messages. */
import { importHarness } from './harness.js'
import { normalizeEndpoint } from './index.js'

/** Only official SiliconFlow routes opt into the compatibility bridge. */
export function bridgeEndpoint(profile, provider) {
  if (profile?.api !== 'openai-responses') return undefined
  const baseURL = profile.baseURL ?? (provider === 'siliconflow' ? 'https://api.siliconflow.cn/v1' : undefined)
  const messagesURL = normalizeEndpoint('anthropic-messages', baseURL)
  if (!['https://api.siliconflow.cn', 'https://api.siliconflow.com'].includes(messagesURL)) return undefined
  return messagesURL
}

/** Install streaming middleware; all other providers delegate through the normal waterfall. */
export async function installBridge(ctx, harnessRoot) {
  const [adapterModule, configModule, authModule, llmModule, failureModule] = await Promise.all([
    importHarness('packages/llm/llm-pi-ai/src/adapter.ts', harnessRoot),
    importHarness('packages/llm/llm-pi-ai/src/config.ts', harnessRoot),
    importHarness('packages/llm/llm-pi-ai/src/auth.ts', harnessRoot),
    importHarness('packages/llm/llm/src/index.ts', harnessRoot),
    importHarness('packages/llm/llm/src/adapter-failure.ts', harnessRoot),
  ])
  const { PiAiAdapter } = adapterModule
  const { resolveProfiles } = configModule
  const { authContextFrom, credentialStoreFrom } = authModule
  const { assertUsableApiKey, LlmError } = llmModule
  const { normalizeLlmFailure } = failureModule
  ctx.on('llm/stream', async function* (options, next) {
    const settings = ctx.settings.describe().find(item => item.ns === 'llm-pi-ai')?.value
    const profile = settings?.providers?.[options.provider]
    const baseURL = bridgeEndpoint(profile, options.provider)
    if (baseURL === undefined) {
      yield* next()
      return
    }
    try {
      const ref = profile.apiKeyEnv || 'SILICONFLOW_API_KEY'
      const value = (await ctx.credentials.resolve(ref))?.value
      if (!value) throw new LlmError(`SiliconFlow bridge: missing credential ${ref}`, 'MISSING_CREDENTIAL')
      const key = assertUsableApiKey(value, 'siliconflow-compat', ref)
      const profiles = resolveProfiles({ [options.provider]: {
        ...profile,
        api: 'anthropic-messages',
        baseURL,
        headers: { Authorization: `Bearer ${key}`, ...profile.headers },
      } })
      const adapter = new PiAiAdapter({
        profiles: () => profiles,
        resolveApiKey: async () => key,
        auth: { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) },
        resolveAttachments: () => ctx.get('attachments'),
      })
      yield* adapter.stream(options)
    } catch (error) {
      const failure = normalizeLlmFailure(error)
      yield { type: 'finish', reason: { kind: options.signal?.aborted ? 'aborted' : 'error', failure } }
    }
  })
}
