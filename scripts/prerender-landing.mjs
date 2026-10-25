// After `vite build` (npm run build): renders the landing pages to static
// HTML with their FAQ structured data (src/landingPrerender.js, through
// Vite's SSR build) into dist/.prerender/landing.json: the neutral one (/)
// and each public university's (/<slug>). server.js puts them in the pages it
// sends to visitors without a session, so search engines and link previews
// read the landing without running the app. A dot folder: never served as a
// file.
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'
import { build } from 'vite'
import {
  listServedUniversityIds,
  loadUniversityDirectoryEntry,
  universityLogoPath,
} from '../universities/index.js'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SSR_DIR = path.join(ROOT, 'node_modules', '.cache', 'tafac-prerender')
const OUT_FILE = path.join(ROOT, 'dist', '.prerender', 'landing.json')

// A worker (below): one page, in a module graph of its own.
if (!isMainThread) {
  const { renderLanding } = await import(workerData.entry)
  parentPort.postMessage(await renderLanding(workerData.options))
} else {
  await prerenderLandingPages()
}

// The universities as production lists them (GET /__ent_auth/universities,
// dev-only ones left out), for the landing's « Compatible avec » strip and
// their own pages.
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

// Each page in a worker of its own: the landing's modules read the
// university config when they load, once per module graph.
function renderInWorker(entry, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { entry, options } })
    worker.once('message', resolve)
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`Landing pre-render stopped (${code})`))
    })
  })
}

async function prerenderLandingPages() {
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

  const entry = pathToFileURL(path.join(SSR_DIR, 'landingPrerender.js')).href
  const universities = await listPublicUniversities()
  const [home, ...pages] = await Promise.all([
    renderInWorker(entry, { universities }),
    ...universities.map((university) => renderInWorker(entry, { universities, universityId: university.id })),
  ])
  const landing = {
    home,
    universities: Object.fromEntries(universities.map((university, index) => [university.id, pages[index]])),
  }

  await mkdir(path.dirname(OUT_FILE), { recursive: true })
  await writeFile(OUT_FILE, JSON.stringify(landing))
  await rm(SSR_DIR, { recursive: true, force: true })
  const size = (page) => `${Math.round(page.html.length / 1024)} KB`
  console.log(`Landing pre-rendered: ${path.relative(ROOT, OUT_FILE)} (/ ${size(home)}${universities.map((university, index) => `, /${university.slug} ${size(pages[index])}`).join('')})`)
}
