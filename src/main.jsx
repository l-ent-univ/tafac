import './settingsTransferBoot'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './overrides.css'
import { bootUniversity } from './universityBoot'

// App and everything it imports (the landing and its copy too) read the
// university config when they load: imported once bootUniversity() has
// filled it.
// ContextMenuHost: the app's right-click menu, wherever a place offers one.
bootUniversity()
  .then(() => Promise.all([import('./App.jsx'), import('./components/ContextMenuHost.jsx')]))
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
