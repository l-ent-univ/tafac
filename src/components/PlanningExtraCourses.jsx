import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import { getAdeTree, searchAde } from '../entApi'
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

// The planning's students node: where browsing starts.
const STUDENTS_NODE_ID = '-1'

function findNode(node, id) {
  if (!node) return null
  if (String(node.id) === String(id)) return node
  for (const child of node.children ?? []) {
    const match = findNode(child, id)
    if (match) return match
  }
  return null
}

// One level of the planning's tree: the node's children, a group or a whole
// branch (an ENSSAT student's « Commun », « Info », majeure…) each.
async function loadLevel(id) {
  const { tree } = await getAdeTree(id)
  return (findNode(tree?.root, id)?.children ?? [])
    .filter((child) => child?.id != null && child.name)
    .map((child) => ({ id: String(child.id), name: String(child.name) }))
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

  // Browsing the tree: null when closed, else the nodes opened from the
  // students' level down ([] at that level).
  const [trail, setTrail] = useState(null)
  const [level, setLevel] = useState({ status: 'idle', children: [] })
  const levelId = trail ? (trail.at(-1)?.id ?? STUDENTS_NODE_ID) : null

  useEffect(() => {
    if (!levelId) return undefined
    let cancelled = false
    setLevel({ status: 'loading', children: [] })
    loadLevel(levelId)
      .then((children) => {
        if (!cancelled) setLevel({ status: 'ok', children })
      })
      .catch(() => {
        if (!cancelled) setLevel({ status: 'error', children: [] })
      })
    return () => {
      cancelled = true
    }
  }, [levelId])

  const addedIds = new Set(extraResources.map((entry) => entry.resourceId))
  const results = search.results
    .filter((result) => result?.id != null && result.name && !addedIds.has(String(result.id)))
    .slice(0, SHOWN_RESULTS)

  const addEntry = (resourceId, label, path) => onChange([...extraResources, { resourceId, label, path }])
  const add = (result) => {
    addEntry(String(result.id), String(result.name), describePath(result))
    setQuery('')
  }
  const addFromTree = (node) => addEntry(node.id, node.name, trail.slice(-3).map(({ name }) => name).join(' / ') || null)
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
      {isFull || trimmed.length >= 2 ? null : trail === null ? (
        <button type="button" className={PRESSABLE_ROW_CLASSES} onClick={() => setTrail([])}>
          <RowText icon="ph:tree-structure" label="Parcourir le planning" description="Ajoute des groupes de plusieurs branches : commun, majeure, options…" />
          <Icon icon="ph:caret-right" className="size-4 shrink-0 text-text-60" aria-hidden="true" />
        </button>
      ) : (
        <>
          <button type="button" className={PRESSABLE_ROW_CLASSES} onClick={() => setTrail(trail.length > 0 ? trail.slice(0, -1) : null)}>
            <RowText icon="ph:arrow-left" label={trail.at(-1)?.name ?? 'Étudiants'} description={trail.length > 0 ? 'Revenir en arrière' : 'Fermer'} />
          </button>
          {level.status === 'loading' ? (
            <div className="flex h-[54px] items-center justify-center">
              <LoadingDots label="Chargement…" className="text-text-60" />
            </div>
          ) : level.status === 'error' ? (
            <p className={`${ROW_CLASSES} m-0 font-body text-[14px] font-medium text-text-60`} role="alert">Le planning n’a pas répondu</p>
          ) : level.children.length === 0 ? (
            <p className={`${ROW_CLASSES} m-0 font-body text-[14px] font-medium text-text-60`}>Pas de sous-groupe ici</p>
          ) : (
            level.children.map((node) => (
              <div key={node.id} className={`${ROW_CLASSES} pr-3`}>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 border-0 bg-transparent p-0 text-left cursor-pointer"
                  onClick={() => setTrail([...trail, node])}
                >
                  <RowText icon="ph:folder" label={node.name} />
                  <Icon icon="ph:caret-right" className="size-4 shrink-0 text-text-60" aria-hidden="true" />
                </button>
                {addedIds.has(node.id) ? (
                  <span className="inline-flex size-8 shrink-0 items-center justify-center text-success-text" aria-label={`${node.name} ajouté`}>
                    <Icon icon="ph:check-bold" className="size-[15px]" aria-hidden="true" />
                  </span>
                ) : (
                  <button
                    type="button"
                    className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full border-0 ${MUTED_FILL_CLASSES} text-text cursor-pointer transition-transform duration-100 active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text`}
                    aria-label={`Ajouter ${node.name}`}
                    onClick={() => addFromTree(node)}
                  >
                    <Icon icon="ph:plus" className="size-[15px]" aria-hidden="true" />
                  </button>
                )}
              </div>
            ))
          )}
        </>
      )}
    </SettingsGroup>
  )
}

export default PlanningExtraCourses
