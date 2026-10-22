import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import { getMailPreferences, saveMailPreferences } from './mailPreferences'
import RichTextEditor from './RichTextEditor'

export default function MailPreferencesModal({ isOpen, onClose, onSaved }) {
  const [prefs, setPrefs] = useState(getMailPreferences)
  const [signatureHtml, setSignatureHtml] = useState(prefs.signatureHtml)
  const [signatureEnabled, setSignatureEnabled] = useState(prefs.signatureEnabled)
  const [autoBcc, setAutoBcc] = useState(prefs.autoBcc)
  const [bccEmail, setBccEmail] = useState(prefs.bccEmail)
  const [confirmBeforeSend, setConfirmBeforeSend] = useState(prefs.confirmBeforeSend)
  const [savedSuccess, setSavedSuccess] = useState(false)

  useEffect(() => {
    if (isOpen) {
      const current = getMailPreferences()
      setPrefs(current)
      setSignatureHtml(current.signatureHtml)
      setSignatureEnabled(current.signatureEnabled)
      setAutoBcc(current.autoBcc)
      setBccEmail(current.bccEmail)
      setConfirmBeforeSend(current.confirmBeforeSend)
      setSavedSuccess(false)
    }
  }, [isOpen])

  const handleSave = () => {
    const updated = saveMailPreferences({
      signatureEnabled,
      signatureHtml,
      autoBcc,
      bccEmail: bccEmail.trim(),
      confirmBeforeSend,
    })
    setSavedSuccess(true)
    onSaved?.(updated)
    setTimeout(() => {
      onClose?.()
    }, 800)
  }

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mail-prefs-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-5 backdrop-blur-xs animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-[680px] flex-col overflow-hidden rounded-[26px] border border-white/60 dark:border-white/10 bg-widget-bg shadow-2xl backdrop-blur-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 bg-bg-subtle/50">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-brand/10 text-brand shadow-2xs">
              <Icon icon="carbon:settings-adjust" className="size-5" />
            </div>
            <div>
              <h2 id="mail-prefs-title" className="m-0 text-[18px] font-bold text-text">
                Préférences d'envoi des e-mails
              </h2>
              <p className="m-0 text-[12px] text-text-muted">
                Personnalise ta signature et tes options d'envoi par défaut
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

        {savedSuccess && (
          <div className="flex items-center gap-2 bg-emerald-500/15 border-b border-emerald-500/30 px-6 py-2.5 text-[13px] font-bold text-emerald-600 dark:text-emerald-400 animate-fadeIn">
            <Icon icon="carbon:checkmark-filled" className="size-4" />
            <span>Préférences enregistrées avec succès !</span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          {/* Section Signature */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="m-0 text-[15px] font-bold text-text flex items-center gap-2">
                  <Icon icon="carbon:signature" className="size-4 text-brand" />
                  Signature automatique
                </h3>
                <p className="m-0 text-[12px] text-text-muted">
                  Insérée automatiquement à la fin de chaque nouveau message ou réponse
                </p>
              </div>

              {/* Toggle Switch */}
              <button
                type="button"
                role="switch"
                aria-checked={signatureEnabled}
                onClick={() => setSignatureEnabled(!signatureEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  signatureEnabled ? 'bg-brand' : 'bg-zinc-300 dark:bg-zinc-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block size-5 rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    signatureEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {signatureEnabled && (
              <div className="flex flex-col gap-2 pt-2 animate-fadeIn">
                <span className="text-[12px] font-semibold text-text-muted uppercase tracking-wider">
                  Contenu de la signature
                </span>
                <RichTextEditor
                  value={signatureHtml}
                  onChange={setSignatureHtml}
                  placeholder="Écris ta signature ici (Nom, prénom, formation, téléphone...)"
                  minHeight="140px"
                />
              </div>
            )}
          </div>

          <div className="h-px w-full bg-border" />

          {/* Section Options d'envoi */}
          <div className="flex flex-col gap-4">
            <h3 className="m-0 text-[15px] font-bold text-text flex items-center gap-2">
              <Icon icon="carbon:send-alt" className="size-4 text-brand" />
              Options d'envoi
            </h3>

            {/* Auto BCC */}
            <div className="flex flex-col gap-2">
              <label className="flex items-start justify-between gap-3 cursor-pointer">
                <div className="flex flex-col">
                  <span className="text-[14px] font-semibold text-text">
                    Copie cachée automatique (Cci)
                  </span>
                  <span className="text-[12px] text-text-muted">
                    T'envoyer systématiquement une copie cachée à chaque e-mail envoyé
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={autoBcc}
                  onChange={(e) => setAutoBcc(e.target.checked)}
                  className="mt-1 size-4 rounded accent-brand cursor-pointer"
                />
              </label>

              {autoBcc && (
                <div className="mt-1 pl-1 animate-fadeIn">
                  <input
                    type="email"
                    value={bccEmail}
                    onChange={(e) => setBccEmail(e.target.value)}
                    placeholder="Adresse pour la copie (ex: mon.adresse@univ-rennes.fr)"
                    className="w-full h-9 px-3 rounded-xl border border-border bg-bg-subtle text-[13px] text-text placeholder:text-text-muted focus:border-brand focus:outline-none"
                  />
                </div>
              )}
            </div>

            {/* Confirm before send */}
            <label className="flex items-start justify-between gap-3 cursor-pointer pt-1">
              <div className="flex flex-col">
                <span className="text-[14px] font-semibold text-text">
                  Confirmation avant envoi
                </span>
                <span className="text-[12px] text-text-muted">
                  Afficher une alerte de confirmation avant d'expédier un e-mail
                </span>
              </div>
              <input
                type="checkbox"
                checked={confirmBeforeSend}
                onChange={(e) => setConfirmBeforeSend(e.target.checked)}
                className="mt-1 size-4 rounded accent-brand cursor-pointer"
              />
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-border px-6 py-4 bg-bg-subtle/50">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-[14px] font-medium text-text-muted hover:text-text hover:bg-bg-subtle transition-colors cursor-pointer"
          >
            Annuler
          </button>

          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-2 rounded-xl bg-brand text-bg px-5 py-2 text-[14px] font-bold shadow-xs hover:opacity-90 active:scale-95 transition-all cursor-pointer"
          >
            <Icon icon="carbon:checkmark" className="size-4" />
            <span>Enregistrer les préférences</span>
          </button>
        </div>
      </div>
    </div>
  )
}
