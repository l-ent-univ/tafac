// Assembles what the iOS app (Tauri) ships. `npm run ios:dev` and
// `npm run ios:build` run it first (package.json), before Tauri starts:
// Tauri copies the app's resources as it starts, so a command of its own
// (beforeDevCommand) would come too late and the app would ship the build
// before.
//
//   desktop-build/ios/server/                 the server, for the Node inside
//                                             the app (src-tauri/src/node.rs):
//                                             nodejs-mobile's, Node 18. Its
//                                             files keep their places, each
//                                             rewritten for Node 18 (the
//                                             TypeScript ones as JavaScript),
//                                             each npm package it imports is
//                                             one file, and so is what that
//                                             Node lacks (desktop/iosRuntime.mjs)
//   desktop-build/ios/NodeMobile.xcframework  nodejs-mobile, which the Xcode
//                                             project links and embeds
//                                             (src-tauri/gen/apple/project.yml)
//
// `--skip-build` keeps dist/ as it is (no `npm run build`).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'acorn'
import { build, transform } from 'esbuild'
import rewritePattern from 'regexpu-core'
import { SERVER_FILES, serverModules } from './serverFiles.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'desktop-build', 'ios')
const SERVER = path.join(OUT, 'server')
const CACHE = path.join(ROOT, 'desktop-build', 'cache')
const FRAMEWORK = path.join(OUT, 'NodeMobile.xcframework')

// nodejs-mobile's release, and its archive's SHA-256: the project publishes
// none, so this is the one of the archive this was first built with.
const NODE_MOBILE_VERSION = '18.20.4'
const NODE_MOBILE_SHA256 = '8c5ca3a0d1e38de7f182a5642593e82593b820efd375a14b3ecafc4bcfee620e'
const NODE_TARGET = 'node18'

// Not copied: no npm install here.
const NOT_SHIPPED = new Set(['package.json', 'package-lock.json'])

// The server's own modules: not dist/, the page's, built for browsers.
function walk(folder, visit) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name)
    if (entry.isDirectory()) {
      if (file !== path.join(SERVER, 'dist')) walk(file, visit)
    } else if (entry.isFile()) {
      visit(file)
    }
  }
}

