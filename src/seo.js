import universityConfig from '@university'
import { branding as neutralBranding } from '../universities/neutral.js'
import { getListedUniversities, getLoadedUniversityId, isMultiUniversity, readSeoPage } from './universityRuntime'

export const APP_NAME = universityConfig.branding.appName
export const APP_DEFAULT_TITLE = universityConfig.branding.defaultTitle
export const SEO_ROBOTS_CONTENT = 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'

const OG_IMAGE_PATH = '/og-image.jpg'
const STRUCTURED_DATA_SCRIPT_ID = 'seo-structured-data'

function ensureHeadNode(selector, tagName, attributes = {}) {
  let node = document.head.querySelector(selector)

  if (!node) {
    node = document.createElement(tagName)
    for (const [key, value] of Object.entries(attributes)) {
      node.setAttribute(key, value)
    }
    document.head.appendChild(node)
  }

  return node
}

function setMetaByName(name, content) {
  const meta = ensureHeadNode(`meta[name="${name}"]`, 'meta', { name })
  meta.setAttribute('content', content)
}

function setMetaByProperty(property, content) {
  const meta = ensureHeadNode(`meta[property="${property}"]`, 'meta', { property })
  meta.setAttribute('content', content)
}

function setCanonicalLink(href) {
  const link = ensureHeadNode('link[rel="canonical"]', 'link', { rel: 'canonical' })
  link.setAttribute('href', href)
}

// The site (its name and former names, for the name shown in search
// results) and the app, as index.html has them.
function buildStructuredData(siteUrl, imageUrl, branding) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: APP_NAME,
      alternateName: branding.alternateNames ?? [],
      url: siteUrl,
      inLanguage: 'fr-FR',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: APP_NAME,
      url: siteUrl,
      image: imageUrl,
      description: branding.seoDescription,
      applicationCategory: 'EducationalApplication',
      operatingSystem: 'Web, iOS, Android',
      inLanguage: 'fr-FR',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      sameAs: [universityConfig.branding.about?.repoUrl].filter(Boolean),
    },
  ]
}

function syncStructuredData(siteUrl, imageUrl, branding) {
  const script = ensureHeadNode(
    `script#${STRUCTURED_DATA_SCRIPT_ID}`,
    'script',
    { id: STRUCTURED_DATA_SCRIPT_ID, type: 'application/ld+json' },
  )

  script.textContent = JSON.stringify(buildStructuredData(siteUrl, imageUrl, branding))
}

// Signed out (the landing and login pages, the ones search engines see): the
// SEO title as it is, so the result's title is the page's.
export function syncRuntimeSeo({ authenticated = false } = {}) {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return
  }

  const loadedId = getLoadedUniversityId()
  const page = readSeoPage({
    pathname: authenticated ? '/' : window.location.pathname,
    multiUniversity: isMultiUniversity(),
    university: getListedUniversities().find((entry) => entry.id === loadedId) ?? null,
    branding: universityConfig.branding,
    neutral: neutralBranding,
  })
  const { seoTitle, seoDescription } = page.branding
  const siteUrl = new URL('/', window.location.origin).toString()
  const pageUrl = new URL(page.path, window.location.origin).toString()
  const imageUrl = new URL(OG_IMAGE_PATH, window.location.origin).toString()

  document.documentElement.setAttribute('lang', 'fr')
  document.title = authenticated ? APP_DEFAULT_TITLE : seoTitle

  setMetaByName('description', seoDescription)
  setMetaByName('robots', SEO_ROBOTS_CONTENT)
  setMetaByName('googlebot', SEO_ROBOTS_CONTENT)
  setMetaByName('twitter:card', 'summary_large_image')
  setMetaByName('twitter:title', seoTitle)
  setMetaByName('twitter:description', seoDescription)
  setMetaByName('twitter:url', pageUrl)
  setMetaByName('twitter:image', imageUrl)
  setMetaByName('twitter:image:alt', `Aperçu de l'application ${APP_NAME}`)

  setMetaByProperty('og:type', 'website')
  setMetaByProperty('og:locale', 'fr_FR')
  setMetaByProperty('og:site_name', APP_NAME)
  setMetaByProperty('og:title', seoTitle)
  setMetaByProperty('og:description', seoDescription)
  setMetaByProperty('og:url', pageUrl)
  setMetaByProperty('og:image', imageUrl)
  setMetaByProperty('og:image:alt', `Aperçu de l'application ${APP_NAME}`)

  setCanonicalLink(pageUrl)
  syncStructuredData(siteUrl, imageUrl, page.branding)
}
