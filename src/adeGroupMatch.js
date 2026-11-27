// The planning (ADE) group of a student whose planning account was never
// set up (no group of its own, so nothing to start the onboarding from):
// found from their ScoDoc group instead. Pure, see tests/adeGroupMatch.test.js.

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// Among ADE search results ({ id, name, path }, path dot-separated from
// "Ressources"), the one student group named `alias`, or starting with it
// ("3B3" → "3B3 MMI", "2B2" → "2B2-Dev MMI"). Several of them (another
// programme's "3B3"): the one under the student's programme
// (`programHints`, e.g. ScoDoc's "BUT MMI"). Null unless exactly one.
export function pickAdeGroupForAlias(results, alias, programHints = []) {
  const wanted = normalize(alias)
  if (!wanted) {
    return null
  }

  const matches = (Array.isArray(results) ? results : []).filter((result) => {
    const segments = String(result?.path ?? '').split('.').map(normalize)
    if (!segments.includes('etudiants')) {
      return false
    }

    const name = normalize(result?.name)
    return name === wanted || name.split(/[\s-]/)[0] === wanted
  })

  if (matches.length <= 1) {
    return matches[0] ?? null
  }

  const hints = programHints.map(normalize).filter(Boolean)
  const narrowed = matches.filter((result) => String(result.path ?? '').split('.').map(normalize)
    .some((segment) => hints.some((hint) => segment.includes(hint))))
  return narrowed.length === 1 ? narrowed[0] : null
}

// A name as ScoDoc's group reads it: whole, or its first part ("2B1 MMI",
// "2B2-StratUX MMI" → "2b1", "2b2").
function namesGroup(name, wanted) {
  const normalized = normalize(name)
  return normalized === wanted || normalized.split(/[\s-]/)[0] === wanted
}

const compact = (value) => normalize(value).replace(/[^a-z0-9]/g, '')

// ScoDoc's TP group among the groups under a year of the planning's tree
// (the group picker's nodes: { id, name, children }), with the folder above
// it, its TD. The TP decides: ScoDoc's TD can be another partition's name
// than ADE's folder (Lannion's BUT MMI: ScoDoc says TD « 2A », TP « 2B1 »,
// which ADE files under « 2B MMI »). The first of `aliases` that names a
// group there, groups only (no folder). Several named so (« 2B2-StratUX
// MMI », « 2B2-DWeb MMI » for « 2B2 »): `current` when it is one of them
// (ScoDoc agrees), else the one holding one of `hints` (ScoDoc's other
// groups: its parcours « Strat-UX »), none when that doesn't settle it.
// → { tp, td } | null.
export function findTpUnderYear(year, aliases, { hints = [], current = null } = {}) {
  const leaves = []
  const walk = (node) => {
    for (const child of node?.children ?? []) {
      if ((child.children ?? []).length === 0) leaves.push({ tp: child, td: node })
      else walk(child)
    }
  }
  walk(year)
  const hinted = hints.map(compact).filter((hint) => hint.length >= 3)
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    const wanted = normalize(alias)
    if (!wanted) continue
    const matches = leaves.filter(({ tp }) => namesGroup(tp.name, wanted))
    if (matches.length === 0) continue
    if (matches.length === 1) return matches[0]
    const agreed = matches.find(({ tp }) => current != null && String(tp.id) === String(current))
    if (agreed) return agreed
    // A hint that singles one out (« Strat-UX »; « 2B2 » names them all).
    for (const hint of hinted) {
      const byHint = matches.filter(({ tp }) => compact(tp.name).includes(hint))
      if (byHint.length === 1) return byHint[0]
    }
    return null
  }
  return null
}
