// universities/directory.json is what the Rust gateway knows of the
// universities (scripts/universities-directory.mjs): it says what the
// settings say.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { DIRECTORY_FILE, buildDirectory, serializeDirectory } from '../scripts/universities-directory.mjs'

test('the directory the gateway carries is the settings\' own', async () => {
  const written = await readFile(DIRECTORY_FILE, 'utf8')
  assert.equal(written, serializeDirectory(await buildDirectory()), 'run: node scripts/universities-directory.mjs')
})

test('a slug, an id and an id without its dashes each name one university', async () => {
  const { universities } = await buildDirectory()
  const names = universities.flatMap((university) => [...new Set([university.id, university.id.replace(/-/g, ''), university.slug])])
  assert.equal(new Set(names).size, names.length)
})
