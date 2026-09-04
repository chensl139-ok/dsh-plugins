/** SiliconFlow endpoint compatibility for the Harness settings service. */
export const name = 'siliconflow-compat'
export const inject = ['settings', 'llm', 'credentials']

/** Normalize only official SiliconFlow API addresses; private gateways remain explicit. */
export function normalizeEndpoint(api, baseURL) {
  if (typeof baseURL !== 'string') return baseURL
  let url
  try { url = new URL(baseURL) } catch { return baseURL }
  if (url.protocol !== 'https:' || !['api.siliconflow.cn', 'api.siliconflow.com'].includes(url.hostname)
    || url.port || url.username || url.password || url.search || url.hash) return baseURL
  const path = url.pathname.replace(/\/+$/, '')
  if (!['', '/v1', '/v1/messages', '/v1/responses', '/v1/chat/completions'].includes(path)) return baseURL
  if (api === 'anthropic-messages') return url.origin
  if (api === 'openai-responses' || api === 'openai-completions') return `${url.origin}/v1`
  return baseURL
}

/** Keep saved official endpoints aligned with their configured protocols. */
export async function apply(ctx, config = {}) {
  const { installBridge } = await import('./bridge.js')
  await installBridge(ctx, config.harnessRoot)
  const ns = 'llm-pi-ai'
  let disposed = false
  ctx.effect(() => () => { disposed = true })
  const sync = async () => {
    if (disposed) return
    const descriptor = ctx.settings.describe().find(item => item.ns === ns)
    if (!descriptor) return
    const ops = []
    for (const [route, profile] of Object.entries(descriptor.value.providers ?? {})) {
      const baseURL = normalizeEndpoint(profile.api, profile.baseURL)
      if (baseURL !== profile.baseURL) ops.push({ op: 'set', path: ['providers', route, 'baseURL'], value: baseURL })
    }
    if (!ops.length) return
    try {
      await ctx.settings.mutate(descriptor.ns, ops, descriptor.revision)
    } catch (error) {
      // A concurrent edit owns the newer values; re-read instead of overwriting it.
      if (error?.code === 'SETTINGS_CONFLICT' && !disposed) return sync()
      throw error
    }
  }
  ctx.on('settings/updated', changed => { if (changed === ns) return sync() })
  ctx.on('ready', sync)
  return sync()
}
