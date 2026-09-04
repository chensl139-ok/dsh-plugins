import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repo = fileURLToPath(new URL('../', import.meta.url))

test('installer registers SiliconFlow once and keeps the checkout path', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-install-'))
  try {
    const bin = join(temp, 'bin')
    const home = join(temp, 'dsh')
    const checkout = join(temp, 'harness checkout')
    const profile = join(home, 'profiles', 'web')
    await Promise.all([mkdir(bin), mkdir(profile, { recursive: true }), mkdir(join(checkout, 'packages/llm/llm-pi-ai/src'), { recursive: true })])
    await writeFile(join(checkout, 'packages/llm/llm-pi-ai/src/adapter.ts'), '// fixture')
    await writeFile(join(profile, 'package.json'), '{"name":"test-profile","private":true}')
    await writeFile(join(profile, 'cordis.patch.yml'), '# existing profile\n')
    await writeFile(join(bin, 'git'), '#!/bin/sh\nfor target do :; done\nmkdir -p "$target"\ncp -R "$PLUGIN_REPO_FIXTURE/dsh-siliconflow-compat" "$target/"\n', { mode: 0o755 })
    await writeFile(join(bin, 'pnpm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const run = () => spawnSync('bash', [join(repo, 'install.sh'), 'dsh-siliconflow-compat'], {
      cwd: temp, encoding: 'utf8',
      env: { ...process.env, PATH: bin + delimiter + process.env.PATH, DSH_HOME: home, DSH_HARNESS_ROOT: checkout, PLUGIN_REPO_FIXTURE: repo },
    })
    for (let i = 0; i < 2; i++) {
      const result = run()
      assert.equal(result.status, 0, result.stdout + result.stderr)
    }
    const pkg = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
    assert.equal(pkg.dependencies['dsh-siliconflow-compat'], 'link:./local-plugins/dsh-siliconflow-compat')
    const patch = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')
    assert.equal(patch.match(/id: siliconflow-compat/g)?.length, 1)
    assert.ok(patch.includes(`harnessRoot: ${JSON.stringify(checkout)}`))
    await access(join(profile, 'local-plugins/dsh-siliconflow-compat/bridge.js'))
  } finally { await rm(temp, { recursive: true, force: true }) }
})
