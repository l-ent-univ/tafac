// How the server tells a signed-in portal session from a lapsed one, per
// portal software (universities/<id>/server.js → auth.portal):
//   'uportal' (default): /api/v4-3/dlm/layout.json answers authenticated: "true".
//   'drupal': the entry page renders with the `user-logged-in` body class,
//     which Drupal core adds for every signed-in user. A lapsed session
//     redirects to the CAS instead (the portal forces the login).
export const PORTAL_KINDS = ['uportal', 'drupal']

export function resolvePortalKind(auth) {
  const kind = auth?.portal ?? 'uportal'
  if (!PORTAL_KINDS.includes(kind)) {
    throw new Error(`Unknown auth.portal "${kind}". Expected one of: ${PORTAL_KINDS.join(', ')}.`)
  }
  return kind
}

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

// Name on the Drupal profile page (/user → /user/<uid>): one "Prénom Nom"
// field (Rennes 2: field_nomprenom). The first word is taken as the given
// name, so a two-word first name without a hyphen ends up in family_name.
export function parseDrupalProfileName(html, fieldName = 'field-nomprenom') {
  if (typeof html !== 'string') {
    return null
  }

  const pattern = new RegExp(`<div[^>]*\\bfield--name-${fieldName}\\b[^>]*>([^<]*)</div>`, 'i')
  const match = html.match(pattern)
  const name = match ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim() : ''
  if (!name) {
    return null
  }

  const [givenName, ...rest] = name.split(' ')
  return {
    name,
    given_name: givenName,
    family_name: rest.join(' ') || null,
  }
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function readAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))
  return match ? decodeEntities(match[1]) : ''
}

// Tool catalogue of a Drupal portal (Rennes 2: /tous-outils, view "outils"):
// an <h3> per category, then one div.outil[about="/outil/<slug>"] per tool,
// whose first link is the tool (name in the link, description in its title)
// and an optional second one its documentation. Relative links point to the
// portal. Returns [{ title, tools: [{ id, title, description, href }] }].
export function parseDrupalToolCatalogue(html, portalOrigin) {
  if (typeof html !== 'string') {
    return []
  }

  const start = html.indexOf('view-id-outils')
  const end = html.indexOf('</main>', start)
  const view = start === -1 ? '' : html.slice(start, end === -1 ? undefined : end)

  return view.split(/<h3\b[^>]*>/i).slice(1).map((chunk) => {
    const title = stripTags(chunk.slice(0, chunk.search(/<\/h3>/i)))
    const tools = []

    for (const block of chunk.split(/(?=<div\b[^>]*\babout="\/outil\/)/i).slice(1)) {
      const slug = block.match(/^<div\b[^>]*\babout="\/outil\/([^"]+)"/i)?.[1]
      const link = block.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i)
      if (!slug || !link) {
        continue
      }

      let href = ''
      try {
        href = new URL(readAttribute(link[1], 'href'), portalOrigin).toString()
      } catch {
        continue
      }

      const name = stripTags(link[2])
      if (!name || !/^https?:\/\//i.test(href)) {
        continue
      }

      const description = readAttribute(link[1], 'title').trim()
      tools.push({ id: slug, title: name, description: description === name ? '' : description, href })
    }

    return { title, tools }
  }).filter((section) => section.title && section.tools.length > 0)
}

// The catalogue as a uPortal layout.json, the shape the applications grid
// reads (same as the demo account's, src/demoAccount.js). Every tool opens
// in a new tab.
export function buildDrupalLayout(sections, user = null) {
  const folders = sections.map((section, index) => ({
    _objectType: 'folder',
    ID: `portal-folder-${index + 1}`,
    name: section.title,
    content: section.tools.map((tool) => ({
      _objectType: 'portlet',
      ID: `portal-tool-${tool.id}`,
      nodeId: `portal-tool-${tool.id}`,
      title: tool.title,
      name: tool.title,
      description: tool.description,
      portletName: 'app-launcher',
      typeID: '2',
      parameters: {
        launchUrl: tool.href,
        description: tool.description,
        target: '_blank',
        stopImmediately: 'true',
      },
      url: tool.href,
      target: '_blank',
    })),
  }))

  return {
    authenticated: 'true',
    user,
    layout: {
      navigation: {
        tabs: [{ ID: 'portal-tab-tools', name: 'Outils', content: folders }],
      },
    },
  }
}

export function isDrupalSignedInPage(status, html) {
  if (status !== 200 || typeof html !== 'string') {
    return false
  }

  const body = html.match(/<body\b[^>]*\bclass\s*=\s*["']([^"']*)["']/i)
  return Boolean(body && /(?:^|\s)user-logged-in(?:\s|$)/.test(body[1]))
}
