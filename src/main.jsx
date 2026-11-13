import './settingsTransferBoot'
// Iconify's icons, bundled: none waits on the network to show.
import './iconBundle'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './overrides.css'
import { bootUniversity } from './universityBoot'

// App and everything it imports (the landing and its copy too) read the
// university config when they load: imported once bootUniversity() has
// filled it.
// ContextMenuHost: the app's right-click menu, wherever a place offers one.
// Dev only: /dev/design, every token and shared component on one page
// (src/dev/DesignGallery.jsx). The build drops the branch and the chunk.
const DESIGN_GALLERY_PATH = '/dev/design'
const showDesignGallery = import.meta.env.DEV && window.location.pathname.replace(/\/+$/, '') === DESIGN_GALLERY_PATH

bootUniversity()
  .then(() => (showDesignGallery
    ? import('./dev/DesignGallery.jsx').then((module) => [{ default: module.default }, { default: () => null }])
    : Promise.all([import('./App.jsx'), import('./components/ContextMenuHost.jsx')])))
  .then(([appModule, hostModule]) => {
    const App = appModule.default
    const ContextMenuHost = hostModule.default
    createRoot(document.getElementById('root')).render(
      <StrictMode>
        <App />
        <ContextMenuHost />
      </StrictMode>,
    )
  })
