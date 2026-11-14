// First: nothing personal goes into the skeletons' remembered shapes.
import './skeletonPrivacy'
import './settingsTransferBoot'
// Iconify's icons, bundled: none waits on the network to show.
import './iconBundle'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './overrides.css'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import { bootUniversity } from './universityBoot'
import { isDesktopApp, isMacDesktopApp, markDesktopApp } from './desktopApp'
import { enableWindowMoveBand } from './desktopWindowDrag'
import { blockNativeContextMenu } from './contextMenuEvents'
import { getDesktopUpdate, loadDesktopUpdate, subscribeDesktopUpdate } from './desktopUpdate'

// Desktop app: no webview menu (Reload…) on a right click, from the start
// (the login page too).
if (isDesktopApp()) blockNativeContextMenu(window)
markDesktopApp()
if (isMacDesktopApp()) enableWindowMoveBand(window)

// App and everything it imports (the landing and its copy too) read the
// university config when they load: imported once bootUniversity() has
// filled it.
// ContextMenuHost: the app's right-click menu, wherever a place offers one.
// Dev only: /dev/design, every token and shared component on one page
// (src/dev/DesignGallery.jsx). The build drops the branch and the chunk.
const DESIGN_GALLERY_PATH = '/dev/design'
const showDesignGallery = import.meta.env.DEV && window.location.pathname.replace(/\/+$/, '') === DESIGN_GALLERY_PATH

// Desktop app: its updates (src/desktopUpdate.js), in a root of their own,
// before anything else starts. True when the running version can't sign in
// any more: « Mise à jour nécessaire » has the page, the app doesn't start
// and the university isn't asked anything. It starts (a reload) if the app
// later says the version will do after all. Never in the way otherwise: no
// answer, or an error here, and the app starts as usual.
async function startDesktopUpdates() {
  try {
    const update = await loadDesktopUpdate()
    const { default: DesktopUpdateLayer } = await import('./components/DesktopUpdateLayer.jsx')
    const container = document.createElement('div')
    document.body.append(container)
    createRoot(container).render(
      <StrictMode>
        <DesktopUpdateLayer />
      </StrictMode>,
    )
    if (!update?.required) return false
    subscribeDesktopUpdate(() => {
      if (!getDesktopUpdate()?.required) window.location.reload()
    })
    return true
  } catch (error) {
    console.error('Desktop updates failed to start', error)
    return false
  }
}

async function start() {
  if (isDesktopApp() && await startDesktopUpdates()) return

  await bootUniversity()
  const [appModule, hostModule] = showDesignGallery
    ? [await import('./dev/DesignGallery.jsx'), { default: () => null }]
    : await Promise.all([import('./App.jsx'), import('./components/ContextMenuHost.jsx')])
  const App = appModule.default
  const ContextMenuHost = hostModule.default
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <AppErrorBoundary>
        <App />
        <ContextMenuHost />
      </AppErrorBoundary>
    </StrictMode>,
  )
}

void start()
