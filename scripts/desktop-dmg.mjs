// The disk image of a first install (macOS): Tafac.app and a link to
// Applications on the background picture, laid out as
// bundle.macOS.dmg says in src-tauri/tauri.conf.json (window, positions).
// Updates don't use it: they are the .app.tar.gz
// (scripts/desktop-updater-archive.mjs).
//
//   <bundle>/dmg/Tafac_<version>_<arch>.dmg
//
// Made here, from the app as it stands after the signed build
// (scripts/desktop-sign.mjs) and its notarization: Tauri's own disk image
// is made before both, around a Node macOS refuses to run. Same recipe as
// Tauri's (create-dmg): a writable image, laid out by Finder, then
// compressed.
//
// The background is src-tauri/dmg/background.png (660×400) and
// background@2x.png (1320×800), joined into background.tiff
// (scripts/desktopBundle.mjs).
//
// APPLE_SIGNING_IDENTITY: set, the image is signed with it.
// With an App Store Connect API key in the environment
// (scripts/desktop-notarize.mjs), it is notarized and stapled too.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { APP, BUNDLE, ROOT, TAURI, appArchitecture, appVersion, buildDmgBackground, read, requireApp, run } from './desktopBundle.mjs'
import { notarize, notaryCredentials } from './desktop-notarize.mjs'

// Finder's icons and their names, as Tauri's disk image has them.
const ICON_SIZE = 128
const TEXT_SIZE = 16
// Where the window opens on the screen, unless the config says.
const WINDOW_POSITION = { x: 10, y: 60 }

function layoutScript({ volume, appName, background, window, size, app, applications }) {
  const bounds = (shrink) => `{${window.x}, ${window.y}, ${window.x + size.width - shrink}, ${window.y + size.height - shrink}}`
  return `
tell application "Finder"
  tell disk "${volume}"
    open
    tell container window
      set current view to icon view
      set toolbar visible to false
      set statusbar visible to false
      set the bounds to ${bounds(0)}
    end tell
    set viewOptions to the icon view options of container window
    tell viewOptions
      set icon size to ${ICON_SIZE}
      set text size to ${TEXT_SIZE}
      set arrangement to not arranged
    end tell
    set background picture of viewOptions to file ".background:${background}"
    set position of item "${appName}" to {${app.x}, ${app.y}}
    set position of item "Applications" to {${applications.x}, ${applications.y}}
    set the extension hidden of item "${appName}" to true
    close
    open
    -- Finder only saves the window once it has changed: resized and back.
    delay 1
    tell container window
      set statusbar visible to false
      set the bounds to ${bounds(10)}
    end tell
  end tell
  delay 1
  tell disk "${volume}"
    tell container window
      set statusbar visible to false
      set the bounds to ${bounds(0)}
    end tell
  end tell
  delay 3
end tell
`
}

async function detach(device) {
  // Finder may still hold the volume for a moment.
  for (let attempt = 1; ; attempt += 1) {
    try {
      run('hdiutil', ['detach', device], { stdio: ['ignore', 'ignore', 'pipe'] })
      return
    } catch (error) {
      if (attempt === 5) throw error
      await sleep(2000 * attempt)
    }
  }
}

async function buildDmg() {
  requireApp()
  const config = JSON.parse(readFileSync(path.join(TAURI, 'tauri.conf.json'), 'utf8'))
  const layout = config.bundle.macOS.dmg
  const volume = config.productName
  const appName = path.basename(APP)
  const output = path.join(BUNDLE, 'dmg', `${volume}_${appVersion()}_${appArchitecture().file}.dmg`)
  const mountPoint = `/Volumes/${volume}`
  if (existsSync(mountPoint)) {
    console.error(`A volume named ${volume} is mounted (${mountPoint}): eject it first`)
    process.exit(1)
  }

  const background = buildDmgBackground()
  const work = mkdtempSync(path.join(tmpdir(), 'tafac-dmg-'))
  const image = path.join(work, 'layout.dmg')
  let device = null
  try {
    // The image's content, the app copied whole (ditto keeps its signature
    // and its notarization ticket).
    const content = path.join(work, 'content')
    mkdirSync(content)
    run('ditto', [APP, path.join(content, appName)])
    const megabytes = Math.ceil(Number(read('du', ['-sk', content]).split(/\s+/)[0]) / 1024)
    run('hdiutil', [
      'create', '-quiet',
      '-srcfolder', content,
      '-volname', volume,
      '-fs', 'HFS+',
      '-fsargs', '-c c=64,a=16,e=16',
      '-format', 'UDRW',
      '-size', `${megabytes + 64}m`,
      image,
    ])

    // stderr kept for a failure only: newer systems note that this
    // spelling of the command is on its way out.
    const attached = read('hdiutil', ['attach', '-readwrite', '-noverify', '-noautoopen', '-nobrowse', '-mountpoint', mountPoint, image], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    device = attached.split('\n').map((line) => line.split(/\s+/)[0]).find((name) => name.startsWith('/dev/'))
    if (!device) throw new Error('The disk image did not mount')

    mkdirSync(path.join(mountPoint, '.background'))
    cpSync(background, path.join(mountPoint, '.background', path.basename(background)))
    symlinkSync('/Applications', path.join(mountPoint, 'Applications'))
    // The volume's own icon, the app's. SetFile comes with Xcode's command
    // line tools: without it, the volume keeps the system's icon.
    try {
      const volumeIcon = path.join(mountPoint, '.VolumeIcon.icns')
      cpSync(path.join(TAURI, 'icons', 'icon.icns'), volumeIcon)
      run('SetFile', ['-c', 'icnC', volumeIcon])
      run('SetFile', ['-a', 'C', mountPoint])
    } catch {
      rmSync(path.join(mountPoint, '.VolumeIcon.icns'), { force: true })
    }

    run('osascript', ['-e', layoutScript({
      volume,
      appName,
      background: path.basename(background),
      window: layout.windowPosition ?? WINDOW_POSITION,
      size: layout.windowSize,
      app: layout.appPosition,
      applications: layout.applicationFolderPosition,
    })])
    // The layout is the volume's .DS_Store, written by Finder.
    const layoutFile = path.join(mountPoint, '.DS_Store')
    for (let waited = 0; !existsSync(layoutFile); waited += 1) {
      if (waited === 30) throw new Error('Finder did not save the window\'s layout')
      await sleep(1000)
    }
    // What macOS left on the volume while it was mounted.
    rmSync(path.join(mountPoint, '.fseventsd'), { recursive: true, force: true })
    run('chmod', ['-Rf', 'go-w', mountPoint])
    run('sync', [])
    await detach(device)
    device = null

    mkdirSync(path.dirname(output), { recursive: true })
    rmSync(output, { force: true })
    run('hdiutil', ['convert', '-quiet', image, '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-o', output])
  } finally {
    if (device) await detach(device).catch(() => {})
    rmSync(work, { recursive: true, force: true })
  }

  const identity = process.env.APPLE_SIGNING_IDENTITY
  if (identity) {
    run('codesign', ['--force', '--timestamp', '--sign', identity, output])
    run('codesign', ['--verify', '--strict', output])
  }
  if (identity && notaryCredentials()) notarize(output)
  console.log(`Disk image: ${path.relative(ROOT, output)}${identity ? ' (signed)' : ' (not signed: APPLE_SIGNING_IDENTITY is not set)'}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildDmg()
