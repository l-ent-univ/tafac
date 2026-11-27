// What the packaged desktop app (Tauri) ships besides its own binary.
// `npm run desktop:build` runs it first (src-tauri/tauri.bundle.conf.json).
//
//   dist/                          the page's build, which the app carries
//                                  among its resources and answers itself
//                                  (src-tauri/src/bridge.rs)
//   src-tauri/dmg/background.tiff  macOS: the disk image's background, its
//                                  two PNGs joined (scripts/desktopBundle.mjs)
import { execFileSync } from 'node:child_process'
import { buildDmgBackground, ROOT } from './desktopBundle.mjs'

execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
if (process.platform === 'darwin') buildDmgBackground()
