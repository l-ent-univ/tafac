import { useState } from 'react'
import { plainSignatureHtml, normalizeCustomSignatureText, pickShownSignature, signatureClassName } from '../mailSignatureChoice'
import { setMailSignatureEnabled, setMailSignatureKind, useMailSignaturePrefs, useMailSignatures, writeCustomMailSignature } from '../mailSignatureStore'
import { MUTED_FILL_CLASSES, ROW_CLASSES } from '../settingsStyles'
import SettingsGroup, { RowText } from './SettingsGroup'
import MailSignatureContent from './MailSignatureContent'
import Switch from './Switch'
import SegmentedControl from './SegmentedControl'
import { r } from '../register.js'

// Réglages › Messagerie: the signature under the student's mails, on or
// off and which (src/mailSignatureStore.js, shared with the composer's
// switch), a preview of it as it goes, and the custom one's editor. The
// custom text is kept in Partage (POST /mail/signature) as its « Tafac »
// signature: on every device, and in the webmail too. « Partage » (the
// webmail's own signature) is hidden for now (mailSignatureStore.js).
const KINDS = [
  { id: 'auto', label: 'Automatique' },
  { id: 'custom', label: 'Personnalisée' },
]

const FOOTERS = {
  get auto() { return r('Faite à partir de ton compte, toujours à jour', 'Faite à partir de votre compte, toujours à jour') },
  partage: 'Celle choisie dans Partage, Préférences › Signatures',
  get custom() { return r('Enregistrée dans Partage sous le nom « Tafac », sur tous tes appareils', 'Enregistrée dans Partage sous le nom « Tafac », sur tous vos appareils') },
}

const SAVE_ERRORS = {
  'too-long': 'Signature trop longue',
  get limit() { return r('Trop de signatures dans Partage, supprimes-en une', 'Trop de signatures dans Partage, supprimez-en une') },
  get rate() { return r('Trop d’enregistrements, réessaie dans un moment', 'Trop d’enregistrements, réessayez dans un moment') },
  get expired() { return r('Session expirée, reconnecte-toi', 'Session expirée, reconnectez-vous') },
  get failed() { return r('Signature non enregistrée, réessaie', 'Signature non enregistrée, réessayez') },
}

function KindPicker({ value, onChange }) {
  return (
    <SegmentedControl
      size="sm"
      options={KINDS.map((choice) => ({ value: choice.id, label: choice.label }))}
      value={value}
      onChange={onChange}
      label="Signature utilisée"
    />
  )
}

// The custom text, written and saved by hand (one write per « Enregistrer »,
// not per key). `saved`: the text Partage has now.
function CustomSignatureEditor({ saved, maxLength, draft, onDraftChange }) {
  const [status, setStatus] = useState({ state: 'idle', code: null })
  const normalized = normalizeCustomSignatureText(draft)
  const length = Array.from(draft).length
  const changed = normalized.ok ? normalized.text !== saved : true
  const tooLong = !normalized.ok && normalized.error === 'mail_signature_too_long'

  const save = async () => {
    if (!normalized.ok || !changed) return
    setStatus({ state: 'saving', code: null })
    const result = await writeCustomMailSignature(normalized.text)
    if (result.status === 'ok') {
      onDraftChange(normalized.text)
      setStatus({ state: 'saved', code: null })
    } else {
      setStatus({ state: 'error', code: result.code })
    }
  }

  const line = status.state === 'error' ? SAVE_ERRORS[status.code] ?? SAVE_ERRORS.failed
    : tooLong ? SAVE_ERRORS['too-long']
      : status.state === 'saving' ? 'Enregistrement…'
        : status.state === 'saved' && !changed ? 'Enregistrée'
          : changed ? 'Modifications non enregistrées' : null

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-[7px]">
        <span className="font-body text-[13px] font-semibold leading-none text-text-60">{r('Ta signature', 'Votre signature')}</span>
        <textarea
          value={draft}
          onChange={(event) => {
            onDraftChange(event.target.value)
            if (status.state !== 'saving') setStatus({ state: 'idle', code: null })
          }}
          rows={4}
          maxLength={maxLength * 2}
          spellCheck
          placeholder={'Camille Martin\nBUT Informatique, 2e année'}
          className={`min-h-[104px] w-full resize-y corners-[12px] border border-[var(--color-border)] bg-widget-bg px-3 py-[9px] font-body text-[15px] font-medium leading-[1.45] text-[var(--color-text)] outline-none placeholder:text-text-50 focus-visible:ring-2 focus-visible:ring-brand/45 ${tooLong ? 'border-[#b91c1c] dark:border-[var(--color-error)]' : ''}`}
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`font-body text-[13px] font-medium leading-[1.3] ${status.state === 'error' || tooLong ? 'text-[#b91c1c] dark:text-[var(--color-error)]' : 'text-text-60'}`}
          role={status.state === 'error' ? 'alert' : 'status'}
        >
          {line ?? `${length} / ${maxLength}`}
        </span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!normalized.ok || !changed || status.state === 'saving'}
          className={`inline-flex h-9 items-center justify-center rounded-full border-0 ${MUTED_FILL_CLASSES} px-4 text-[var(--color-text)] cursor-pointer transition-colors duration-[120ms] hover:bg-[#edebe5] disabled:cursor-default disabled:opacity-50 dark:hover:bg-[var(--color-bg-subtle)]`}
        >
          <span className="font-body text-[14px] font-semibold leading-none">{status.state === 'saving' ? 'Enregistrement…' : 'Enregistrer'}</span>
        </button>
      </div>
    </div>
  )
}

