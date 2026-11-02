import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import { searchAde } from '../entApi'
import { MAX_EXTRA_RESOURCES } from '../profileStorage'
import { MUTED_FILL_CLASSES, PRESSABLE_ROW_CLASSES, ROW_CLASSES } from '../settingsStyles'
import SettingsGroup, { RowText } from './SettingsGroup'
import LoadingDots from './LoadingDots'

const SEARCH_DELAY_MS = 300
const SHOWN_RESULTS = 8

// Where a result sits in the planning's tree, without the resource itself
// nor the tree's roots: "ENSSAT / IMR / 2e année".
function describePath(result) {
  const parts = String(result.path ?? '').split(/\s*[/>]\s*/).filter(Boolean)
  if (parts.at(-1) === result.name) parts.pop()
  return parts.filter((part) => !/^(ressources|etudiants|étudiants)$/i.test(part)).slice(-3).join(' / ') || null
}

// Réglages › Planning: courses taken beside the group (a major, a minor,
// options, an ENSSAT student's specialisation), each a resource of the
// planning found by name, its classes then shown in the planning with the
// group's. `extraResources`: those already added; `onChange` saves the list.
function PlanningExtraCourses({ extraResources, onChange }) {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState({ status: 'idle', results: [] })
  const trimmed = query.trim()
  const isFull = extraResources.length >= MAX_EXTRA_RESOURCES

  useEffect(() => {
    if (trimmed.length < 2) {
      setSearch({ status: 'idle', results: [] })
      return undefined
    }
    let cancelled = false
    setSearch((current) => ({ ...current, status: 'loading' }))
    const timer = window.setTimeout(() => {
      searchAde(trimmed)
        .then(({ results }) => {
          if (!cancelled) setSearch({ status: 'ok', results: Array.isArray(results) ? results : [] })
        })
        .catch(() => {
          if (!cancelled) setSearch({ status: 'error', results: [] })
        })
    }, SEARCH_DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [trimmed])

  const addedIds = new Set(extraResources.map((entry) => entry.resourceId))
  const results = search.results
    .filter((result) => result?.id != null && result.name && !addedIds.has(String(result.id)))
    .slice(0, SHOWN_RESULTS)

  const add = (result) => {
    onChange([...extraResources, { resourceId: String(result.id), label: String(result.name), path: describePath(result) }])
    setQuery('')
  }
  const remove = (resourceId) => onChange(extraResources.filter((entry) => entry.resourceId !== resourceId))

  return (
    <SettingsGroup
      title="Majeure, mineure et options"
      footer="Leurs cours s’ajoutent à ceux de ton groupe, dans le planning et l’accueil."
    >
      {extraResources.map((entry) => (
        <div key={entry.resourceId} className={ROW_CLASSES}>
          <RowText icon="ph:books" label={entry.label} description={entry.path} />
          <button
            type="button"
            className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full border-0 ${MUTED_FILL_CLASSES} text-text cursor-pointer transition-transform duration-100 active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text`}
            aria-label={`Retirer ${entry.label}`}
            onClick={() => remove(entry.resourceId)}
          >
            <Icon icon="ph:x" className="size-[15px]" aria-hidden="true" />
          </button>
        </div>
      ))}
      {isFull ? null : (
        <label className={ROW_CLASSES}>
          <span className="sr-only">Chercher un cours, une majeure ou une option</span>
          <span className={`flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full ${MUTED_FILL_CLASSES} px-3`}>
            <Icon icon="ph:magnifying-glass" className="size-4 shrink-0 text-text-60" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Majeure, mineure, option…"
              className="min-w-0 flex-1 border-0 bg-transparent font-body text-[15px] font-medium text-text outline-none placeholder:text-text-50"
              autoComplete="off"
              enterKeyHint="search"
            />
          </span>
        </label>
      )}
      {!isFull && trimmed.length >= 2 ? (
        search.status === 'loading' ? (
          <div className="flex h-[54px] items-center justify-center">
            <LoadingDots label="Recherche…" className="text-text-60" />
          </div>
        ) : search.status === 'error' ? (
          <p className={`${ROW_CLASSES} m-0 font-body text-[14px] font-medium text-text-60`} role="alert">La recherche n’a pas abouti</p>
        ) : results.length === 0 ? (
          <p className={`${ROW_CLASSES} m-0 font-body text-[14px] font-medium text-text-60`}>Aucun cours trouvé</p>
        ) : (
          results.map((result) => (
            <button key={result.id} type="button" className={PRESSABLE_ROW_CLASSES} onClick={() => add(result)}>
              <RowText icon="ph:plus" label={result.name} description={describePath(result)} />
            </button>
          ))
        )
      ) : null}
    </SettingsGroup>
  )
}

export default PlanningExtraCourses
