// How the app addresses the student: « vous » (the default, every
// university) or « tu » (IUT de Lannion). Set by the university's config
// (`register` in shared.js) and, for one establishment, its
// `establishments.byId.<id>.register`. Pure (no React, no @university), so
// the modules that build text (src/scodocPageUtils.js…) and their tests can
// load it.
//
// Every student-facing string that addresses the student goes through r():
//
//   r('Choisis ton université', 'Choisissez votre université')
//
// It reads the current register, set by App (setRegister) from the config
// and the signed-in student's establishment, so a string must be built when
// it's shown (in render, or in a function called then), never in a
// module-level constant: that one would keep the register of load time.

export const DEFAULT_REGISTER = 'vous'

const REGISTERS = new Set(['tu', 'vous'])

function normalize(value) {
  return REGISTERS.has(value) ? value : null
}

// The register for `config` (a universities/<id>/client.js or the neutral
// one) and the student's establishment id, when known: the establishment's
// `register`, else the university's, else « vous ».
export function resolveRegister(config, establishmentId = null) {
  const establishment = establishmentId ? config?.establishments?.byId?.[establishmentId] : null
  return normalize(establishment?.register) ?? normalize(config?.register) ?? DEFAULT_REGISTER
}

let current = DEFAULT_REGISTER

export function setRegister(value) {
  current = normalize(value) ?? DEFAULT_REGISTER
  return current
}

export function getRegister() {
  return current
}

export function isTu() {
  return current === 'tu'
}

// The form of a string for the current register: `tu` when the student is
// addressed as « tu », else `vous`.
export function r(tu, vous) {
  return current === 'tu' ? tu : vous
}