// `from './x.ts'` and `import('./x.ts')`: the file is x.js once rewritten.
function pointToJavaScript(code) {
  return code.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])(\.{1,2}\/[^"'\n]*?)\.ts\2/g, '$1$2$3.js$2')
}

// A regex with \p{…} (a Unicode property: letters, marks, control
// characters…) doesn't compile without ICU: the property is written out as
// the characters it stands for. Only the regexes written as such (/…/u): one
// built from a string at run time would still throw.
function writeOutUnicodeProperties(code, sourceType, file) {
  if (!code.includes('\\p{') && !code.includes('\\P{')) return code
  const edits = []
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'Literal' && node.regex && /\\[pP]\{/.test(node.regex.pattern)) {
      const { pattern, flags } = node.regex
      const written = rewritePattern(pattern, flags, { unicodePropertyEscapes: 'transform' })
      edits.push({ start: node.start, end: node.end, text: `/${written}/${flags}` })
    }
    // new RegExp("…", "u") with both written out: what esbuild makes of a
    // regex it thinks Node 18 can't read.
    const [source, flags] = node.type === 'NewExpression' && node.callee.name === 'RegExp' ? node.arguments : []
    if (typeof source?.value === 'string' && typeof flags?.value === 'string' && !source.regex && /\\[pP]\{/.test(source.value)) {
      const written = rewritePattern(source.value, flags.value, { unicodePropertyEscapes: 'transform' })
      edits.push({ start: source.start, end: source.end, text: JSON.stringify(written) })
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') visit(value)
    }
  }
  visit(parse(code, { ecmaVersion: 'latest', sourceType, allowHashBang: true }))
  if (edits.length === 0) return code
  let written = code
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    written = written.slice(0, edit.start) + edit.text + written.slice(edit.end)
  }
  if (/\\[pP]\{/.test(written)) console.warn(`${path.relative(SERVER, file)}: a \\p{…} is left, in a regex built at run time`)
  return written
}

// Every module of the server, where it is, in the syntax Node 18 reads. The
// layout is kept (not one bundle): the server finds its files from its
// modules' own addresses (dist/, each university's folder).
async function rewriteForNode(folder) {
  const modules = []
  walk(folder, (file) => {
    if (/\.(ts|js|mjs)$/.test(file)) modules.push(file)
  })
  for (const file of modules) {
    const isTypeScript = file.endsWith('.ts')
    const { code } = await transform(readFileSync(file, 'utf8'), {
      loader: isTypeScript ? 'ts' : 'js',
      format: 'esm',
      platform: 'node',
      target: NODE_TARGET,
      sourcefile: path.relative(SERVER, file),
    })
    if (isTypeScript) rmSync(file)
    writeFileSync(isTypeScript ? file.replace(/\.ts$/, '.js') : file, writeOutUnicodeProperties(pointToJavaScript(code), 'module', file))
  }
  return modules.length
}

function isBindingName(name) {
  try {
    new Function(`"use strict"; var ${name}`)
    return /^[A-Za-z_$][\w$]*$/.test(name)
  } catch {
    return false
  }
}

// An npm package as one file, with what it depends on, in Node 18's syntax:
// no node_modules tree to install, and a package written for a newer Node
// (one that loads ES modules with require) still loads. Its names are
// exported again from a small module, as the server imports them.
async function vendorPackage(name) {
  const folder = path.join(SERVER, 'node_modules', name)
  mkdirSync(folder, { recursive: true })
  await build({
    stdin: { contents: `module.exports = require(${JSON.stringify(name)})`, resolveDir: ROOT, loader: 'js' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: NODE_TARGET,
    outfile: path.join(folder, 'bundle.cjs'),
    logLevel: 'warning',
  })
  const bundle = path.join(folder, 'bundle.cjs')
  writeFileSync(bundle, writeOutUnicodeProperties(readFileSync(bundle, 'utf8'), 'script', bundle))

  const namespace = await import(name)
  const names = Object.keys(namespace).filter((key) => key !== 'default' && isBindingName(key))
  writeFileSync(path.join(folder, 'index.mjs'), [
    "import { createRequire } from 'node:module'",
    "const bundle = createRequire(import.meta.url)('./bundle.cjs')",
    'default' in namespace ? "export default bundle.__esModule && 'default' in bundle ? bundle.default : bundle" : '',
    names.length > 0 ? `export const { ${names.join(', ')} } = bundle` : '',
    '',
  ].filter((line, index, lines) => line || index === lines.length - 1).join('\n'))
  writeFileSync(path.join(folder, 'package.json'), `${JSON.stringify({ name, type: 'module', exports: './index.mjs' }, null, 2)}\n`)
}

async function prepareServer({ skipBuild }) {
  if (!skipBuild) execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) throw new Error('No dist/: run without --skip-build')

  const { sourceFiles, packages } = await serverModules()
  rmSync(SERVER, { recursive: true, force: true })
  mkdirSync(SERVER, { recursive: true })
  // Tauri copies the server into the Xcode project at each build and never
  // takes a file away: every build's page scripts stayed in the app.
  rmSync(path.join(ROOT, 'src-tauri', 'gen', 'apple', 'assets', 'server'), { recursive: true, force: true })
  for (const entry of [...SERVER_FILES, ...sourceFiles]) {
    if (NOT_SHIPPED.has(entry)) continue
    cpSync(path.join(ROOT, entry), path.join(SERVER, entry), { recursive: true })
  }
  // As the desktop app: no landing pages rendered for search engines.
  rmSync(path.join(SERVER, 'dist', '.prerender'), { recursive: true, force: true })
  // The modules are ES modules, as the repository's package.json says.
  writeFileSync(path.join(SERVER, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`)

  const count = await rewriteForNode(SERVER)

  for (const name of packages) await vendorPackage(name)

  // What Node 18 lacks, with the packages that put it back, as one module.
  const runtime = path.join(SERVER, 'desktop', 'iosRuntime.mjs')
  await build({
    absWorkingDir: ROOT,
    entryPoints: ['desktop/iosRuntime.mjs'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: NODE_TARGET,
    outfile: runtime,
    allowOverwrite: true,
    logLevel: 'warning',
  })
  writeFileSync(runtime, writeOutUnicodeProperties(readFileSync(runtime, 'utf8'), 'module', runtime))
  console.log(`Server → ${path.relative(ROOT, SERVER)} (${count} modules for Node ${NODE_MOBILE_VERSION}; packages: ${[...packages].sort().join(', ')})`)
}

async function prepareNodeMobile() {
  if (existsSync(path.join(FRAMEWORK, 'Info.plist'))) return

  const archive = `nodejs-mobile-v${NODE_MOBILE_VERSION}-ios.zip`
  const archivePath = path.join(CACHE, archive)
  mkdirSync(CACHE, { recursive: true })
  if (!existsSync(archivePath)) {
    console.log(`Downloading nodejs-mobile ${NODE_MOBILE_VERSION} (${archive})`)
    const url = `https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v${NODE_MOBILE_VERSION}/${archive}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
    writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()))
  }
  const actual = createHash('sha256').update(readFileSync(archivePath)).digest('hex')
  if (actual !== NODE_MOBILE_SHA256) {
    rmSync(archivePath)
    throw new Error(`Checksum mismatch for ${archive}`)
  }

  rmSync(FRAMEWORK, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  execFileSync('unzip', ['-q', '-o', archivePath, 'NodeMobile.xcframework/*', '-d', OUT], { stdio: 'inherit' })
  const megabytes = Math.round(statSync(path.join(FRAMEWORK, 'ios-arm64', 'NodeMobile.framework', 'NodeMobile')).size / 1e6)
  console.log(`nodejs-mobile ${NODE_MOBILE_VERSION} → ${path.relative(ROOT, FRAMEWORK)} (${megabytes} MB on a phone)`)
}

await prepareServer({ skipBuild: process.argv.includes('--skip-build') })
await prepareNodeMobile()
