import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'
import {
  absenceTeacher,
  buildAbsenceSummaryRows,
  buildJustificationLines,
  buildJustificationSubject,
  listAbsenceReasons,
  prepareJustificationMail,
} from '../absenceMail'
import { parseDay } from '../assiduity'
import CloseButton from './CloseButton'
import LentButton from './LentButton'
import { r } from '../register.js'

// « Justifier » (« Assiduité »): a short walkthrough, one question a step,
// as the grade simulator's sheet (GradeSimulatorModal): why the student
// was away, their justificatif (a photo or a PDF, attached to the mail),
// then the mail it makes, opened in the Messagerie's composer to check and
// send (`onCompose(request)`, App's handleComposeMail). Nothing is sent
// from here. A bottom sheet on a phone.

const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
const STEPS = ['reason', 'proof', 'review']
const DAY_SHORT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
const MAX_DETAILS = 600
const PROOF_ACCEPT = 'image/*,application/pdf'

const QUESTION = 'm-0 outline-none text-balance font-display text-[24px] font-bold leading-[1.15] text-text max-sm:text-[22px]'
const HINT = 'm-0 text-balance font-body text-[15px] font-medium leading-[1.4] text-text-secondary'
const TEXT_LINK = 'inline-flex cursor-pointer items-center gap-1.5 rounded-full border-0 bg-transparent px-3 py-2 text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text'

