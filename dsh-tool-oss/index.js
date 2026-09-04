/**
 * dsh-tool-oss — Host half.
 *
 * Registers:
 *  1. The `oss` model tool (put/get/list/delete/deleteFolder).
 *  2. A `/oss` Connection RPC channel for the browser UI
 *     (providers/list/put/putBatch/getText/delete/deleteFolder).
 *
 * All provider config is resolved per operation through DSH credentials refs.
 * The local provider layers process env, its owner-only store, and DSH env files.
 *
 * Zero external dependencies: Node crypto (SigV4) + global fetch.
 */
import crypto from 'node:crypto'
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import os from 'node:os'

export const name = 'tool-oss'
export const inject = ['tools', 'connection', 'credentials']

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_INLINE_CHARS = 20_000

// ── SigV4 ────────────────────────────────────────────────────────────────────

function sha256Hex(d) { return crypto.createHash('sha256').update(d).digest('hex') }
function hmac(k, d) { return crypto.createHmac('sha256', k).update(d).digest() }
function awsUri(s) { return encodeURIComponent(String(s)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()) }
function encodeKey(k) { return String(k).split('/').map(awsUri).join('/') }
function canoQS(q) { return q ? Object.entries(q).map(([k,v]) => awsUri(k)+'='+awsUri(v)).sort().join('&') : '' }

function signV4({ method, path, query, headers, body, host, region, ak, sk }) {
  const now = new Date()
  const dt = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const ds = dt.slice(0, 8)
  const buf = body == null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(body)
  const ph = sha256Hex(buf)
  const he = Object.entries({ ...headers, host, 'x-amz-date': dt, 'x-amz-content-sha256': ph })
    .map(([k,v]) => [k.toLowerCase(), String(v).trim()])
    .sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  const ch = he.map(([k,v]) => k+':'+v+'\n').join('')
  const sh = he.map(([k]) => k).join(';')
  const cr = [method, path, canoQS(query), ch, sh, ph].join('\n')
  const scope = [ds, region, 's3', 'aws4_request'].join('/')
  const sts = ['AWS4-HMAC-SHA256', dt, scope, sha256Hex(cr)].join('\n')
  let key = hmac('AWS4'+sk, ds); key = hmac(key, region); key = hmac(key, 's3'); key = hmac(key, 'aws4_request')
  const sig = crypto.createHmac('sha256', key).update(sts).digest('hex')
  const auth = 'AWS4-HMAC-SHA256 Credential='+ak+'/'+scope+', SignedHeaders='+sh+', Signature='+sig
  return { ...headers, 'x-amz-date': dt, 'x-amz-content-sha256': ph, authorization: auth }
}

// ── S3 client ────────────────────────────────────────────────────────────────

class S3Client {
  constructor({ endpoint, region, bucket, accessKeyId, secretAccessKey }) {
    this.endpoint = endpoint.replace(/\/+$/, '')
    this.region = region; this.bucket = bucket
    this.accessKeyId = accessKeyId; this.secretAccessKey = secretAccessKey
    this.host = new URL(this.endpoint).host
  }
  async request(method, path, { query, headers, body, signal } = {}) {
    const qs = canoQS(query)
    const url = this.endpoint + path + (qs ? '?'+qs : '')
    const signed = signV4({ method, path, query, headers: headers||{}, body, host: this.host, region: this.region, ak: this.accessKeyId, sk: this.secretAccessKey })
    const res = await fetch(url, { method, headers: signed, body: (method==='GET'||method==='DELETE') ? undefined : (body==null?undefined:body), signal })
    if (!res.ok) { const d = await res.text().catch(()=>'' ); throw new Error('OSS '+method+' '+path+' '+res.status+' '+res.statusText+(d?'\n'+d.slice(0,800):'')) }
    return res
  }
  put(key, body, ct, signal) { return this.request('PUT', '/'+awsUri(this.bucket)+'/'+encodeKey(key), { headers: ct?{'content-type':ct}:{}, body, signal }) }
  async get(key, signal) { return Buffer.from(await (await this.request('GET', '/'+awsUri(this.bucket)+'/'+encodeKey(key), { signal })).arrayBuffer()) }
  delete(key, signal) { return this.request('DELETE', '/'+awsUri(this.bucket)+'/'+encodeKey(key), { signal }) }
  async list(prefix, maxKeys, signal) {
    const res = await this.request('GET', '/'+awsUri(this.bucket), { query: { 'list-type':'2', prefix: prefix||'', 'max-keys': String(maxKeys||100), delimiter:'/' }, signal })
    return parseListXml(await res.text())
  }
  objectUrl(key) { return this.endpoint+'/'+awsUri(this.bucket)+'/'+encodeKey(key) }
}

