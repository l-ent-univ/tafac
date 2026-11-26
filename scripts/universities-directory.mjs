// Writes universities/directory.json: what anyone may know of each
// university (its names, its slug, the host names that were its own, its
// logo's kind), as the settings of universities/<id>/shared.js say it.
//
// The Rust gateway answers GET /__ent_auth/universities and picks the
// university a request is for from this file, which it carries
// (back/crates/tafac-gateway, src/own/universities.rs): it reads no
// JavaScript. A test holds the file to the settings
// (tests/universitiesDirectory.test.js): after a change to a shared.js or
// to a logo's kind, run
//
//   node scripts/universities-directory.mjs
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listUniversityIds, loadSharedConfig, loadUniversityDirectoryEntry, universityLogoPath } from '../universities/index.js'
import { branding as neutralBranding } from '../universities/neutral.js'

export const DIRECTORY_FILE = fileURLToPath(new URL('../universities/directory.json', import.meta.url))

// What the page's shell is filled with as the server sends it
// (server/appShell.js: fillBrandingPlaceholders): the page's name and its
// text for search engines and link previews.
function pageText(branding = {}) {
  return {
    // null: the shell keeps its placeholder, as it does for Node.
    appName: branding.appName ?? null,
    seoTitle: branding.seoTitle ?? null,
    seoDescription: branding.seoDescription ?? null,
    repoUrl: branding.about?.repoUrl ?? '',
    alternateNames: branding.alternateNames ?? [],
  }
}

// Every university of the repository, by id. Which ones a server serves is
// its own setting (UNIVERSITY, UNIVERSITIES, MULTI_UNIVERSITY).
export async function buildDirectory() {
  const universities = []
  for (const id of listUniversityIds()) {
    const entry = await loadUniversityDirectoryEntry(id)
    const shared = await loadSharedConfig(id)
    const logo = universityLogoPath(id)
    universities.push({
      id: entry.id,
      name: entry.name,
      shortName: entry.shortName,
      slug: entry.slug,
      devOnly: entry.devOnly,
      logoShape: entry.logoShape,
      // The old per-university addresses, still routed (server/universitiesApp.js).
      hostnames: (shared.hostnames ?? []).map((hostname) => String(hostname).toLowerCase()),
      // The extension of universities/<id>/assets/logo.<ext>, or null.
      logo: logo ? path.extname(logo).slice(1) : null,
      page: pageText(shared.branding),
    })
  }
  // Tafac's own text, where every university is served (universities/neutral.js).
  return { neutral: pageText(neutralBranding), universities }
}

export function serializeDirectory(directory) {
  return `${JSON.stringify(directory, null, 2)}\n`
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await writeFile(DIRECTORY_FILE, serializeDirectory(await buildDirectory()))
  console.log(`Wrote ${path.relative(process.cwd(), DIRECTORY_FILE)}`)
}
