// The server's files, as the apps ship them (the desktop app:
// scripts/desktop-prepare.mjs; the iOS app: scripts/ios-prepare.mjs).
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// What server.js needs at run time (the Docker image copies the whole
// repository; this is the part the server reads). Of src/, only the modules
// the server imports (found by following the imports, see serverModules).
export const SERVER_FILES = [
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
export async function serverModules() {
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
