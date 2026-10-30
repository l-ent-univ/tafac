// The logo shown next to Tafac's (sidebar, header): the student's
// establishment's when its config has one (establishments.byId[id].logo, an
// IUT on its own campus, say), else the university's (branding.logo). Pure:
// the config is passed in, so the tests run it straight in Node.
//
// Fields, on an establishment or on branding:
// - logo: the image (client.js import);
// - logoDark: optional, its dark-mode version. Without it, the logo is
//   inverted in dark mode (fine for a one-colour logo, not for colours);
// - logoAlt: optional, its alternative text (an establishment's defaults to
//   its label);
// - logoShape: 'wide' (default, a wordmark) or 'square' (a badge), shown
//   taller so it reads at the size of a wordmark.

export function resolveLogo(config, establishment = null) {
  const branding = config?.branding ?? {}
  const own = establishment ? config?.establishments?.byId?.[establishment] : null

  if (own?.logo) {
    return {
      src: own.logo,
      srcDark: own.logoDark ?? null,
      alt: own.logoAlt ?? own.label ?? '',
      shape: own.logoShape === 'square' ? 'square' : 'wide',
      establishment,
    }
  }

  if (!branding.logo) return null

  return {
    src: branding.logo,
    srcDark: branding.logoDark ?? null,
    alt: branding.logoAlt ?? config?.university?.name ?? '',
    shape: branding.logoShape === 'square' ? 'square' : 'wide',
    establishment: null,
  }
}
