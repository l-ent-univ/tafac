import { useCallback, useEffect, useRef, useState } from 'react'
import { DebugButton, DebugSegmented } from './DebugControls'
import { buildLocalStorageDebugSnapshot, copyTextToClipboard, prettyPrint } from './debugUtils'

const OUTPUT_TABS = [['api', 'Appels'], ['storage', 'Stockage local']]

// The menu's output: the last call's raw JSON (« Appels ») or what this app
// keeps in localStorage, with a copy button.
export default function DebugOutput({ id, debugState, tab, onTabChange, imagePreview, sessionUser }) {
  const [copyState, setCopyState] = useState('idle')
  const copyTimeoutRef = useRef(null)

  useEffect(() => () => {
    if (copyTimeoutRef.current !== null) {
      window.clearTimeout(copyTimeoutRef.current)
    }
  }, [])

  const isStorage = tab === 'storage'
  const output = isStorage
    ? prettyPrint(buildLocalStorageDebugSnapshot(sessionUser))
    : prettyPrint(debugState.payload ?? {
      label: 'Debug',
      capturedAt: new Date().toISOString(),
      error: '',
      data: { message: 'Aucune sortie disponible.' },
    })
  const title = isStorage ? 'Stockage local' : (debugState.label || 'Sortie JSON')
  const description = isStorage
    ? 'Clés locales du compte, des réglages et des caches de l’app'
    : 'Sortie JSON brute des appels locaux et proxifiés'

  const handleCopy = useCallback(async () => {
    if (!output) {
      return
    }

    try {
      await copyTextToClipboard(output)
      setCopyState('copied')
    } catch {
      setCopyState('error')
    }

    if (copyTimeoutRef.current !== null) {
      window.clearTimeout(copyTimeoutRef.current)
    }

    copyTimeoutRef.current = window.setTimeout(() => {
      setCopyState('idle')
      copyTimeoutRef.current = null
    }, 1600)
  }, [output])

  return (
    <section id={id} className="flex min-h-0 min-w-0 flex-1 scroll-mt-1 flex-col gap-[7px]" aria-label="Sortie">
      <h2 className="m-0 px-1 font-body text-[13px] font-semibold leading-none text-text-60 xl:hidden">Sortie</h2>
      <div className="card-corners-sm flex min-h-[440px] flex-1 flex-col overflow-hidden border border-border bg-widget-bg xl:min-h-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 max-md:px-3">
          <DebugSegmented label="Sortie" options={OUTPUT_TABS} value={tab} onChange={onTabChange} />
          <div className="flex items-center gap-2">
            {!isStorage && debugState.loading ? <span className="font-body text-[13px] font-medium text-text-60">Chargement…</span> : null}
            <DebugButton onClick={() => void handleCopy()} disabled={!output}>
              {copyState === 'copied' ? 'Copié' : copyState === 'error' ? 'Réessayer' : 'Copier'}
            </DebugButton>
          </div>
        </div>

        <div className="flex flex-col gap-[3px] px-4 pt-3 pb-3 max-md:px-3">
          <strong className="font-body text-[15px] font-semibold leading-[1.2] text-text break-words">{title}</strong>
          <span className="font-body text-[12.5px] font-medium leading-[1.35] text-text-60">{description}</span>
        </div>

        {!isStorage && debugState.error ? (
          <p className="mx-3 mt-0 mb-3 corners-[14px] bg-error-bg px-3 py-2 font-body text-[13px] font-medium text-error break-words">{debugState.error}</p>
        ) : null}
        {!isStorage && imagePreview ? (
          <div className="mx-3 mb-3 flex items-center gap-3 corners-[16px] border border-border bg-bg p-3">
            <img
              src={imagePreview.src}
              alt="Photo de profil"
              className="h-16 w-16 shrink-0 rounded-full border border-border bg-bg-subtle object-cover"
            />
            <div className="min-w-0 font-body">
              <p className="m-0 text-[14px] font-semibold text-text">Photo détectée</p>
              <p className="m-0 mt-1 text-[12.5px] text-text-60 break-all">{imagePreview.fieldPath}</p>
              <p className="m-0 mt-[2px] text-[12.5px] text-text-60">Source : {imagePreview.kind}</p>
            </div>
          </div>
        ) : null}

        <pre className="mx-3 mt-0 mb-3 min-h-0 flex-1 overflow-auto corners-[16px] border border-border bg-bg p-3 font-mono text-[12px] leading-[1.5] text-text whitespace-pre-wrap [overflow-wrap:anywhere]">{output}</pre>
      </div>
    </section>
  )
}
