import './settingsTransferBoot'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './overrides.css'
import { bootUniversity } from './universityBoot'

const root = createRoot(document.getElementById('root'))
// Dev only: /copy edits the landing page's strings, /copy/preview shows the
// landing alone (LandingCopyEditor). Left out of the build.
const devCopyPage = import.meta.env.DEV ? window.location.pathname.replace(/\/+$/, '') : ''
const isCopyPage = devCopyPage === '/copy' || devCopyPage === '/copy/preview'

// App and everything it imports (the landing and its copy too) read the
// university config when they load: imported once bootUniversity() has
// filled it.
bootUniversity()
  .then(() => (isCopyPage ? import('./components/LandingCopyEditor') : import('./App.jsx')))
  .then((module) => {
    const Page = module.default
    root.render(
      <StrictMode>
        {isCopyPage ? <Page preview={devCopyPage === '/copy/preview'} /> : <Page />}
      </StrictMode>,
    )
  })
