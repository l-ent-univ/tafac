// index.html carries %LENT_*% placeholders (title, description, link
// previews, structured data) and __PUBLIC_ORIGIN__. The build keeps them: one
// build serves every university, and the server fills them as it sends the
// page (server.js), with the neutral Tafac text when it serves every
// university or the university's own when it serves one. The dev and preview
// servers fill them the same way (vite.config.js).

export function fillBrandingPlaceholders(html, branding) {
  const replacements = {
    LENT_APP_NAME: branding.appName,
    LENT_SEO_TITLE: branding.seoTitle,
    LENT_SEO_DESCRIPTION: branding.seoDescription,
    LENT_REPO_URL: branding.about?.repoUrl ?? '',
    LENT_ALTERNATE_NAMES_JSON: JSON.stringify(branding.alternateNames ?? []),
  }

  return html.replace(/%(LENT_[A-Z_]+)%/g, (match, token) => replacements[token] ?? match)
}

// `origin`: the site's address, or '' to leave the links relative.
export function fillPublicOrigin(html, origin) {
  return html.replaceAll('__PUBLIC_ORIGIN__', origin)
}

// The page's own address in its canonical link and link previews (og:url,
// twitter:url), `path` like '/rennes'; the site's address in the structured
// data stays the home page. Before fillPublicOrigin.
export function fillPagePath(html, path) {
  return html
    .replaceAll('href="__PUBLIC_ORIGIN__/"', `href="__PUBLIC_ORIGIN__${path}"`)
    .replaceAll('content="__PUBLIC_ORIGIN__/"', `content="__PUBLIC_ORIGIN__${path}"`)
}
