import './settingsTransferBoot'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './overrides.css'
import { bootUniversity } from './universityBoot'

// App and everything it imports read the university config when they load:
// imported once bootUniversity() has filled it.
bootUniversity()
  .then(() => import('./App.jsx'))
  .then((module) => {
    const App = module.default
    createRoot(document.getElementById('root')).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
