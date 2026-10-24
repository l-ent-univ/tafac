import './settingsTransferBoot'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './overrides.css'
import App from './App.jsx'

const root = createRoot(document.getElementById('root'))
// Dev only: /copy edits the landing page's strings, /copy/preview shows the
// landing alone (LandingCopyEditor). Left out of the build.
const devCopyPage = import.meta.env.DEV ? window.location.pathname.replace(/\/+$/, '') : ''

if (devCopyPage === '/copy' || devCopyPage === '/copy/preview') {
  import('./components/LandingCopyEditor').then((module) => {
    const LandingCopyPage = module.default
    root.render(
      <StrictMode>
        <LandingCopyPage preview={devCopyPage === '/copy/preview'} />
      </StrictMode>,
    )
  })
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
