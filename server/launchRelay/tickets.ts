// The launch preview tells the page how a service signs in (through the
// CAS or not), with the addresses the server went through. One of them may
// carry a CAS service ticket, which signs in to that service once: the page
// only needs to know there is one, so its value never leaves the server.
const TICKET_VALUE = /([?&]ticket=)[^&#\s]*/gi

export function redactTickets(url: unknown): unknown {
  return typeof url === 'string' ? url.replace(TICKET_VALUE, '$1ST-redacted') : url
}

interface LaunchStep {
  url?: unknown
  location?: unknown
}

export function redactLaunchPreview<Preview extends { finalUrl?: unknown; chain?: unknown }>(preview: Preview): Preview {
  const chain = Array.isArray(preview.chain)
    ? preview.chain.map((step: LaunchStep) => ({ ...step, url: redactTickets(step?.url), location: redactTickets(step?.location) }))
    : preview.chain
  return { ...preview, finalUrl: redactTickets(preview.finalUrl), chain }
}
