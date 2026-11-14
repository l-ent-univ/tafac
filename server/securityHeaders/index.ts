// The production server's security headers: the ones every answer carries
// (baseline.ts) and the page's Content-Security-Policy (pagePolicy.ts).
// Set by server.js; the Vite development server sends neither (its page
// loads scripts a policy would refuse).
export { BASELINE_HEADERS, baselineSecurityHeaders } from './baseline.ts'
export { CONNECT_SOURCES, buildPagePolicy, hashInlineScripts } from './pagePolicy.ts'
