import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { searchMailDirectory } from '../../entApi'

function getInitials(name) {
  if (!name) return '?'
  const clean = name.replace(/[^\p{L}\s]/gu, '').trim()
  const parts = clean.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function getAvatarColor(name) {
  let hash = 0
  for (let i = 0; i < (name || '').length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hues = [210, 260, 290, 330, 160, 190, 25, 45]
  const hue = hues[Math.abs(hash) % hues.length]
  return `hsl(${hue}, 65%, 45%)`
}

export default function MailDirectoryModal({ isOpen, onClose, onSelectContact }) {
  const [query, setQuery] = useState('')
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(false)
  const [filterType, setFilterType] = useState('all') // 'all' | 'teacher' | 'service'
  const [copiedEmail, setCopiedEmail] = useState(null)

  // Load initial contacts or search when query changes
  useEffect(() => {
    if (!isOpen) return
    let isMounted = true
    setLoading(true)

    const timer = setTimeout(async () => {
      try {
        const results = await searchMailDirectory(query)
        if (isMounted) {
          setContacts(results)
        }
      } catch {
        if (isMounted) setContacts([])
      } finally {
        if (isMounted) setLoading(false)
      }
    }, query ? 300 : 0)

    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [isOpen, query])

  const filteredContacts = useMemo(() => {
    if (filterType === 'all') return contacts
    return contacts.filter((c) => {
      if (filterType === 'teacher') return c.type === 'teacher' || /enseignant|prof|dr\./i.test(c.name || '')
      if (filterType === 'service') return c.type === 'service' || /secrétariat|scolarité|service|bureau|bu\b/i.test(c.name || '')
      return true
    })
  }, [contacts, filterType])

  const handleCopyEmail = (e, email) => {
    e.stopPropagation()
    navigator.clipboard.writeText(email).then(() => {
      setCopiedEmail(email)
      setTimeout(() => setCopiedEmail(null), 2000)
    }).catch(() => {})
  }

  const handleContactClick = (contact) => {
    onSelectContact?.(contact)
    onClose?.()
  }

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="directory-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-5 backdrop-blur-xs animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[26px] border border-white/60 dark:border-white/10 bg-widget-bg shadow-2xl backdrop-blur-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 bg-bg-subtle/50">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-brand/10 text-brand shadow-2xs">
              <Icon icon="carbon:user-multiple" className="size-5" />
            </div>
            <div>
              <h2 id="directory-modal-title" className="m-0 text-[18px] font-bold text-text">
                Annuaire universitaire
              </h2>
              <p className="m-0 text-[12px] text-text-muted">
                Recherche dans l'annuaire de l'établissement (enseignants, scolarité, services)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="size-8 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-subtle transition-colors cursor-pointer"
            title="Fermer"
          >
            <Icon icon="carbon:close" className="size-5" />
          </button>
        </div>

        {/* Search Bar & Filters */}
        <div className="border-b border-border p-5 flex flex-col gap-3 bg-bg-subtle/30">
          <div className="relative">
            <Icon
              icon="carbon:search"
              className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-text-muted pointer-events-none"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher par nom, matière, secrétariat, service…"
              autoFocus
              className="w-full h-11 pl-10 pr-9 rounded-xl border border-border bg-widget-bg text-[14px] text-text placeholder:text-text-muted focus:border-brand focus:outline-none transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text"
              >
                <Icon icon="carbon:close" className="size-4" />
              </button>
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12px] font-semibold text-text-muted mr-1">Filtrer :</span>
            {[
              { id: 'all', label: 'Tous', icon: 'carbon:list' },
              { id: 'teacher', label: 'Enseignants', icon: 'carbon:education' },
              { id: 'service', label: 'Services & Scolarité', icon: 'carbon:building' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilterType(f.id)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[12px] font-semibold transition-all cursor-pointer ${
                  filterType === f.id
                    ? 'bg-brand text-bg shadow-2xs'
                    : 'bg-bg-subtle text-text hover:bg-bg-muted'
                }`}
              >
                <Icon icon={f.icon} className="size-3.5" />
                <span>{f.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-2.5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted gap-2">
              <Icon icon="carbon:renew" className="size-6 animate-spin text-brand" />
              <span className="text-[13px] font-medium">Recherche dans l'annuaire universitaire…</span>
            </div>
          ) : filteredContacts.length > 0 ? (
            filteredContacts.map((contact, idx) => (
              <div
                key={contact.email || idx}
                onClick={() => handleContactClick(contact)}
                className="flex items-center justify-between gap-3 p-3.5 rounded-2xl border border-border bg-widget-bg hover:bg-bg-subtle/80 hover:border-brand/40 transition-all cursor-pointer group shadow-2xs"
              >
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <div
                    className="size-11 rounded-full flex items-center justify-center text-white font-bold text-[14px] shrink-0 shadow-2xs"
                    style={{ backgroundColor: getAvatarColor(contact.name || contact.email) }}
                  >
                    {getInitials(contact.name || contact.email)}
                  </div>

                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-bold text-text group-hover:text-brand transition-colors truncate">
                        {contact.name || contact.email}
                      </span>
                      {contact.type && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand/10 text-brand">
                          {contact.type === 'service' ? 'Service' : 'Enseignant'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-[12px] text-text-muted flex-wrap">
                      <span className="truncate">{contact.email}</span>
                      {contact.department && (
                        <>
                          <span>·</span>
                          <span className="truncate">{contact.department}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => handleCopyEmail(e, contact.email)}
                    className="size-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-muted transition-colors"
                    title="Copier l'adresse"
                  >
                    <Icon
                      icon={copiedEmail === contact.email ? 'carbon:checkmark' : 'carbon:copy'}
                      className="size-4"
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleContactClick(contact)}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand text-bg text-[12px] font-bold shadow-2xs hover:opacity-90 active:scale-95 transition-all"
                  >
                    <Icon icon="carbon:email" className="size-3.5" />
                    <span>Écrire</span>
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted text-center gap-2">
              <div className="size-12 rounded-full bg-bg-subtle flex items-center justify-center text-text-muted mb-1">
                <Icon icon="carbon:user-avatar" className="size-6" />
              </div>
              <span className="text-[14px] font-semibold text-text">Aucun contact trouvé</span>
              <p className="text-[12px] text-text-muted max-w-xs m-0">
                Essaie avec un nom de famille, un prénom ou le nom d'un service.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
