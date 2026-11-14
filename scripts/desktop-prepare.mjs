// Assembles what the packaged desktop app (Tauri) ships, for the computer it
// runs on. `npm run desktop:build` runs it first (src-tauri/tauri.bundle.conf.json).
//
//   desktop-build/server/                    the server as the Docker image has
//                                            it: sources, built dist/,
//                                            production node_modules
//   src-tauri/binaries/node-<target triple>  the official Node binary, same
//                                            version as the Dockerfile,
//                                            checked against nodejs.org's
//                                            SHASUMS256.txt
//   src-tauri/dmg/background.tiff            macOS: the disk image's
//                                            background, its two PNGs joined
//                                            (scripts/desktopBundle.mjs)
//
// Other platforms are built on their own machine (or CI runner): the Node
// binary and node_modules are per platform.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { buildDmgBackground } from './desktopBundle.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'desktop-build')
const SERVER = path.join(OUT, 'server')
const CACHE = path.join(OUT, 'cache')
const BINARIES = path.join(ROOT, 'src-tauri', 'binaries')
const IS_WINDOWS = process.platform === 'win32'

// What server.js needs at run time (the Docker image copies the whole
// repository; this is the part the server reads). Of src/, only the modules
// the server imports (found by following the imports, see serverModules).
const SERVER_FILES = [
  'package.json',
  'package-lock.json',
  'server.js',
  'adeApi.js',
  'adeUpcomingResolver.js',
  'planningPortalApi.js',
  'planningRpc.js',
  'tempoApi.js',
  'server',
  'universities',
  'desktop',
  'dist',
]

// The server's modules, from its entry points, and the npm packages they
// import, by esbuild's import graph (nothing is bundled: only its metafile
// is read). Universities are loaded by a computed path
// (universities/index.js), so each one's server.js and shared.js is an
// entry point too (not client.js: the browser's).
async function serverModules() {
  const entries = [
    'server.js',
    'desktop/sidecar.mjs',
    ...readdirSync(path.join(ROOT, 'server')).filter((name) => name.endsWith('.js')).map((name) => `server/${name}`),
    ...readdirSync(path.join(ROOT, 'universities'), { withFileTypes: true }).flatMap((entry) => {
      if (entry.isFile() && entry.name.endsWith('.js')) return [`universities/${entry.name}`]
      if (!entry.isDirectory()) return []
      return ['server.js', 'shared.js']
        .map((name) => `universities/${entry.name}/${name}`)
        .filter((file) => existsSync(path.join(ROOT, file)))
    }),
  ]

  const { metafile } = await build({
    absWorkingDir: ROOT,
    entryPoints: entries,
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outdir: 'unused',
    logLevel: 'silent',
  })

  const sourceFiles = Object.keys(metafile.inputs).filter((file) => file.startsWith('src/'))
  const packages = new Set()
  for (const input of Object.values(metafile.inputs)) {
    for (const { path: specifier, external } of input.imports) {
      if (!external || specifier.startsWith('node:') || specifier.startsWith('.')) continue
      const parts = specifier.split('/')
      packages.add(specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0])
    }
  }
  return { sourceFiles, packages }
}

// The packages the server imports and what they depend on, by
// package-lock.json; the rest of node_modules (React, Tiptap, Tailwind… the
// frontend's, already built into dist/) is removed.
function pruneNodeModules(packages) {
  const lock = JSON.parse(readFileSync(path.join(SERVER, 'package-lock.json'), 'utf8'))
  const keep = new Set()
  const queue = [...packages]
  while (queue.length > 0) {
    const name = queue.pop()
    if (keep.has(name)) continue
    const entry = lock.packages[`node_modules/${name}`]
    if (!entry) continue
    keep.add(name)
    queue.push(...Object.keys({ ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies }))
  }

  const modules = path.join(SERVER, 'node_modules')
  // Command shims: unused, and they'd point at removed packages.
  rmSync(path.join(modules, '.bin'), { recursive: true, force: true })
  for (const entry of readdirSync(modules)) {
    if (entry.startsWith('.')) continue
    const names = entry.startsWith('@')
      ? readdirSync(path.join(modules, entry)).map((name) => `${entry}/${name}`)
      : [entry]
    for (const name of names) {
      if (!keep.has(name)) rmSync(path.join(modules, name), { recursive: true, force: true })
    }
  }
  console.log(`Server packages: ${[...packages].sort().join(', ')} (${keep.size} with their dependencies)`)
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', shell: IS_WINDOWS, ...options })
}

