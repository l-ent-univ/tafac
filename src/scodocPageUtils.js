import universityConfig from '@university'
import { getRequestErrorKind } from './entApi'

// Shared by the ScoDoc pages ("Mes notes", "Absences").

export const CARD_CLASSES = 'widget-card widget-card-visible border bg-widget-bg card-corners'
// In the Simuler button's material (.material, without its rainbow: see
// components/Material.jsx).
export const SECONDARY_BUTTON = 'material inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 font-body text-[14px] font-semibold text-text no-underline'
export const HELP_TOUR_BUTTON = 'size-9 p-0 inline-flex items-center justify-center rounded-full border border-border/80 bg-widget-bg text-text shadow-xs backdrop-blur-md transition-all duration-150 hover:bg-bg-subtle hover:text-brand hover:border-brand/40 hover:scale-105 active:scale-95 cursor-pointer'

// Cards rise in one after another on arrival, like the dashboard widgets
// (see .grades-reveal in overrides.css). Capped so late cards don't lag.
const MAX_REVEAL_ORDER = 8

export function revealStyle(order = 0) {
  return { '--reveal-order': Math.min(order, MAX_REVEAL_ORDER) }
}

export function parseIsoDate(value) {
  if (!value) return null
  // Date-only strings are local days, not UTC midnight.
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatShortDate(value) {
  const date = parseIsoDate(value)
  if (!date) return null
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(sameYear ? null : { year: 'numeric' }) })
}

export function formatLongDate(value) {
  const date = parseIsoDate(value)
  return date ? date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) : null
}

// The secretariat that receives justifications for a department: the
// university config (per department, then `default`), else the address the
// passerelle itself provides, if any.
export function getSecretariatEmail(department, config) {
  const table = universityConfig.grades?.absenceSecretariats ?? {}
  const email = table[department] ?? table.default ?? config?.absence_secretariat ?? null
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

export function describeLoadError(data, error) {
  if (data && data.authenticated === false && !data.error) {
    return 'Ta session a expiré. Reconnecte-toi pour retrouver tes données ScoDoc.'
  }

  if (data?.unavailable) {
    return "Aucun relevé ScoDoc n'est associé à ton compte (les notes de ta formation sont peut-être sur Pégase ou l'ENT)."
  }

  const kind = error ? getRequestErrorKind(error) : data?.errorKind
  if (kind === 'network' || kind === 'timeout') {
    return 'Impossible de joindre le serveur. Vérifie ta connexion puis réessaie.'
  }

  return 'ScoDoc ne répond pas pour le moment. Réessaie dans quelques minutes, ou ouvre-le directement.'
}
