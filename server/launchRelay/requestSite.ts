// Whether a request was started by another site (a link in a mail read
// elsewhere, a page somewhere), as the browser says in Sec-Fetch-Site.
//
// The launch relay (/__ent_auth/launch, launch-preview) asks the
// university's services with the student's session. A link to it from
// another site would make those requests without the student having asked
// for anything here, so such a request is treated as signed out: the
// browser goes to the service itself. `none` is the student's own doing (an
// address typed, a bookmark); no header at all is an old browser or the
// desktop app's bridge.
export function isCrossSiteRequest(headers: Record<string, string | string[] | undefined>): boolean {
  const value = headers['sec-fetch-site']
  const site = (Array.isArray(value) ? value[0] ?? '' : value ?? '').trim().toLowerCase()
  return site !== '' && site !== 'same-origin' && site !== 'none'
}
