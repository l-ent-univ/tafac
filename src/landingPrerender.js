// Build time only (scripts/prerender-landing.mjs, through Vite's SSR build):
// a landing page as static HTML, signed out, and its FAQ as structured data:
// for every university (the neutral config, as tafac.fr shows it at /) or
// for one (its client.js, as its /<slug> shows it). Once per module graph:
// the landing's modules read the config when they load. The server puts both in the page it sends to
// visitors without a session (server.js), so search engines and link
// previews read the landing without running the app; the app then renders
// over it.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import universityConfig from './university'
import neutralConfig from './neutralUniversity'
import { setLoadedUniversityId, setUniversityDirectory } from './universityRuntime'

const clientConfigs = import.meta.glob('../universities/*/client.js', { import: 'default' })

// `universities`: the list GET /__ent_auth/universities gives (the landing's
// « Compatible avec » strip). `universityId`: the university's page, else
// the neutral one.
export async function renderLanding({ universities = [], universityId = null } = {}) {
  const load = universityId ? clientConfigs[`../universities/${universityId}/client.js`] : null
  if (universityId && !load) throw new Error(`No client config for ${universityId}`)
  // The landing's modules read the config when they load: filled first,
  // then imported.
  Object.assign(universityConfig, load ? await load() : neutralConfig)
  setUniversityDirectory({ mode: 'multi', universities })
  setLoadedUniversityId(universityId)

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
