import { useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { searchMailDirectory, sendMailMessage } from '../../entApi'
import { getMailPreferences } from './mailPreferences'
import MailDirectoryModal from './MailDirectoryModal'
import MailPreferencesModal from './MailPreferencesModal'
import RichTextEditor from './RichTextEditor'

const DRAFT_STORAGE_KEY = 'tafac:mail_compose_draft'

export default function MailComposeModal({
  isOpen,
  onClose,
  initialTo = '',
  initialCc = '',
  initialSubject = '',
  initialBody = '',
  origId = null,
  replyType = null,
  onSent,
}) {
  const [to, setTo] = useState(initialTo)
  const [cc, setCc] = useState(initialCc)
  const [bcc, setBcc] = useState('')
  const [showCcBcc, setShowCcBcc] = useState(Boolean(initialCc))
  const [subject, setSubject] = useState(initialSubject)
  const [bodyHtml, setBodyHtml] = useState(initialBody)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState(null)
  const [sentSuccess, setSentSuccess] = useState(false)
  const [hasDraft, setHasDraft] = useState(false)
  const [showConfirmSend, setShowConfirmSend] = useState(false)
  const [showDirectoryModal, setShowDirectoryModal] = useState(false)
  const [showPreferencesModal, setShowPreferencesModal] = useState(false)
  const [attachments, setAttachments] = useState([])
  const [activeFieldForDirectory, setActiveFieldForDirectory] = useState('to') // 'to' | 'cc' | 'bcc'

  const handleAddFiles = (fileList) => {
    const newFiles = Array.from(fileList || [])
    for (const file of newFiles) {
      if (file.size > 25 * 1024 * 1024) {
        setError(`Le fichier « ${file.name} » dépasse la taille maximale autorisée (25 Mo).`)
        continue
      }
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = reader.result ? String(reader.result).split(',')[1] : ''
        setAttachments((prev) => [
          ...prev,
          {
            name: file.name,
            size: file.size,
            type: file.type || 'application/octet-stream',
            base64,
          },
        ])
      }
      reader.readAsDataURL(file)
    }
  }

  const handleRemoveAttachment = (indexToRemove) => {
    setAttachments((prev) => prev.filter((_, idx) => idx !== indexToRemove))
  }

  // Autocomplete state
  const [suggestions, setSuggestions] = useState([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [focusedField, setFocusedField] = useState(null) // 'to' | 'cc' | 'bcc' | null
  const autocompleteTimeoutRef = useRef(null)

  const hasInitialized = useRef(false)

  // Initialize form on open
  useEffect(() => {
    if (isOpen) {
      const prefs = getMailPreferences()
      setError(null)
      setSentSuccess(false)
      setShowConfirmSend(false)
      setTo(initialTo)
      setCc(initialCc)
      setBcc(prefs.autoBcc && prefs.bccEmail ? prefs.bccEmail : '')
      setShowCcBcc(Boolean(initialCc || (prefs.autoBcc && prefs.bccEmail)))
      setSubject(initialSubject)

      // Apply initial body, or prepend empty lines + signature if new message
      if (initialBody) {
        setBodyHtml(initialBody)
      } else if (!origId && prefs.signatureEnabled && prefs.signatureHtml) {
        setBodyHtml(`<p><br/></p>${prefs.signatureHtml}`)
      } else {
        setBodyHtml('')
      }

      // Check if draft exists (only when not in reply mode)
      if (!origId) {
        try {
          const saved = localStorage.getItem(DRAFT_STORAGE_KEY)
          if (saved) {
            const parsed = JSON.parse(saved)
            if (parsed && (parsed.to || parsed.subject || parsed.bodyHtml)) {
              setHasDraft(true)
            }
          }
        } catch {
          // Ignore
        }
      }
      hasInitialized.current = true
    } else {
      hasInitialized.current = false
      setSuggestions([])
    }
  }, [isOpen, initialTo, initialCc, initialSubject, initialBody, origId])

  // Auto-save draft to localStorage (when writing new message)
  useEffect(() => {
    if (!isOpen || origId || !hasInitialized.current) return
    const timer = setTimeout(() => {
      try {
        if (to || subject || bodyHtml) {
          localStorage.setItem(
            DRAFT_STORAGE_KEY,
            JSON.stringify({ to, cc, bcc, subject, bodyHtml, savedAt: Date.now() }),
          )
        }
      } catch {
        // Ignore
      }
    }, 800)

    return () => clearTimeout(timer)
  }, [isOpen, to, cc, bcc, subject, bodyHtml, origId])

  // Autocomplete search when user types in active field
  const handleFieldChange = (field, value) => {
    if (field === 'to') setTo(value)
    else if (field === 'cc') setCc(value)
    else if (field === 'bcc') setBcc(value)

    if (autocompleteTimeoutRef.current) clearTimeout(autocompleteTimeoutRef.current)

    // Extract last token being typed (e.g. after commas)
    const tokens = value.split(/[,;]+/)
    const currentToken = (tokens[tokens.length - 1] || '').trim()

    if (currentToken.length >= 2) {
      setLoadingSuggestions(true)
      autocompleteTimeoutRef.current = setTimeout(async () => {
        try {
          const matches = await searchMailDirectory(currentToken)
          setSuggestions(matches.slice(0, 6))
        } catch {
          setSuggestions([])
        } finally {
          setLoadingSuggestions(false)
        }
      }, 250)
    } else {
      setSuggestions([])
      setLoadingSuggestions(false)
    }
  }

  const handleSelectSuggestion = (contact) => {
    const emailToInsert = contact.email
    if (focusedField === 'cc') {
      const parts = cc.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
      parts.pop() // remove last token
      parts.push(emailToInsert)
      setCc(parts.join(', ') + ', ')
    } else if (focusedField === 'bcc') {
      const parts = bcc.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
      parts.pop()
      parts.push(emailToInsert)
      setBcc(parts.join(', ') + ', ')
    } else {
      const parts = to.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
      parts.pop()
      parts.push(emailToInsert)
      setTo(parts.join(', ') + ', ')
    }
    setSuggestions([])
  }

  const handleDirectoryContactSelected = (contact) => {
    if (activeFieldForDirectory === 'cc') {
      setCc((prev) => (prev ? `${prev}, ${contact.email}` : contact.email))
      setShowCcBcc(true)
    } else if (activeFieldForDirectory === 'bcc') {
      setBcc((prev) => (prev ? `${prev}, ${contact.email}` : contact.email))
      setShowCcBcc(true)
    } else {
      setTo((prev) => (prev ? `${prev}, ${contact.email}` : contact.email))
    }
  }

  const handleRestoreDraft = () => {
    try {
      const saved = localStorage.getItem(DRAFT_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.to) setTo(parsed.to)
        if (parsed.cc) {
          setCc(parsed.cc)
          setShowCcBcc(true)
        }
        if (parsed.bcc) {
          setBcc(parsed.bcc)
          setShowCcBcc(true)
        }
        if (parsed.subject) setSubject(parsed.subject)
        if (parsed.bodyHtml) setBodyHtml(parsed.bodyHtml)
        setHasDraft(false)
      }
    } catch {
      // Ignore
    }
  }

  const handleDiscardDraft = () => {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY)
      setHasDraft(false)
    } catch {
      // Ignore
    }
  }

  const executeSend = async () => {
    setIsSending(true)
    setError(null)
    setShowConfirmSend(false)

    try {
      await sendMailMessage({
        to: to.trim(),
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject: subject.trim() || '(Sans objet)',
        bodyHtml,
        attachments: attachments.length ? attachments : undefined,
        origId,
        replyType,
      })

      // Clean draft
      try {
        localStorage.removeItem(DRAFT_STORAGE_KEY)
      } catch {
        // Ignore
      }

      setSentSuccess(true)
      setTimeout(() => {
        onSent?.()
        onClose?.()
      }, 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSending(false)
    }
  }

  const handleSend = (e) => {
    e?.preventDefault()
    if (!to.trim()) {
      setError('Veuillez indiquer au moins une adresse de destinataire.')
      return
    }

    const prefs = getMailPreferences()
    if (prefs.confirmBeforeSend && !showConfirmSend) {
      setShowConfirmSend(true)
      return
    }

    void executeSend()
  }

  const handleClose = () => {
    if (isSending) return
    onClose?.()
  }

  if (!isOpen) return null

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mail-composer-title"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-5 backdrop-blur-xs animate-fadeIn"
        onClick={(e) => {
          if (e.target === e.currentTarget) handleClose()
        }}
      >
        <div className="flex max-h-[92vh] w-full max-w-[860px] flex-col overflow-hidden rounded-[26px] border border-white/60 dark:border-white/10 bg-widget-bg shadow-2xl backdrop-blur-2xl transition-all">
          {/* Modal Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4 bg-bg-subtle/50">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-brand/10 text-brand shadow-2xs">
                <Icon icon={origId ? 'carbon:reply' : 'carbon:email-new'} className="size-5" />
              </div>
              <div>
                <h2 id="mail-composer-title" className="m-0 text-[18px] font-bold text-text">
                  {origId ? 'Répondre au message' : 'Nouveau message'}
                </h2>
                <p className="m-0 text-[12px] text-text-muted">
                  Envoyé depuis votre boîte universitaire (Partage / Zimbra)
                </p>
              </div>
            </div>

            {/* Header Right Actions: Annuaire, Preferences, Close */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setActiveFieldForDirectory('to')
                  setShowDirectoryModal(true)
                }}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-widget-bg hover:bg-bg-subtle px-2.5 py-1.5 text-[12px] font-semibold text-text transition-colors shadow-2xs"
                title="Consulter l'annuaire universitaire"
              >
                <Icon icon="carbon:user-multiple" className="size-3.5 text-brand" />
                <span className="max-xs:hidden">Annuaire</span>
              </button>

              <button
                type="button"
                onClick={() => setShowPreferencesModal(true)}
                className="size-8 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-subtle transition-colors cursor-pointer"
                title="Préférences d'envoi & Signature"
              >
                <Icon icon="carbon:settings-adjust" className="size-4" />
              </button>

              <button
                type="button"
                onClick={handleClose}
                className="size-8 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-subtle transition-colors cursor-pointer ml-1"
                title="Fermer"
              >
                <Icon icon="carbon:close" className="size-5" />
              </button>
            </div>
          </div>

          {/* Draft Notice if available */}
          {hasDraft && !origId && (
            <div className="flex items-center justify-between gap-3 bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 text-[13px] text-amber-700 dark:text-amber-300">
              <span className="flex items-center gap-2">
                <Icon icon="carbon:warning-alt" className="size-4 shrink-0 text-amber-500" />
                Un brouillon non envoyé a été retrouvé.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRestoreDraft}
                  className="font-bold underline hover:opacity-80"
                >
                  Restaurer
                </button>
                <span>·</span>
                <button
                  type="button"
                  onClick={handleDiscardDraft}
                  className="text-text-muted hover:text-text"
                >
                  Ignorer
                </button>
              </div>
            </div>
          )}

          {/* Success Banner */}
          {sentSuccess && (
            <div className="flex items-center gap-2.5 bg-emerald-500/15 border-b border-emerald-500/30 px-6 py-3 text-[14px] font-bold text-emerald-600 dark:text-emerald-400 animate-fadeIn">
              <Icon icon="carbon:checkmark-filled" className="size-5" />
              <span>Votre message a été envoyé avec succès !</span>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="flex items-center justify-between gap-3 bg-rose-500/10 border-b border-rose-500/20 px-6 py-3 text-[13px] text-rose-600 dark:text-rose-400 animate-fadeIn">
              <div className="flex items-center gap-2">
                <Icon icon="carbon:error" className="size-4 shrink-0" />
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-text-muted hover:text-text"
              >
                <Icon icon="carbon:close" className="size-3.5" />
              </button>
            </div>
          )}

          {/* Form Body */}
          <form onSubmit={handleSend} className="flex flex-col flex-1 overflow-y-auto p-6 gap-4">
            {/* Recipient Field */}
            <div className="flex flex-col gap-1.5 relative">
              <div className="flex items-center justify-between">
                <label htmlFor="mail-to-input" className="text-[12px] font-bold uppercase tracking-wider text-text-muted flex items-center gap-2">
                  <span>Destinataire (À) *</span>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveFieldForDirectory('to')
                      setShowDirectoryModal(true)
                    }}
                    className="text-[11px] font-semibold text-brand hover:underline"
                  >
                    (Parcourir l'annuaire)
                  </button>
                </label>
                {!showCcBcc && (
                  <button
                    type="button"
                    onClick={() => setShowCcBcc(true)}
                    className="text-[12px] font-medium text-brand hover:underline"
                  >
                    + Cc / Cci
                  </button>
                )}
              </div>

              <div className="relative">
                <input
                  id="mail-to-input"
                  type="text"
                  value={to}
                  onChange={(e) => handleFieldChange('to', e.target.value)}
                  onFocus={() => setFocusedField('to')}
                  onBlur={() => setTimeout(() => setFocusedField(null), 200)}
                  placeholder="Tape un nom ou une adresse (ex: dupont, secretariat@...)"
                  required
                  className="w-full h-11 px-3.5 rounded-xl border border-border bg-bg-subtle text-[14px] text-text placeholder:text-text-muted focus:border-brand focus:outline-none transition-colors"
                />

                {/* Autocomplete Dropdown */}
                {focusedField === 'to' && (suggestions.length > 0 || loadingSuggestions) && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 flex flex-col rounded-2xl border border-border bg-widget-bg p-2 shadow-2xl backdrop-blur-xl animate-fadeIn">
                    <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-text-muted border-b border-border mb-1 flex items-center justify-between">
                      <span>Annuaire universitaire</span>
                      {loadingSuggestions && <Icon icon="carbon:renew" className="size-3 animate-spin text-brand" />}
                    </div>
                    {suggestions.map((contact, idx) => (
                      <button
                        key={contact.email || idx}
                        type="button"
                        onMouseDown={() => handleSelectSuggestion(contact)}
                        className="flex items-center justify-between gap-2.5 rounded-xl p-2 text-left hover:bg-brand/10 transition-colors group cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="size-7 rounded-full bg-brand/15 text-brand flex items-center justify-center text-[11px] font-bold shrink-0">
                            {(contact.name?.[0] || contact.email[0]).toUpperCase()}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-[13px] font-bold text-text group-hover:text-brand transition-colors truncate">
                              {contact.name || contact.email}
                            </span>
                            <span className="text-[11px] text-text-muted truncate">
                              {contact.email} {contact.department ? `· ${contact.department}` : ''}
                            </span>
                          </div>
                        </div>
                        {contact.type && (
                          <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-bg-subtle text-text-muted shrink-0">
                            {contact.type === 'service' ? 'Service' : 'Contact'}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Optional CC / BCC */}
            {showCcBcc && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-fadeIn">
                <div className="flex flex-col gap-1.5 relative">
                  <div className="flex items-center justify-between">
                    <label htmlFor="mail-cc-input" className="text-[12px] font-bold uppercase tracking-wider text-text-muted">
                      Copie (Cc)
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveFieldForDirectory('cc')
                        setShowDirectoryModal(true)
                      }}
                      className="text-[11px] font-semibold text-brand hover:underline"
                    >
                      Annuaire
                    </button>
                  </div>
                  <input
                    id="mail-cc-input"
                    type="text"
                    value={cc}
                    onChange={(e) => handleFieldChange('cc', e.target.value)}
                    onFocus={() => setFocusedField('cc')}
                    onBlur={() => setTimeout(() => setFocusedField(null), 200)}
                    placeholder="contact@..."
                    className="w-full h-10 px-3.5 rounded-xl border border-border bg-bg-subtle text-[13px] text-text placeholder:text-text-muted focus:border-brand focus:outline-none"
                  />
                </div>

                <div className="flex flex-col gap-1.5 relative">
                  <div className="flex items-center justify-between">
                    <label htmlFor="mail-bcc-input" className="text-[12px] font-bold uppercase tracking-wider text-text-muted">
                      Copie cachée (Cci)
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveFieldForDirectory('bcc')
                        setShowDirectoryModal(true)
                      }}
                      className="text-[11px] font-semibold text-brand hover:underline"
                    >
                      Annuaire
                    </button>
                  </div>
                  <input
                    id="mail-bcc-input"
                    type="text"
                    value={bcc}
                    onChange={(e) => handleFieldChange('bcc', e.target.value)}
                    onFocus={() => setFocusedField('bcc')}
                    onBlur={() => setTimeout(() => setFocusedField(null), 200)}
                    placeholder="archivage@..."
                    className="w-full h-10 px-3.5 rounded-xl border border-border bg-bg-subtle text-[13px] text-text placeholder:text-text-muted focus:border-brand focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* Subject Field */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mail-subject-input" className="text-[12px] font-bold uppercase tracking-wider text-text-muted">
                Objet
              </label>
              <input
                id="mail-subject-input"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Objet de votre e-mail"
                className="w-full h-11 px-3.5 rounded-xl border border-border bg-bg-subtle text-[14px] font-semibold text-text placeholder:text-text-muted focus:border-brand focus:outline-none transition-colors"
              />
            </div>

            {/* Attachments Section */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                  <Icon icon="carbon:attachment" className="size-3.5" />
                  Pièces jointes {attachments.length > 0 && `(${attachments.length})`}
                </span>
                <label className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-border bg-widget-bg hover:bg-bg-subtle text-[12px] font-semibold text-text cursor-pointer transition-colors shadow-2xs">
                  <Icon icon="carbon:document-add" className="size-3.5 text-brand" />
                  <span>Ajouter un fichier</span>
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) {
                        handleAddFiles(e.target.files)
                        e.target.value = ''
                      }
                    }}
                  />
                </label>
              </div>

              {attachments.length > 0 && (
                <ul className="m-0 p-0 list-none flex flex-wrap gap-2 animate-fadeIn">
                  {attachments.map((att, idx) => (
                    <li
                      key={`${att.name}-${idx}`}
                      className="inline-flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-xl border border-border bg-widget-bg text-[12.5px] font-medium text-text shadow-2xs"
                    >
                      <Icon icon="carbon:document" className="size-4 text-brand shrink-0" />
                      <span className="max-w-[180px] truncate" title={att.name}>{att.name}</span>
                      <span className="text-[11px] text-text-muted">
                        ({att.size < 1024 * 1024 ? `${(att.size / 1024).toFixed(0)} Ko` : `${(att.size / (1024 * 1024)).toFixed(1)} Mo`})
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(idx)}
                        className="size-5 rounded-full flex items-center justify-center text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer ml-1"
                        title="Retirer cette pièce jointe"
                      >
                        <Icon icon="carbon:close" className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Rich Text Editor */}
            <div className="flex flex-col gap-1.5 flex-1 min-h-[300px]">
              <label className="text-[12px] font-bold uppercase tracking-wider text-text-muted">
                Message
              </label>
              <RichTextEditor
                value={bodyHtml}
                onChange={setBodyHtml}
                placeholder="Rédigez votre message ici…"
                minHeight="260px"
              />
            </div>
          </form>

          {/* Modal Footer */}
          <div className="flex items-center justify-between border-t border-border px-6 py-4 bg-bg-subtle/50 flex-wrap gap-3">
            <div className="flex items-center gap-2 text-[12px] text-text-muted">
              <Icon icon="carbon:cloud-check" className="size-4 text-emerald-500" />
              <span>Brouillon synchronisé</span>
            </div>

            <div className="flex items-center gap-2.5 ml-auto">
              <button
                type="button"
                onClick={handleClose}
                disabled={isSending}
                className="rounded-xl px-4 py-2.5 text-[14px] font-medium text-text-muted hover:text-text hover:bg-bg-subtle transition-colors disabled:opacity-50 cursor-pointer"
              >
                Annuler
              </button>

              <button
                type="button"
                onClick={handleSend}
                disabled={isSending || sentSuccess || !to.trim()}
                className="flex items-center gap-2 rounded-xl bg-brand text-bg px-5 py-2.5 text-[14px] font-bold shadow-md hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer"
              >
                {isSending ? (
                  <>
                    <Icon icon="carbon:renew" className="size-4 animate-spin" />
                    <span>Envoi en cours…</span>
                  </>
                ) : sentSuccess ? (
                  <>
                    <Icon icon="carbon:checkmark" className="size-4" />
                    <span>Envoyé !</span>
                  </>
                ) : (
                  <>
                    <Icon icon="carbon:send-alt" className="size-4" />
                    <span>Envoyer l'e-mail</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog before send if enabled in preferences */}
      {showConfirmSend && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-fadeIn"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-widget-bg p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-brand/10 text-brand flex items-center justify-center shrink-0">
                <Icon icon="carbon:send-alt" className="size-5" />
              </div>
              <div className="flex flex-col">
                <h3 className="m-0 text-[16px] font-bold text-text">Confirmer l'envoi de l'e-mail</h3>
                <span className="text-[12px] text-text-muted">À : {to}</span>
              </div>
            </div>

            <p className="m-0 text-[13.5px] text-text leading-relaxed">
              Êtes-vous sûr(e) de vouloir envoyer ce message avec l'objet : <strong>« {subject || '(Sans objet)'} »</strong> ?
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmSend(false)}
                className="rounded-xl px-4 py-2 text-[13px] font-medium text-text-muted hover:bg-bg-subtle transition-colors cursor-pointer"
              >
                Retourner à l'édition
              </button>
              <button
                type="button"
                onClick={() => void executeSend()}
                className="rounded-xl bg-brand text-bg px-4 py-2 text-[13px] font-bold shadow-xs hover:opacity-90 transition-all cursor-pointer"
              >
                Confirmer et envoyer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Embedded Directory Modal */}
      <MailDirectoryModal
        isOpen={showDirectoryModal}
        onClose={() => setShowDirectoryModal(false)}
        onSelectContact={handleDirectoryContactSelected}
      />

      {/* Embedded Preferences Modal */}
      <MailPreferencesModal
        isOpen={showPreferencesModal}
        onClose={() => setShowPreferencesModal(false)}
        onSaved={(newPrefs) => {
          if (!bodyHtml && newPrefs.signatureEnabled && newPrefs.signatureHtml) {
            setBodyHtml(`<p><br/></p>${newPrefs.signatureHtml}`)
          }
        }}
      />
    </>
  )
}