// `autoSignature`: the automatic one's lines (App's mailSender.signature),
// null without a name (nothing to preview, nor to send).
function MailSignatureSettings({ autoSignature }) {
  const { enabled, kind } = useMailSignaturePrefs()
  const remote = useMailSignatures({ fresh: true })
  const data = remote.data
  const savedCustom = data?.signatures.find((entry) => entry.id === data.customId)?.text ?? ''
  // The text being written: the saved one until it's changed (and again
  // once it's saved, or when the saved one arrives).
  const [draft, setDraft] = useState(null)
  const customText = draft ?? savedCustom

  const own = kind === 'auto' ? null : kind === 'custom'
    ? { status: 'ready', signature: customText.trim() ? { html: plainSignatureHtml(normalizeCustomSignatureText(customText).text ?? customText) } : null }
    : { status: remote.status, signature: pickShownSignature(data, 'partage') }
  const preview = { kind, auto: autoSignature, own }
  const hasImages = kind === 'partage' && own?.signature?.hasImages

  return (
    <SettingsGroup title="Signature" footer={enabled ? FOOTERS[kind] : null}>
      <label className={`${ROW_CLASSES} cursor-pointer`}>
        <RowText icon="ph:pen" label="Signature des mails" description={r('Ajoutée sous chaque mail que tu écris', 'Ajoutée sous chaque mail que vous écrivez')} />
        <Switch checked={enabled} onChange={setMailSignatureEnabled} />
      </label>
      {/* Unfolds with the switch (its grid row from 0fr to 1fr); folded, inert. */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none ${enabled ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
        inert={!enabled}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-4 border-t border-[var(--color-border)] px-4 pb-4 pt-[13px]">
            <KindPicker value={kind} onChange={setMailSignatureKind} />
            {kind === 'custom' ? (
              <CustomSignatureEditor saved={savedCustom} maxLength={data?.maxLength ?? 2000} draft={customText} onDraftChange={setDraft} />
            ) : null}
            <div className="flex flex-col gap-[7px]">
              <span className="font-body text-[13px] font-semibold leading-none text-text-60">Aperçu</span>
              <div className={`corners-[12px] ${MUTED_FILL_CLASSES} px-4 py-3 font-body text-[16px] text-[var(--color-text)]`}>
                <p className="m-0 text-text-50">Bonjour,</p>
                <div className={`${signatureClassName(preview)} !my-[10px] [&_.mail-composer-signature-logos_img]:h-7`}>
                  <MailSignatureContent value={preview} />
                </div>
              </div>
              {hasImages ? (
                <p className="m-0 font-body text-[13px] font-medium leading-[1.4] text-text-50">{r('Les images de ta signature Partage ne sont pas reprises', 'Les images de votre signature Partage ne sont pas reprises')}</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </SettingsGroup>
  )
}

export default MailSignatureSettings
