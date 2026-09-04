/** Resolve source modules from the host's Harness checkout, not the plugin's installation directory. */
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function harnessRoot(configured) {
  return resolve(configured || process.env.DSH_HARNESS_ROOT || process.cwd())
}

export async function importHarness(relative, configured) {
  const file = resolve(harnessRoot(configured), relative)
  try {
    await access(file)
  } catch {
    throw new Error(`siliconflow-compat: Harness source not found at ${file}; set DSH_HARNESS_ROOT or plugin config.harnessRoot to the deepseek-harness checkout`)
  }
  return import(pathToFileURL(file).href)
}