function nodeVersion() {
  const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8')
  const match = dockerfile.match(/^FROM node:(\d+\.\d+\.\d+)/m)
  if (!match) throw new Error('No pinned Node version in the Dockerfile')
  return match[1]
}

function nodeDistribution(version) {
  const platform = { darwin: 'darwin', linux: 'linux', win32: 'win' }[process.platform]
  const arch = { arm64: 'arm64', x64: 'x64' }[process.arch]
  if (!platform || !arch) throw new Error(`No Node build for ${process.platform}-${process.arch}`)
  const name = `node-v${version}-${platform}-${arch}`
  return {
    name,
    archive: IS_WINDOWS ? `${name}.zip` : `${name}.tar.gz`,
    binaryInArchive: IS_WINDOWS ? `${name}/node.exe` : `${name}/bin/node`,
  }
}

async function download(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function prepareNodeBinary() {
  const version = nodeVersion()
  const distribution = nodeDistribution(version)
  const base = `https://nodejs.org/dist/v${version}`
  const triple = execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim()
  const target = path.join(BINARIES, `node-${triple}${IS_WINDOWS ? '.exe' : ''}`)

  mkdirSync(CACHE, { recursive: true })
  const archivePath = path.join(CACHE, distribution.archive)
  if (!existsSync(archivePath)) {
    console.log(`Downloading Node ${version} (${distribution.archive})`)
    writeFileSync(archivePath, await download(`${base}/${distribution.archive}`))
  }

  const sums = (await download(`${base}/SHASUMS256.txt`)).toString('utf8')
  const expected = sums.split('\n').find((line) => line.endsWith(`  ${distribution.archive}`))?.split(' ')[0]
  const actual = createHash('sha256').update(readFileSync(archivePath)).digest('hex')
  if (!expected || expected !== actual) {
    rmSync(archivePath)
    throw new Error(`Checksum mismatch for ${distribution.archive}`)
  }

  const extractDir = path.join(CACHE, distribution.name)
  rmSync(extractDir, { recursive: true, force: true })
  run('tar', ['-xf', archivePath, '-C', CACHE, distribution.binaryInArchive])
  mkdirSync(BINARIES, { recursive: true })
  copyFileSync(path.join(CACHE, distribution.binaryInArchive), target)
  if (!IS_WINDOWS) chmodSync(target, 0o755)
  console.log(`Node ${version} → ${path.relative(ROOT, target)}`)
}

async function prepareServer() {
  run('npm', ['run', 'build'], { cwd: ROOT })

  const { sourceFiles, packages } = await serverModules()
  rmSync(SERVER, { recursive: true, force: true })
  mkdirSync(SERVER, { recursive: true })
  for (const entry of [...SERVER_FILES, ...sourceFiles]) {
    cpSync(path.join(ROOT, entry), path.join(SERVER, entry), { recursive: true })
  }
  // The landing pages rendered for search engines: the app has none (it
  // opens on the login page), and without them server.js sends the bare
  // page, so a reload signed out doesn't flash the landing.
  rmSync(path.join(SERVER, 'dist', '.prerender'), { recursive: true, force: true })

  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: SERVER })
  pruneNodeModules(packages)
  console.log(`Server → ${path.relative(ROOT, SERVER)}`)
}

await prepareServer()
await prepareNodeBinary()
if (process.platform === 'darwin') buildDmgBackground()
