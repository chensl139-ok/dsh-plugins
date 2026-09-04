import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { harnessRoot } from '../harness.js'
const files = ['endpoints.test.js', 'harness.test.js', 'index.test.js', 'bridge.test.ts'].map(name => fileURLToPath(new URL(`../${name}`, import.meta.url)))
const result = spawnSync(process.execPath, ['--import', 'tsx/esm', '--test', ...files], {
  cwd: harnessRoot(), env: process.env, stdio: 'inherit',
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