function parseListXml(xml) {
  const objects = []
  const re = /<Contents>([\s\S]*?)<\/Contents>/g
  let m
  while ((m = re.exec(xml))) {
    const b = m[1]
    const pick = t => { const mm = b.match(new RegExp('<'+t+'>([\\s\\S]*?)</'+t+'>')); return mm ? mm[1] : '' }
    objects.push({ key: pick('Key'), size: parseInt(pick('Size')||'0',10), lastModified: pick('LastModified') })
  }
  const prefixes = []
  const rp = /<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g
  let pm
  while ((pm = rp.exec(xml))) { const k = pm[1].match(/<Prefix>([\s\S]*?)<\/Prefix>/); if (k && k[1]) prefixes.push(k[1]) }
  return { objects, prefixes, truncated: /<IsTruncated>true<\/IsTruncated>/.test(xml) }
}

// ── Config ───────────────────────────────────────────────────────────────────

export const Config = z.object({
  providers: z.dict(z.object({
    endpoint: z.string().default(''), region: z.string().default(''), bucket: z.string().default(''),
    endpointEnv: z.string().default(''), regionEnv: z.string().default(''), bucketEnv: z.string().default(''),
    accessKeyId: z.string().default(''), secretAccessKey: z.string().default(''),
    accessKeyIdEnv: z.string().default(''), secretAccessKeyEnv: z.string().default(''),
  })).required(),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
})

async function resolveConfigValue(ctx, cfg, direct, reference) {
  if (cfg[direct]) return cfg[direct]
  if (!cfg[reference]) return ''
  const resolved = await ctx.credentials.resolve(cfg[reference])
  return resolved?.value || ''
}

async function clientFor(ctx, providers, name) {
  const cfg = providers[name]
  if (!cfg) throw new Error("unknown OSS provider '"+name+"'; configured: "+(Object.keys(providers).join(', ')||'none'))
  const [endpoint, region, bucket, ak, sk] = await Promise.all([
    resolveConfigValue(ctx, cfg, 'endpoint', 'endpointEnv'),
    resolveConfigValue(ctx, cfg, 'region', 'regionEnv'),
    resolveConfigValue(ctx, cfg, 'bucket', 'bucketEnv'),
    resolveConfigValue(ctx, cfg, 'accessKeyId', 'accessKeyIdEnv'),
    resolveConfigValue(ctx, cfg, 'secretAccessKey', 'secretAccessKeyEnv'),
  ])
  const missing = []
  if (!endpoint) missing.push(cfg.endpointEnv || 'endpoint')
  if (!region) missing.push(cfg.regionEnv || 'region')
  if (!bucket) missing.push(cfg.bucketEnv || 'bucket')
  if (!ak) missing.push(cfg.accessKeyIdEnv || 'accessKeyId')
  if (!sk) missing.push(cfg.secretAccessKeyEnv || 'secretAccessKey')
  if (missing.length) throw new Error("OSS provider '"+name+"' config missing: configure DSH credential refs "+missing.join(', '))
  return new S3Client({ endpoint, region, bucket, accessKeyId: ak, secretAccessKey: sk })
}

async function providerSummary(ctx, providers, name) {
  const cfg = providers[name]
  const [endpoint, region, bucket] = await Promise.all([
    resolveConfigValue(ctx, cfg, 'endpoint', 'endpointEnv'),
    resolveConfigValue(ctx, cfg, 'region', 'regionEnv'),
    resolveConfigValue(ctx, cfg, 'bucket', 'bucketEnv'),
  ])
  return { name, endpoint, region, bucket }
}

// ── Recursive folder delete (S3 forces delimiter=/ so we recurse) ─────────────

async function deleteFolderRecursive(client, prefix, signal) {
  let deleted = 0, failed = 0
  const errors = []
  async function delLevel(pfx) {
    if (signal && signal.aborted) return
    const r = await client.list(pfx, 1000, signal)
    for (const o of r.objects) {
      if (signal && signal.aborted) return
      try { await client.delete(o.key, signal); deleted++ }
      catch (e) { failed++; errors.push({ key: o.key, message: e?.message || String(e) }) }
    }
    for (const sd of r.prefixes) { if (signal && signal.aborted) return; await delLevel(sd) }
  }
  await delLevel(prefix)
  return { deleted, failed, errors: errors.slice(0, 20) }
}

// ── Model tool ───────────────────────────────────────────────────────────────

