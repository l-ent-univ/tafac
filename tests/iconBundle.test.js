import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { collectIconNames } from '../scripts/iconNames.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

test('every icon the code names is bundled (else: npm run icons)', async () => {
  const bundle = JSON.parse(await readFile(path.join(ROOT, 'src/iconBundle.json'), 'utf8'))
  const bundled = new Set(bundle.flatMap((collection) => [
    ...Object.keys(collection.icons),
    ...Object.keys(collection.aliases ?? {}),
  ].map((name) => `${collection.prefix}:${name}`)))
  const missing = Object.entries(await collectIconNames(ROOT))
    .flatMap(([prefix, names]) => names.map((name) => `${prefix}:${name}`))
    .filter((icon) => !bundled.has(icon))
  assert.deepEqual(missing, [])
})
