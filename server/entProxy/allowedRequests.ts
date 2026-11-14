// What the page asks the portal through the proxy (src/entApi.js: getLayout,
// getLayoutDoc, getMarketplaceEntries, getPortletMetadata,
// getPortletFragment; src/components/AvailableApplications.jsx: the
// favourites). Nothing else is relayed as an API call: a new call of the page
// gets its line here.
import type { PortalPath } from './portalPath.ts'

export type ApiMethod = 'GET' | 'POST'

interface AllowedRequest {
  method: ApiMethod
  pathname: RegExp
  // The query's own rule, when the path alone says too little.
  query?: (params: URLSearchParams) => boolean
}

// uPortal's layout servlet does much more (adding and removing tabs,
// columns, portlets): only the two moves a favourite takes.
const FAVOURITE_ACTIONS = new Set(['movePortletAjax', 'moveElement'])

const ALLOWED_REQUESTS: AllowedRequest[] = [
  { method: 'GET', pathname: /^\/api\/v4-3\/dlm\/layout\.json$/ },
  { method: 'GET', pathname: /^\/api\/layoutDoc$/ },
  { method: 'GET', pathname: /^\/api\/marketplace\/entries\.json$/ },
  { method: 'GET', pathname: /^\/api\/portlet\/[^/]+\.json$/ },
  { method: 'GET', pathname: /^\/api\/v4-3\/portlet\/[^/]+\.html$/ },
  {
    method: 'POST',
    pathname: /^\/api\/layout$/,
    query: (params) => FAVOURITE_ACTIONS.has(params.get('action') ?? ''),
  },
]

export function isApiMethod(method: string): method is ApiMethod {
  return method === 'GET' || method === 'POST'
}

export function isAllowedApiRequest(method: ApiMethod, path: PortalPath): boolean {
  return ALLOWED_REQUESTS.some((allowed) => (
    allowed.method === method
    && allowed.pathname.test(path.pathname)
    && (!allowed.query || allowed.query(new URLSearchParams(path.search)))
  ))
}