function applyOssTool(ctx, providers, timeoutMs) {
  ctx.tools.register(defineTool({
    name: 'oss',
    description: 'Upload, download, list, or delete objects on S3-compatible cloud storage. Actions: put|get|delete|list|deleteFolder. For put: supply content (text) or localPath (file). For get: supply localPath to save, otherwise content returned inline. deleteFolder deletes all objects under a prefix.',
    parameters: {
      provider: { type: 'string', required: true, description: 'Configured OSS provider name.' },
      action: { type: 'string', required: true, description: 'put|get|delete|list|deleteFolder' },
      key: { type: 'string', description: 'Object key (put/get/delete) or prefix (deleteFolder).' },
      localPath: { type: 'string', description: 'put: local file. get: save path.' },
      content: { type: 'string', description: 'put: text content.' },
      prefix: { type: 'string', description: 'list/deleteFolder: key prefix.' },
      maxKeys: { type: 'number', description: 'list: max objects.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {
        action: { type: 'string' }, provider: { type: 'string' }, key: { type: 'string' },
        bytes: { type: 'number' }, url: { type: 'string' }, savedTo: { type: 'string' },
        content: { type: 'string' }, truncated: { type: 'boolean' }, deleted: { type: 'boolean' },
        bucket: { type: 'string' }, prefix: { type: 'string' },
        objects: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { key: { type: 'string' }, size: { type: 'number' }, lastModified: { type: 'string' } } } },
        prefixes: { type: 'array', items: { type: 'string' } },
        failed: { type: 'number' }, errors: { type: 'array' }, error: { type: 'string' },
      } },
      render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const { action, key } = args
      try {
        const client = await clientFor(ctx, providers, args.provider)
        if (action === 'put') {
          if (!key) throw new Error('put requires key')
          let body, ct
          if (args.content != null) { body = args.content; ct = 'text/plain; charset=utf-8' }
          else if (args.localPath) { body = await readFile(args.localPath); ct = 'application/octet-stream' }
          else throw new Error('put requires content or localPath')
          await client.put(key, body, ct, exec.signal)
          return { action, provider: args.provider, key, bytes: Buffer.byteLength(body), url: client.objectUrl(key) }
        }
        if (action === 'get') {
          if (!key) throw new Error('get requires key')
          const buf = await client.get(key, exec.signal)
          if (args.localPath) { await mkdir(dirname(args.localPath), { recursive: true }); await writeFile(args.localPath, buf); return { action, provider: args.provider, key, bytes: buf.length, savedTo: args.localPath } }
          const text = buf.toString('utf8'); const tr = text.length > MAX_INLINE_CHARS
          return { action, provider: args.provider, key, bytes: buf.length, content: tr ? text.slice(0, MAX_INLINE_CHARS) : text, truncated: tr }
        }
        if (action === 'delete') { if (!key) throw new Error('delete requires key'); await client.delete(key, exec.signal); return { action, provider: args.provider, key, deleted: true } }
        if (action === 'list') {
          const r = await client.list(args.prefix, args.maxKeys, exec.signal)
          return { action, provider: args.provider, bucket: client.bucket, prefix: args.prefix||'', objects: r.objects, prefixes: r.prefixes, truncated: r.truncated }
        }
        if (action === 'deleteFolder') {
          const pfx = args.prefix || key || ''
          if (!pfx) throw new Error('deleteFolder requires prefix or key')
          const r = await deleteFolderRecursive(client, pfx, exec.signal)
          return { action, provider: args.provider, prefix: pfx, deleted: r.deleted, failed: r.failed, errors: r.errors }
        }
        throw new Error("unknown action '"+action+"'")
      } catch (err) {
        return { action: String(action), provider: String(args.provider), key: String(key||args.prefix||''), error: err?.message || String(err) }
      }
    },
  }))
}

// ── RPC channel /oss ─────────────────────────────────────────────────────────

