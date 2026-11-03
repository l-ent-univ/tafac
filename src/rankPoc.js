// Proof of concept, off by default: the semester rank where the department
// hides ranks. ScoDoc sends it anyway (seen on a Rennes relevé, 2026-11-03):
// the « Moyenne générale » card can show it, marked as hidden, with an
// estimate from the promo's spread (src/rankEstimate.js) to compare; where
// none is sent, the estimate alone. Turned on per browser:
//   localStorage.setItem('l-ent:poc-rank', '1')
// A developer's switch, not a setting: not transferred nor kept per
// university.

import { parseGradeNumber, readHiddenRank, summarizeAverage } from './gradesReport.js'
import { estimateRank } from './rankEstimate.js'

export const RANK_POC_KEY = 'l-ent:poc-rank'

export function isRankPocOn() {
  try {
    return globalThis.localStorage?.getItem(RANK_POC_KEY) === '1'
  } catch {
    return false
  }
}


// What the card shows (null for nothing): `hidden`, the rank ScoDoc sent
// though the department hides it ({ value, total }); `estimate`, the one
// the promo's spread gives ({ position, total }), from ScoDoc's semester
// average (or Tafac's own when the department hides it too) and the promo's
// lowest, mean and highest. The size of the promo comes with the rank.
export function describePocRank(releve) {
  const hidden = readHiddenRank(releve)
  const notes = releve?.semestre?.notes ?? {}
  const average = parseGradeNumber(notes.value) ?? summarizeAverage(releve)?.average ?? null
  const total = hidden?.total ?? (Number.parseInt(releve?.semestre?.rang?.total, 10) || null)
  const estimate = average == null || !total
    ? null
    : estimateRank({ average, min: parseGradeNumber(notes.min), moy: parseGradeNumber(notes.moy), max: parseGradeNumber(notes.max), total })
  return hidden || estimate ? { hidden, estimate } : null
}
