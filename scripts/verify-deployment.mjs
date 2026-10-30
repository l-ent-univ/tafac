#!/usr/bin/env node
// Checks that a Tafac site serves, byte for byte, the frontend a release of
// this repository built on GitHub Actions (docs/VERIFYING.md).
//
//   node scripts/verify-deployment.mjs [--site https://tafac.fr] [--version 0.15.0]
//   node scripts/verify-deployment.mjs --manifest dist-manifest.sha256 --template dist/index.html
//
// 1. Finds the release the site runs (its main script in a release's
//    dist-manifest.sha256), unless --version or --manifest says which.
// 2. With the GitHub CLI (gh), verifies the signed build provenance of the
//    page template (gh attestation verify): the signed statement lists the
//    digest of every file of that build, and those are what the site is
//    compared with. Without gh, the release's manifest is used, unsigned.
// 3. Downloads every file of the build from the site and compares it.
// 4. Compares the page itself: the template, where the server only fills
//    its placeholders (titles, descriptions, the site's address) with text
//    that can't hold markup.
//
// Node 22 or later, no dependencies. Exit code 0 when everything matches.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const REPO = 'l-ent-univ/tafac'
const PAGE_PATH = '/login'
const CONCURRENCY = 8

function readArgs(argv) {
  const args = { site: 'https://tafac.fr' }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (!name.startsWith('--')) continue
    args[name.slice(2)] = argv[index + 1]
    index += 1
  }
  args.site = args.site.replace(/\/+$/, '')
  return args
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

async function fetchBuffer(url) {
  const response = await fetch(url, { redirect: 'manual', headers: { 'Cache-Control': 'no-cache' } })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

// sha256sum output: "<hex>  <path>" per line.
function parseManifest(text) {
  const entries = new Map()
  for (const line of text.split('\n')) {
    const match = line.match(/^([0-9a-f]{64}) [ *](.+)$/)
    if (match) entries.set(match[2], match[1])
  }
  return entries
}

async function fetchReleaseAsset(tag, name) {
  return fetchBuffer(`https://github.com/${REPO}/releases/download/${tag}/${name}`)
}

// The release whose build has the site's main script, newest first.
async function findRelease(site, version) {
  if (version) return `v${version.replace(/^v/, '')}`
  const page = (await fetchBuffer(`${site}${PAGE_PATH}`)).toString('utf8')
  const mainScript = page.match(/<script[^>]+type="module"[^>]+src="\/([^"]+)"/)?.[1]
  if (!mainScript) throw new Error('No main script on the page.')
  const servedDigest = sha256(await fetchBuffer(`${site}/${mainScript}`))

  const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`)
  if (!response.ok) throw new Error(`GitHub releases: HTTP ${response.status}`)
  for (const release of await response.json()) {
    if (!release.assets?.some((asset) => asset.name === 'dist-manifest.sha256')) continue
    const manifest = parseManifest((await fetchReleaseAsset(release.tag_name, 'dist-manifest.sha256')).toString('utf8'))
    if (manifest.get(mainScript) === servedDigest) return release.tag_name
  }
  throw new Error(`No release of ${REPO} with a manifest has this main script (${mainScript}).`)
}

function hasGh() {
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// The digests the signed attestation of `file` lists, verified by gh.
function readAttestedDigests(file) {
  const output = execFileSync('gh', ['attestation', 'verify', file, '--repo', REPO, '--format', 'json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const fileDigest = sha256(readFileSync(file))
  const digests = new Map()
  for (const result of JSON.parse(output)) {
    const subjects = result?.verificationResult?.statement?.subject ?? []
    if (!subjects.some((subject) => subject?.digest?.sha256 === fileDigest)) continue
    for (const subject of subjects) {
      if (subject?.name && subject?.digest?.sha256) digests.set(subject.name, subject.digest.sha256)
    }
  }
  return digests
}

// The page as the server may send it: the template, its placeholders filled
// with text that can't open a tag or leave an attribute. The structured
// data's JSON may hold quotes, never a "<".
export function buildPagePattern(template) {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const source = template.split(/(__PUBLIC_ORIGIN__|%LENT_[A-Z_]+%)/).map((part, index) => {
    if (index % 2 === 0) return escape(part)
    if (part === '__PUBLIC_ORIGIN__') return '(?:https?://[a-z0-9.:-]+)?'
    if (part === '%LENT_ALTERNATE_NAMES_JSON%') return '[^<]*'
    return '[^<>"]*'
  }).join('')
  return new RegExp(`^${source}$`, 'i')
}

async function compareFiles(site, digests) {
  const names = [...digests.keys()].filter((name) => name !== 'index.html')
  const mismatches = []
  let next = 0
  async function worker() {
    while (next < names.length) {
      const name = names[next]
      next += 1
      try {
        const served = sha256(await fetchBuffer(`${site}/${name}`))
        if (served !== digests.get(name)) mismatches.push(`${name}: différent`)
      } catch (error) {
        mismatches.push(`${name}: ${error.message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return { checked: names.length, mismatches }
}

async function main() {
  const args = readArgs(process.argv.slice(2))
  const workDir = mkdtempSync(path.join(tmpdir(), 'tafac-verify-'))

  try {
    let manifest
    let template
    let tag = null
    if (args.manifest) {
      manifest = readFileSync(args.manifest)
      template = readFileSync(args.template ?? 'dist/index.html')
    } else {
      tag = await findRelease(args.site, args.version)
      manifest = await fetchReleaseAsset(tag, 'dist-manifest.sha256')
      template = await fetchReleaseAsset(tag, 'index.template.html')
    }
    console.log(`Site : ${args.site}${tag ? ` · version ${tag}` : ' · manifest local'}`)

    let digests = parseManifest(manifest.toString('utf8'))
    if (!args.manifest && hasGh()) {
      const templateFile = path.join(workDir, 'index.html')
      writeFileSync(templateFile, template)
      digests = readAttestedDigests(templateFile)
      if (!digests.size) throw new Error('The attestation lists no file.')
      console.log(`✔ Provenance signée vérifiée (gh attestation verify) : ${digests.size} fichiers, build GitHub Actions de ${REPO}`)
    } else if (!args.manifest) {
      console.log('! gh absent : comparaison avec le manifest de la release, sans vérifier sa signature (voir docs/VERIFYING.md)')
    }

    if (digests.get('index.html') !== sha256(template)) {
      throw new Error('The page template is not the one of this build.')
    }

    const { checked, mismatches } = await compareFiles(args.site, digests)
    const page = (await fetchBuffer(`${args.site}${PAGE_PATH}`)).toString('utf8')
    const pageMatches = buildPagePattern(template.toString('utf8')).test(page)

    console.log(`${mismatches.length ? '✘' : '✔'} Fichiers : ${checked - mismatches.length}/${checked} identiques`)
    for (const line of mismatches) console.log(`    ${line}`)
    console.log(`${pageMatches ? '✔' : '✘'} Page (${PAGE_PATH}) : ${pageMatches ? 'le modèle du build, seuls ses textes remplis' : 'différente du modèle du build'}`)
    process.exitCode = mismatches.length || !pageMatches ? 1 : 0
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`✘ ${error.message}`)
    process.exitCode = 1
  })
}
