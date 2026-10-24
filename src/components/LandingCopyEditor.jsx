import { useEffect, useMemo, useRef, useState } from 'react'
import { COPY_LINK_NAMES } from '../landingCopy'
import LandingPage from './LandingPage'

// Dev only (main.jsx): /copy, to edit every string of the landing page
// (src/landingCopy.json) beside a live preview; /copy/preview, the landing
// page alone, signed in or not (the preview's frame).
// Each change is saved to the file after a short pause, through the dev
// server (landing-copy-dev in vite.config.js); the preview follows by itself
// (hot reload). The file's shape is fixed: strings only, no key added or
// dropped.

const ENDPOINT = '/__dev/landing-copy'
const SAVE_DELAY_MS = 600

const SECTION_LABELS = {
  header: 'En-tête',
  hero: 'Haut de page',
  features: 'Fonctionnalités',
  security: 'Sécurité',
  faq: 'FAQ',
  beta: 'Bêta',
  papillon: 'Papillon',
  contact: 'Contact (sans Papillon)',
  footer: 'Pied de page',
  floatingWidgets: 'Widgets flottants',
}

function setAtPath(value, path, next) {
  if (path.length === 0) return next
  const [key, ...rest] = path
  const copy = Array.isArray(value) ? [...value] : { ...value }
  copy[key] = setAtPath(value[key], rest, next)
  return copy
}

// Every string of the tree, with its path, in file order.
function listFields(value, path = []) {
  if (typeof value === 'string') return [{ path, value }]
  return Object.entries(value).flatMap(([key, child]) => listFields(child, [...path, key]))
}

// A field's label: its path under the section, array indexes from 1.
function fieldLabel(path) {
  return path.slice(1).map((key) => (/^\d+$/.test(key) ? `#${Number(key) + 1}` : key)).join(' › ')
}

// A textarea as tall as its text: again once the fonts are in and whenever
// its width changes (the text wraps differently).
function CopyField({ label, value, onChange }) {
  const ref = useRef(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const fit = () => {
      element.style.height = 'auto'
      element.style.height = `${element.scrollHeight + 2}px`
    }
    fit()
    let isActive = true
    void document.fonts?.ready.then(() => isActive && fit())
    const observer = new ResizeObserver(fit)
    observer.observe(element.parentElement)
    return () => {
      isActive = false
      observer.disconnect()
    }
  }, [value])

  return (
    <label className="grid gap-1">
      <span className="text-[12px] font-semibold text-text-secondary font-body">{label}</span>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        spellCheck
        lang="fr"
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-none overflow-hidden rounded-[10px] border border-border bg-bg px-3 py-2 text-[14px] leading-snug text-text font-body focus:border-text-30 focus:outline-none"
      />
    </label>
  )
}

function LandingCopyEditor() {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [query, setQuery] = useState('')
  const saveTimeoutRef = useRef(0)

  useEffect(() => {
    fetch(ENDPOINT)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((json) => {
        setData(json)
        setStatus('saved')
      })
      .catch(() => setStatus('error'))
    return () => window.clearTimeout(saveTimeoutRef.current)
  }, [])

  const save = (next) => {
    window.clearTimeout(saveTimeoutRef.current)
    setStatus('pending')
    saveTimeoutRef.current = window.setTimeout(() => {
      setStatus('saving')
      fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
        .then((response) => setStatus(response.ok ? 'saved' : 'error'))
        .catch(() => setStatus('error'))
    }, SAVE_DELAY_MS)
  }

  const handleChange = (path, value) => {
    const next = setAtPath(data, path, value)
    setData(next)
    save(next)
  }

  const sections = useMemo(() => {
    if (!data) return []
    const needle = query.trim().toLowerCase()
    return Object.keys(data)
      .map((section) => ({
        section,
        fields: listFields(data[section], [section]).filter(({ path, value }) => (
          !needle || value.toLowerCase().includes(needle) || path.join('.').toLowerCase().includes(needle)
        )),
      }))
      .filter(({ fields }) => fields.length > 0)
  }, [data, query])

  const statusLabel = {
    loading: 'Chargement…',
    pending: 'Modifié',
    saving: 'Enregistrement…',
    saved: 'Enregistré',
    error: 'Erreur : non enregistré',
  }[status]

  return (
    <div className="flex h-svh bg-bg text-text">
      <div className="flex w-[520px] shrink-0 flex-col border-r border-border max-lg:w-full max-lg:border-r-0">
        <header className="grid gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="m-0 text-xl font-bold">Textes de la landing</h1>
            <span className={`text-[13px] font-semibold font-body ${status === 'error' ? 'text-error' : 'text-text-secondary'}`} role="status">
              {statusLabel}
            </span>
          </div>
          <input
            type="search"
            placeholder="Chercher un texte"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-full border border-border bg-bg-input px-4 py-2 text-[14px] text-text font-body focus:outline-none"
          />
          <p className="m-0 text-[12px] leading-snug text-text-secondary font-body">
            <code>{'{appName}'}</code>, <code>{'{year}'}</code> · <code>**mis en avant**</code> · <code>[texte](lien)</code>, lien parmi {COPY_LINK_NAMES.join(', ')} · les espaces avant ? ! : ; et dans « » sont mises toutes seules
          </p>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {sections.map(({ section, fields }) => (
            <section key={section} className="mb-8 grid gap-3">
              <h2 className="m-0 text-[13px] font-bold uppercase tracking-[0.06em] text-text-secondary">{SECTION_LABELS[section] ?? section}</h2>
              {fields.map(({ path, value }) => (
                <CopyField key={path.join('.')} label={fieldLabel(path)} value={value} onChange={(next) => handleChange(path, next)} />
              ))}
            </section>
          ))}
          {data && sections.length === 0 ? <p className="m-0 text-[14px] text-text-secondary font-body">Aucun texte ne correspond</p> : null}
        </div>
      </div>
      <iframe title="Aperçu de la landing" src="/copy/preview" className="h-full min-w-0 flex-1 border-0 max-lg:hidden" />
    </div>
  )
}

// /copy: the editor; /copy/preview: the landing page alone.
function LandingCopyPage({ preview = false }) {
  return preview ? <LandingPage onLogin={() => {}} /> : <LandingCopyEditor />
}

export default LandingCopyPage
