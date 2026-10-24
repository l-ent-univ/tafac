import { createElement } from 'react'
import universityConfig from '@university'
import { getPapillonUrl, readPapillonDebugOverride } from './papillon'
import landingCopy from './landingCopy.json'

// Every string of the landing page, in landingCopy.json: edited by hand or on
// the dev-only /copy page (LandingCopyEditor), which writes the file back.
// The strings are plain text with a little markup, read by renderCopy:
// - {appName}, {year}: filled in here;
// - **text**: put forward (the security section's green);
// - [text](link): a link, `link` one of LINKS' names (without the repo,
//   the text alone);
// - French spacing: a space before ? ! : ; becomes a narrow no-break space,
//   and the spaces inside « » no-break ones, so the copy can be typed plain.
export const copy = landingCopy

const repoUrl = universityConfig.branding.about?.repoUrl?.replace(/\/$/, '') ?? null

const LINKS = {
  repo: repoUrl,
  issues: repoUrl ? `${repoUrl}/issues` : null,
  addUniversity: repoUrl ? `${repoUrl}/blob/main/docs/ADDING_A_UNIVERSITY.md` : null,
  papillon: getPapillonUrl(universityConfig.branding, readPapillonDebugOverride()),
}

const VARIABLES = {
  appName: universityConfig.branding.appName,
  year: String(new Date().getFullYear()),
}

const DEFAULT_LINK_CLASSES = 'font-semibold text-text underline decoration-text-30 underline-offset-[3px] transition-colors hover:decoration-text'

// The text with its variables and French spacing, as a plain string (for
// attributes, or where no markup is expected).
export function copyText(text) {
  return String(text ?? '')
    .replace(/\{(\w+)\}/g, (match, name) => VARIABLES[name] ?? match)
    .replace(/ ([?!:;])/g, '\u202f$1')
    .replace(/« /g, '«\u00a0')
    .replace(/ »/g, '\u00a0»')
}

// The text as React nodes: its links and its put-forward parts rendered.
// `strongClassName`, `linkClassName`: their looks.
export function renderCopy(text, { strongClassName = 'font-semibold', linkClassName = DEFAULT_LINK_CLASSES } = {}) {
  const source = copyText(text)
  const nodes = []
  const pattern = /\[([^\]]+)\]\((\w+)\)|\*\*([^*]+)\*\*/g
  let lastIndex = 0
  let match

  while ((match = pattern.exec(source)) !== null) {
    if (match.index > lastIndex) nodes.push(source.slice(lastIndex, match.index))
    const [, linkText, linkName, strongText] = match
    if (strongText !== undefined) {
      nodes.push(createElement('strong', { key: match.index, className: strongClassName }, strongText))
    } else if (LINKS[linkName]) {
      nodes.push(createElement('a', {
        key: match.index,
        href: LINKS[linkName],
        target: '_blank',
        rel: 'noopener noreferrer',
        className: linkClassName,
      }, linkText))
    } else {
      nodes.push(linkText)
    }
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < source.length) nodes.push(source.slice(lastIndex))

  return nodes
}

// The link names, for the editor's help line.
export const COPY_LINK_NAMES = Object.keys(LINKS)
