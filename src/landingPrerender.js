// Build time only (scripts/prerender-landing.mjs, through Vite's SSR build):
// the landing page as static HTML, signed out and for every university (the
// neutral config, as tafac.fr shows it before a university is picked), and
// its FAQ as structured data. The server puts both in the page it sends to
// visitors without a session (server.js), so search engines and link
// previews read the landing without running the app; the app then renders
// over it.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import universityConfig from './university'
import neutralConfig from './neutralUniversity'
import { setUniversityDirectory } from './universityRuntime'

// `universities`: the list GET /__ent_auth/universities gives (the landing's
// « Compatible avec » strip).
export async function renderLanding({ universities = [] } = {}) {
  // The landing's modules read the config when they load: filled first,
  // then imported.
  Object.assign(universityConfig, neutralConfig)
  setUniversityDirectory({ mode: 'multi', universities })

  const [{ default: LandingPage }, { copy, copyPlainText }] = await Promise.all([
    import('./components/LandingPage'),
    import('./landingCopy'),
  ])

  const html = renderToString(createElement(LandingPage, { onLogin: () => {} }))
  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: Object.values(copy.faq.questions).map(({ question, answer }) => ({
      '@type': 'Question',
      name: copyPlainText(question),
      acceptedAnswer: { '@type': 'Answer', text: copyPlainText(answer) },
    })),
  }

  return { html, structuredData: [faq] }
}