function applyOssRpc(ctx, providers) {
  ctx.connection.rpc.handle('/oss', async (endpoint, payload, signal) => {
      try {
        const p = payload || {}
        if (endpoint === 'providers') {
          return { ok: true, value: await Promise.all(Object.keys(providers).map(name => providerSummary(ctx, providers, name))) }
        }
        if (endpoint === 'list') {
          const c = await clientFor(ctx, providers, p.provider); const r = await c.list(p.prefix, p.maxKeys, signal)
          return { ok: true, value: r }
        }
        if (endpoint === 'put') {
          const c = await clientFor(ctx, providers, p.provider)
          const body = p.binary ? Buffer.from(p.content, 'base64') : p.content
          await c.put(p.key, body, p.contentType || 'text/plain; charset=utf-8', signal)
          return { ok: true, value: { bytes: Buffer.byteLength(body), url: c.objectUrl(p.key) } }
        }
        if (endpoint === 'putBatch') {
          const c = await clientFor(ctx, providers, p.provider)
          const items = Array.isArray(p.files) ? p.files : []
          const pfx = typeof p.prefix === 'string' ? p.prefix.replace(/\/+$/,'') : ''
          let ok=0, failed=0, bytes=0; const errors=[]
          for (const item of items) {
            if (signal?.aborted) break
            const key = pfx ? pfx+'/'+item.key : item.key
            try {
              const body = item.binary ? Buffer.from(item.content, 'base64') : item.content
              await c.put(key, body, item.contentType || 'application/octet-stream', signal)
              ok++; bytes += Buffer.byteLength(body)
            } catch (e) { failed++; errors.push({ key, message: e?.message || String(e) }) }
          }
          return { ok: true, value: { ok, failed, bytes, errors: errors.slice(0,20) } }
        }
        if (endpoint === 'getText') {
          const c = await clientFor(ctx, providers, p.provider)
          const buf = await c.get(p.key, signal)
          const text = buf.toString('utf8'); const tr = text.length > MAX_INLINE_CHARS
          return { ok: true, value: { bytes: buf.length, content: tr ? text.slice(0,MAX_INLINE_CHARS) : text, truncated: tr } }
        }
        if (endpoint === 'delete') {
          const c = await clientFor(ctx, providers, p.provider); await c.delete(p.key, signal)
          return { ok: true, value: { deleted: true } }
        }
        if (endpoint === 'deleteFolder') {
          const c = await clientFor(ctx, providers, p.provider)
          const r = await deleteFolderRecursive(c, p.prefix || '', signal)
          return { ok: true, value: r }
        }
        // ── Local filesystem browsing (replaces native file picker) ──
        if (endpoint === 'localList') {
          const dir = p.path || os.homedir()
          const entries = await readdir(dir, { withFileTypes: true })
          const items = []
          for (const e of entries) {
            if (e.name.startsWith('.') && e.name !== '.dsh') continue
            try {
              const s = await stat(join(dir, e.name))
              items.push({ name: e.name, isDir: e.isDirectory(), size: s.size })
            } catch { /* skip inaccessible */ }
          }
          items.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name))
          return { ok: true, value: { path: dir, items } }
        }
        if (endpoint === 'localUploadFolder') {
          // Read a local folder recursively and upload all files to OSS,
          // preserving the folder structure under `ossPrefix`.
          const localPath = p.localPath
          const ossProvider = p.provider
          const ossPrefix = (p.ossPrefix || '').replace(/\/+$/, '')
          if (!localPath) return { ok: false, error: { code: 'bad-request', message: 'localPath required', details: { issues: [] } } }
          const c = await clientFor(ctx, providers, ossProvider)
          const allFiles = []
          async function walk(dir, relBase) {
            const entries = await readdir(dir, { withFileTypes: true })
            for (const e of entries) {
              if (e.name.startsWith('.')) continue
              const full = join(dir, e.name)
              const rel = relBase ? relBase + '/' + e.name : e.name
              if (e.isDirectory()) { await walk(full, rel) }
              else { allFiles.push({ full, rel }) }
            }
          }
          await walk(localPath, '')
          let ok2 = 0, failed2 = 0, totalBytes2 = 0
          const errors2 = []
          for (const f of allFiles) {
            if (signal?.aborted) break
            try {
              const body = await readFile(f.full)
              const key = ossPrefix ? ossPrefix + '/' + f.rel : f.rel
              await c.put(key, body, 'application/octet-stream', signal)
              ok2++; totalBytes2 += body.length
            } catch (e) { failed2++; errors2.push({ key: f.rel, message: e?.message || String(e) }) }
          }
          return { ok: true, value: { total: allFiles.length, ok: ok2, failed: failed2, bytes: totalBytes2, errors: errors2.slice(0, 20) } }
        }
        return { ok: false, error: { code: 'bad-request', message: "unknown endpoint '"+endpoint+"'", details: { issues: [] } } }
      } catch (err) {
        return { ok: false, error: { code: signal?.aborted ? 'cancelled' : 'internal', message: err?.message || String(err), details: {} } }
      }
    }, { authority: 'loopback' })
}

// ── Entry ────────────────────────────────────────────────────────────────────

export function apply(ctx, config) {
  const { providers, timeoutMs } = config
  applyOssTool(ctx, providers, timeoutMs)
  applyOssRpc(ctx, providers)
}

export { S3Client }
