// After `vite build` (npm run build): renders the landing page to static HTML
// with its FAQ structured data (src/landingPrerender.js, through Vite's SSR
// build) into dist/.prerender/landing.json. server.js puts it in the page it
// sends to visitors without a session, so search engines and link previews
// read the landing without running the app. A dot folder: never served as a
// file.
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import {
  listServedUniversityIds,
  loadUniversityDirectoryEntry,
  universityLogoPath,
} from '../universities/index.js'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SSR_DIR = path.join(ROOT, 'node_modules', '.cache', 'tafac-prerender')
const OUT_FILE = path.join(ROOT, 'dist', '.prerender', 'landing.json')

// The universities as production lists them (GET /__ent_auth/universities,
// dev-only ones left out), for the landing's « Compatible avec » strip.
async function listPublicUniversities() {
  const entries = await Promise.all(listServedUniversityIds().map(loadUniversityDirectoryEntry))
  return entries
    .filter((entry) => !entry.devOnly)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      shortName: entry.shortName,
      slug: entry.slug,
      logoUrl: universityLogoPath(entry.id) ? `/__ent_auth/universities/${entry.id}/logo` : null,
      listed: true,
    }))
}

await build({
  root: ROOT,
  logLevel: 'warn',
  build: {
    ssr: 'src/landingPrerender.js',
    outDir: SSR_DIR,
    emptyOutDir: true,
    copyPublicDir: false,
  },
})

const { renderLanding } = await import(pathToFileURL(path.join(SSR_DIR, 'landingPrerender.js')).href)
const landing = await renderLanding({ universities: await listPublicUniversities() })

await mkdir(path.dirname(OUT_FILE), { recursive: true })
await writeFile(OUT_FILE, JSON.stringify(landing))
await rm(SSR_DIR, { recursive: true, force: true })
console.log(`Landing pre-rendered: ${path.relative(ROOT, OUT_FILE)} (${Math.round(landing.html.length / 1024)} KB)`)