function formatSize(bytes) {
  if (!(bytes > 0)) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`
}

// Where the walkthrough is: one dot per step, the current one long.
function StepDots({ index }) {
  return (
    <span className="flex items-center gap-1.5" aria-hidden="true">
      {STEPS.map((step, position) => (
        <span
          key={step}
          className={`h-[6px] rounded-full transition-all duration-300 ${position === index ? 'w-5 bg-brand' : position < index ? 'w-[6px] bg-brand' : 'w-[6px] bg-text-30'}`}
        />
      ))}
    </span>
  )
}

// « Pourquoi ? »: the reasons as tiles; one picked moves on, but « Autre
// raison », which asks for a few words first.
function ReasonStep({ entry, extraReasons, reason, details, onReason, onDetails, onNext }) {
  const reasons = listAbsenceReasons(entry, extraReasons)
  const detailsId = useId()
  const isOther = reason === 'other'
  return (
    <div className="grid gap-5">
      <div className="grid gap-2 text-center">
        <h3 tabIndex={-1} className={QUESTION}>{entry.status === 'late' ? 'Pourquoi ce retard ?' : 'Pourquoi cette absence ?'}</h3>
        <p className={HINT}>{r('Elle sera écrite dans le mail, que tu pourras relire', 'Elle sera écrite dans le mail, que vous pourrez relire')}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 max-xs:grid-cols-1" role="radiogroup" aria-label="Raison">
        {reasons.map((option, index) => {
          const selected = reason === option.id
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onReason(option.id)}
              style={{ '--reveal-order': index }}
              className={`justify-reason flex min-h-[58px] cursor-pointer items-center gap-3 rounded-[18px] border p-2.5 text-left transition-colors ${selected ? 'border-brand bg-brand-subtle' : 'border-border bg-widget-bg hover:bg-bg-subtle'}`}
            >
              <span className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full ${selected ? 'bg-brand text-bg' : 'bg-brand-subtle text-text'}`} aria-hidden="true">
                <Icon icon={option.icon} className="size-[18px]" />
              </span>
              <span className="min-w-0 font-body text-[15px] font-semibold leading-[1.2] text-text">{option.label}</span>
            </button>
          )
        })}
      </div>
      {isOther ? (
        <div className="semester-fade grid gap-2">
          <label htmlFor={detailsId} className="font-body text-[14px] font-semibold text-text">En quelques mots</label>
          <textarea
            id={detailsId}
            autoFocus
            value={details}
            maxLength={MAX_DETAILS}
            onChange={(event) => onDetails(event.target.value)}
            rows={3}
            placeholder={r('Ce qui t’a empêché de venir', 'Ce qui vous a empêché de venir')}
            className="w-full resize-none rounded-[16px] border border-border-input bg-bg-input px-3.5 py-3 font-body text-[15px] leading-[1.4] text-text outline-none focus:border-brand"
          />
          <div className="flex justify-end">
            <LentButton disabled={!details.trim()} onClick={onNext}>
              Suivant
              <Icon icon="ph:arrow-right" className="size-4" aria-hidden="true" />
            </LentButton>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// The justificatif: a photo (the phone's camera offered) or a PDF, kept
// here until the mail is written; or later, or none.
function ProofStep({ file, onFile, onChoose, onNext }) {
  const inputRef = useRef(null)
  const preview = useMemo(() => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  return (
    <div className="grid gap-5">
      <div className="grid gap-2 text-center">
        <h3 tabIndex={-1} className={QUESTION}>{r('As-tu un justificatif ?', 'Avez-vous un justificatif ?')}</h3>
        <p className={HINT}>Certificat médical, convocation, attestation…</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={PROOF_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const picked = event.target.files?.[0]
          if (picked) onFile(picked)
          event.target.value = ''
        }}
      />
      {file ? (
        <div className="semester-fade flex items-center gap-3 rounded-[18px] border border-border bg-widget-bg p-2.5">
          {preview ? (
            <img src={preview} alt="" className="size-14 shrink-0 rounded-[12px] object-cover" />
          ) : (
            <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-[12px] bg-brand-subtle text-text" aria-hidden="true">
              <Icon icon="ph:file-pdf" className="size-6" />
            </span>
          )}
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="truncate font-body text-[15px] font-semibold leading-[1.2] text-text">{file.name}</span>
            <span className="font-body text-[13px] font-medium leading-none text-text-muted">{formatSize(file.size)} · joint au mail</span>
          </span>
          <CloseButton label="Retirer le justificatif" onClick={() => onFile(null)} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="justify-drop flex cursor-pointer flex-col items-center gap-2 rounded-[22px] border-2 border-dashed border-border-input bg-widget-bg px-5 py-7 text-text transition-colors hover:border-brand hover:bg-bg-subtle"
        >
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-brand-subtle" aria-hidden="true">
            <Icon icon="ph:camera" className="size-6" />
          </span>
          <span className="font-body text-[16px] font-semibold leading-[1.2]">Ajouter une photo ou un PDF</span>
          <span className="font-body text-[13px] font-medium leading-none text-text-muted">Joint au mail</span>
        </button>
      )}
      {file ? (
        <div className="flex justify-center">
          <LentButton onClick={onNext}>
            Suivant
            <Icon icon="ph:arrow-right" className="size-4" aria-hidden="true" />
          </LentButton>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-1">
          <button type="button" className={TEXT_LINK} onClick={() => onChoose('later')}>
            <span className="font-body text-[14px] font-semibold leading-none">Je l’enverrai plus tard</span>
          </button>
          <span className="text-text-30" aria-hidden="true">·</span>
          <button type="button" className={TEXT_LINK} onClick={() => onChoose('none')}>
            <span className="font-body text-[14px] font-semibold leading-none">Je n’en ai pas</span>
          </button>
        </div>
      )}
    </div>
  )
}

// The mail as it will open: who it goes to (À: the secretariat, added by
// the student; Cc: the teacher, ScoDoc's address or the class's teacher
// found in the planning, which the student can leave out), its subject,
// its text, the summary box and the justificatif; « Écrire le mail » opens
// it in the composer.
function ReviewStep({ entry, answers, file, toTeacher, onToTeacher, findsClassTeacher, onCompose }) {
  const teacher = absenceTeacher(entry)
  const ccLabel = teacher ? teacher.name || teacher.email : findsClassTeacher ? 'Enseignant du cours' : null
  const lines = buildJustificationLines(entry, answers)
  const rows = buildAbsenceSummaryRows(entry)
  return (
    <div className="grid gap-5">
      <div className="grid gap-2 text-center">
        <h3 tabIndex={-1} className={QUESTION}>{r('Ton mail est prêt', 'Votre mail est prêt')}</h3>
        <p className={HINT}>{r('Ajoute l’adresse du secrétariat de ton département dans le mail, puis envoie-le', 'Ajoutez l’adresse du secrétariat de votre département dans le mail, puis envoyez-le')}</p>
      </div>
      <article className="justify-letter grid gap-3 rounded-[20px] border border-border bg-widget-bg p-4 text-left shadow-md max-sm:p-3.5">
        <div className="grid gap-2 border-b border-border pb-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="w-[52px] shrink-0 font-body text-[13px] font-medium leading-none text-text-muted">À</span>
            <span className="font-body text-[13px] font-semibold leading-none text-text">Secrétariat du département</span>
            <span className="font-body text-[13px] font-medium leading-none text-text-muted">à ajouter</span>
          </div>
          {ccLabel ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="w-[52px] shrink-0 font-body text-[13px] font-medium leading-none text-text-muted">Cc</span>
              <button
                type="button"
                aria-pressed={toTeacher}
                onClick={() => onToTeacher(!toTeacher)}
                title={teacher?.email}
                className={`inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-[5px] transition-colors ${toTeacher ? 'border-transparent bg-brand-subtle text-text' : 'border-dashed border-border-input bg-transparent text-text-muted line-through'}`}
              >
                <Icon icon={toTeacher ? 'ph:check-bold' : 'ph:plus-bold'} className="size-[12px] shrink-0" aria-hidden="true" />
                <span className="truncate font-body text-[13px] font-semibold leading-none">{ccLabel}</span>
              </button>
              {!teacher && toTeacher ? <span className="font-body text-[13px] font-medium leading-none text-text-muted">{r('cherché dans ton planning', 'cherché dans votre planning')}</span> : null}
            </div>
          ) : null}
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="w-[52px] shrink-0 font-body text-[13px] font-medium leading-none text-text-muted">Objet</span>
            <span className="min-w-0 font-body text-[14px] font-semibold leading-[1.3] text-text">{buildJustificationSubject(entry, answers)}</span>
          </div>
        </div>
        <div className="grid max-h-[32dvh] gap-2 overflow-y-auto overscroll-contain font-body text-[14px] font-medium leading-[1.45] text-text">
          {lines.map((line, index) => <p key={index} className="m-0 whitespace-pre-line">{line}</p>)}
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-[12px] bg-bg-subtle px-3 py-2 text-[13px]">
            {rows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="font-semibold text-text-muted">{row.label}</dt>
                <dd className="m-0 min-w-0 text-text">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="m-0">Bien cordialement,</p>
        </div>
        {file ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 justify-self-start rounded-full border border-border px-2.5 py-[5px] text-text-secondary">
            <Icon icon="ph:paperclip" className="size-[14px] shrink-0" aria-hidden="true" />
            <span className="truncate font-body text-[13px] font-semibold leading-none">{file.name}</span>
          </span>
        ) : null}
      </article>
      <div className="grid justify-items-center gap-2">
        <LentButton onClick={onCompose}>
          <Icon icon="ph:pencil-simple-line" className="size-4" aria-hidden="true" />
          Écrire le mail
        </LentButton>
        <span className="font-body text-[13px] font-medium text-text-muted">Il s’ouvre dans la Messagerie, rien n’est envoyé avant</span>
      </div>
    </div>
  )
}

// `entry`: the absence (buildAbsenceReport's); `extraReasons`: the
// establishment's own reasons (listAbsenceReasons); `findsClassTeacher`:
// the composer can look the class's teacher up in the planning (App's
// in-app Planning); `onStep(step, { reach, proof })`: the steps for the
// anonymous analytics (never the reason); `onCompose(request)`: the
// composer's restore; `onClose`.
function JustifyAbsenceSheet({ entry, extraReasons = [], findsClassTeacher = false, onStep = () => {}, onCompose, onClose }) {
  const titleId = useId()
  const dialogRef = useRef(null)
  const bodyRef = useRef(null)
  const heightFromRef = useRef(null)
  const [step, setStep] = useState('reason')
  const [reason, setReason] = useState(null)
  const [details, setDetails] = useState('')
  const [proof, setProof] = useState(null)
  const [file, setFile] = useState(null)
  const [toTeacher, setToTeacher] = useState(true)
  const stepIndex = STEPS.indexOf(step)
  const answers = { reason, details: reason === 'other' ? details : '', proof: file ? 'attached' : proof }
  const day = parseDay(entry.date)
  const context = [day ? DAY_SHORT.format(day).replace('.', '') : null, `${entry.start} – ${entry.end}`, entry.subjectTitle].filter(Boolean).join(' · ')

  // A step change eases the sheet to its new height (as the simulator's).
  const goTo = (next) => {
    heightFromRef.current = dialogRef.current?.getBoundingClientRect().height ?? null
    setStep(next)
  }
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    const fromHeight = heightFromRef.current
    heightFromRef.current = null
    if (bodyRef.current) bodyRef.current.scrollTop = 0
    bodyRef.current?.querySelector('h3')?.focus?.({ preventScroll: true })
    if (!dialog || fromHeight == null || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const toHeight = dialog.getBoundingClientRect().height
    if (Math.abs(toHeight - fromHeight) > 2) {
      dialog.animate([{ height: `${fromHeight}px` }, { height: `${toHeight}px` }], { duration: 380, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
    }
  }, [step])

  // A reason picked moves on after a beat (the tile seen picked); « Autre
  // raison » waits for its words.
  const advanceTimer = useRef(null)
  useEffect(() => () => window.clearTimeout(advanceTimer.current), [])
  // The steps reported (onStep), forward moves only: never the reason
  // itself, only that one was given.
  const reasonGiven = () => onStep('reason_picked', { reach: 'proof' })
  const toReview = () => {
    onStep('review_shown', { reach: 'review' })
    goTo('review')
  }
  const pickReason = (id) => {
    setReason(id)
    window.clearTimeout(advanceTimer.current)
    if (id === 'other') return
    reasonGiven()
    advanceTimer.current = window.setTimeout(() => goTo('proof'), 260)
  }
  const chooseProof = (choice) => {
    setFile(null)
    setProof(choice)
    onStep('proof_chosen', { proof: choice })
    toReview()
  }
  const pickFile = (picked) => {
    setFile(picked)
    setProof(picked ? 'attached' : null)
    if (picked) onStep('proof_chosen', { proof: 'attached' })
  }
  const compose = () => {
    onStep('composed', { reach: 'composed', proof: answers.proof })
    onCompose(prepareJustificationMail(entry, { ...answers, file, toTeacher }))
  }

  // Focus in, page scroll locked; focus back on the opener when it closes.
  useEffect(() => {
    const previouslyFocused = document.activeElement
    dialogRef.current?.focus({ preventScroll: true })
    const root = document.documentElement
    const previousOverflow = root.style.overflow
    root.style.setProperty('overflow', 'hidden')
    return () => {
      root.style.setProperty('overflow', previousOverflow)
      if (previouslyFocused?.isConnected) previouslyFocused.focus?.({ preventScroll: true })
    }
  }, [])

  // Escape closes, Tab stays inside.
  const keyHandlerRef = useRef(null)
  useLayoutEffect(() => {
    keyHandlerRef.current = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR)].filter((element) => element.offsetParent !== null)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const isInside = dialogRef.current.contains(document.activeElement)
      if (event.shiftKey && (!isInside || document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (!isInside || document.activeElement === last)) {
        event.preventDefault()
        first.focus()
      }
    }
  })
  useEffect(() => {
    const listener = (event) => keyHandlerRef.current?.(event)
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [])

  return createPortal(
    <div className="gd-root fixed inset-0 z-50 flex items-center justify-center p-5 max-sm:items-end max-sm:p-0" role="presentation">
      <div className="weather-modal-backdrop absolute inset-0 bg-backdrop animate-modal-backdrop-in" onClick={onClose} aria-hidden="true" />
      <section
        ref={dialogRef}
        className="gd-dialog relative isolate flex max-h-[min(860px,calc(100dvh-40px))] w-[min(560px,100%)] flex-col overflow-hidden modal-corners [--modal-inset:24px] [--modal-inner-radius:20px] max-sm:[--modal-inset:16px] max-sm:[--modal-inner-radius:18px] border border-border bg-bg text-text shadow-[0_24px_80px_var(--color-shadow)] outline-none max-sm:max-h-[calc(100dvh-16px)] max-sm:rounded-b-none max-sm:border-b-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="relative">
          <span className="gd-grabber relative mx-auto hidden h-[4px] w-9 rounded-full bg-text-30 max-sm:block max-sm:translate-y-2" aria-hidden="true" />
          <div className="relative flex items-center gap-3 px-6 pt-5 pb-3 max-sm:px-4 max-sm:pt-[14px]">
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={() => goTo(STEPS[stepIndex - 1])}
                aria-label="Étape précédente"
                className="inline-flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-brand-subtle p-0 text-text transition-colors hover:bg-bg-muted"
              >
                <Icon icon="ph:arrow-left-bold" className="size-[15px]" aria-hidden="true" />
              </button>
            ) : (
              <Icon icon="ph:seal-check" className="size-6 shrink-0 text-text" aria-hidden="true" />
            )}
            <span className="grid min-w-0 flex-1 gap-[3px]">
              <h2 id={titleId} className="m-0 truncate font-display text-[20px] font-bold leading-none text-text max-sm:text-[19px]">
                {entry.status === 'late' ? 'Justifier un retard' : 'Justifier une absence'}
              </h2>
              <span className="truncate font-body text-[12.5px] font-medium leading-none text-text-muted">{context}</span>
            </span>
            <StepDots index={stepIndex} />
            <CloseButton onClick={onClose} />
          </div>
        </header>
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-3 pb-6 max-sm:px-4 max-sm:pb-[max(24px,env(safe-area-inset-bottom))]">
          <div key={step} className="semester-fade">
            {step === 'reason' ? (
              <ReasonStep entry={entry} extraReasons={extraReasons} reason={reason} details={details} onReason={pickReason} onDetails={setDetails} onNext={() => { reasonGiven(); goTo('proof') }} />
            ) : step === 'proof' ? (
              <ProofStep file={file} onFile={pickFile} onChoose={chooseProof} onNext={toReview} />
            ) : (
              <ReviewStep entry={entry} answers={answers} file={file} toTeacher={toTeacher} onToTeacher={setToTeacher} findsClassTeacher={findsClassTeacher} onCompose={compose} />
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}

export default JustifyAbsenceSheet
