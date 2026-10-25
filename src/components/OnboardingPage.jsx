import { useEffect, useState } from 'react'
import LoadingDots from './LoadingDots'

const STEP_CONFIG = {
  year: {
    label: 'Année',
    title: 'Choisis ton année',
    description: "Sélectionne ta promo ou ton année d'étude",
  },
  td: {
    label: 'TD',
    title: 'Choisis ton groupe TD',
    description: 'Groupe de travaux dirigés',
  },
  tp: {
    label: 'TP',
    title: 'Choisis ton groupe TP',
    description: "Groupe de travaux pratiques",
  },
}

const STEP_ORDER = ['year', 'td', 'tp']

const TD_STEP_PALETTE = [
  { background: '#d0fff8', text: '#341200', ring: 'rgba(19, 37, 49, 0.18)' },
  { background: '#e6ffd0', text: '#341200', ring: 'rgba(24, 39, 23, 0.18)' },
  { background: '#fbffd0', text: '#341200', ring: 'rgba(34, 48, 24, 0.18)' },
  { background: '#ffd0f6', text: '#341200', ring: 'rgba(52, 24, 41, 0.18)' },
  { background: '#ffd0d7', text: '#341200', ring: 'rgba(53, 34, 28, 0.18)' },
  { background: '#d0d5ff', text: '#341200', ring: 'rgba(35, 28, 61, 0.18)' },
  { background: '#fffcd0', text: '#341200', ring: 'rgba(40, 50, 24, 0.18)' },
]


function buildTdOrbitText(stepOption, selectedYear, contextLabel) {
  const parts = [
    stepOption.label,
    selectedYear?.label,
    stepOption.parentLabel,
    contextLabel,
    'Travaux dirigés',
  ].filter(Boolean)

  const baseText = parts.join(' · ')
  return Array.from({ length: 3 }, () => baseText).join(' · ')
}

function getGroupDisplayLabel(step, label) {
  if (typeof label !== 'string') {
    return step === 'tp' ? 'TP' : 'TD'
  }

  const prefix = step === 'tp' ? 'TP' : 'TD'
  const normalizedLabel = label.trim().replace(/\s+/g, ' ')
  const explicitGroupMatch = normalizedLabel.match(new RegExp(`\\b${prefix}\\s*([A-Z0-9]+)\\b`, 'i'))

  if (explicitGroupMatch) {
    return `${prefix} ${explicitGroupMatch[1].toUpperCase()}`
  }

  if (step === 'td') {
    const yearGroupMatch = normalizedLabel.match(/^\d+\s*([A-Z])\b/i)

    if (yearGroupMatch) {
      return `TD ${yearGroupMatch[1].toUpperCase()}`
    }
  }

  if (step === 'tp') {
    const tpPrefixMatch = normalizedLabel.match(/\bTP[\s-]*([A-Z0-9]+)\b/i)

    if (tpPrefixMatch) {
      return `TP ${tpPrefixMatch[1].toUpperCase()}`
    }

    const standaloneNumberMatch = normalizedLabel.match(/\b([0-9]+)\b/)

    if (standaloneNumberMatch) {
      return `TP ${standaloneNumberMatch[1]}`
    }
  }

  const standaloneTokenMatch = normalizedLabel.match(/\b([A-Z])\b/i)

  if (standaloneTokenMatch) {
    return `${prefix} ${standaloneTokenMatch[1].toUpperCase()}`
  }

  return normalizedLabel
}

// Short circle labels ("TD B", "TP 2") for a whole step, unless two options
// would read the same: INFO-COM's "A1 J" / "A2 J" both shorten to "TD J".
// Then every option keeps its full ADE name so they stay apart.
function getGroupDisplayLabels(step, options) {
  const shortLabels = options.map((option) => getGroupDisplayLabel(step, option.label))
  if (new Set(shortLabels).size === shortLabels.length) {
    return shortLabels
  }

  return options.map((option, index) => (typeof option.label === 'string' && option.label.trim()) || shortLabels[index])
}

// Full ADE names can be longer than "TD B": step the circle text down.
function getGroupLabelSizeClass(label) {
  if (label.length > 12) return 'onboarding-td-card__label--xlong'
  if (label.length > 6) return 'onboarding-td-card__label--long'
  return ''
}


function OnboardingPage({
  userName,
  contextLabel = '',
  currentStep = 'year',
  stepOptions = [],
  selectedYear = null,
  selectedTd = null,
  detectedResourceId = null,
  errorMessage = '',
  isLoading = false,
  loadingMessage = '',
  emptyStateTitle = '',
  emptyStateBody = '',
  emptyStateActionLabel = '',
  onRetry = null,
  onBack = null,
  onIgnore = null,
  onSelect,
  transitionDirection = 'initial',
}) {
  const currentStepConfig = STEP_CONFIG[currentStep] ?? STEP_CONFIG.year
  const isTdStep = currentStep === 'td'
  const isTpStep = currentStep === 'tp'
  const isGroupCircleStep = isTdStep || isTpStep
  const hasOptions = stepOptions.length > 0
  const hasRetry = typeof onRetry === 'function'
  const hasBack = typeof onBack === 'function' && (selectedYear || selectedTd)
  const hasIgnore = typeof onIgnore === 'function'

  const [tpLoadingTooLong, setTpLoadingTooLong] = useState(false)

  useEffect(() => {
    if (!isTpStep || !isLoading || hasOptions) {
      setTpLoadingTooLong(false)
      return undefined
    }

    const timerId = window.setTimeout(() => setTpLoadingTooLong(true), 3000)
    return () => window.clearTimeout(timerId)
  }, [isTpStep, isLoading, hasOptions])

  const shouldShowTpStepActions = !isTpStep || hasOptions || Boolean(errorMessage) || tpLoadingTooLong

  const specialStepTitle = isTdStep
    ? 'Choisis ton TD pour commencer'
    : (isTpStep ? 'Et enfin... ton groupe de TP' : '')
  const specialStepCardStyle = isTpStep
    ? {
        '--td-card-bg': '#ffffff',
        '--td-card-text': '#341200',
        '--td-card-ring': 'rgb(52 18 0 / 0.18)',
      }
    : null
  const groupDisplayLabels = getGroupDisplayLabels(currentStep, stepOptions)
  const groupOptionButtons = stepOptions.map((stepOption, index) => {
    const isDetected = detectedResourceId != null && String(detectedResourceId) === stepOption.resourceId
    const tdPalette = TD_STEP_PALETTE[index % TD_STEP_PALETTE.length]
    const orbitId = `td-orbit-${String(stepOption.resourceId).replace(/[^a-zA-Z0-9_-]/g, '-')}-${index}`

    return (
      <button
        key={stepOption.resourceId}
        type="button"
        className={isGroupCircleStep
          ? `onboarding-td-card onboarding-td-card-enter`
          : 'onboarding-card app-card-enter flex min-h-[112px] flex-col items-start justify-between gap-4 corners-[22px] border border-white bg-widget-bg p-4 text-left font-inherit transition-all duration-150 ease-in-out hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60'}
        style={isGroupCircleStep
          ? {
              '--td-card-bg': specialStepCardStyle?.['--td-card-bg'] ?? tdPalette.background,
              '--td-card-text': specialStepCardStyle?.['--td-card-text'] ?? tdPalette.text,
              '--td-card-ring': specialStepCardStyle?.['--td-card-ring'] ?? tdPalette.ring,
              animationDelay: `${index * 40}ms`,
            }
          : { animationDelay: `${index * 40}ms` }}
        onClick={() => onSelect(stepOption)}
        disabled={isLoading}
      >
        {isGroupCircleStep ? (
          <>
            <svg
              className="onboarding-td-card__orbit pointer-events-none absolute inset-0 size-full"
              viewBox="0 0 220 220"
              aria-hidden="true"
            >
              <defs>
                <path
                  id={orbitId}
                  d="M 110,110 m -82,0 a 82,82 0 1,1 164,0 a 82,82 0 1,1 -164,0"
                />
              </defs>
              <text className="onboarding-td-card__orbit-text">
                <textPath href={`#${orbitId}`} startOffset="0%">
                  {buildTdOrbitText(stepOption, selectedYear, contextLabel)}
                </textPath>
              </text>
            </svg>

            {isDetected ? (
              <span className="onboarding-td-card__badge">
                ADE
              </span>
            ) : null}

            <span className={`onboarding-td-card__label ${getGroupLabelSizeClass(groupDisplayLabels[index])}`}>{groupDisplayLabels[index]}</span>
          </>
        ) : (
          <>
            <div className="flex w-full items-start justify-between gap-3">
              <span className="text-[1.15rem] font-semibold leading-[1.1] text-text max-sm:text-base">{stepOption.label}</span>
              {isDetected ? (
                <span className="shrink-0 rounded-full bg-success-bg px-3 py-1 text-[0.75rem] font-semibold text-success-text">
                  Détecté sur ADE
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {stepOption.parentLabel ? (
                <span className="rounded-full bg-bg px-3 py-1 text-xs font-semibold text-text-muted">
                  {stepOption.parentLabel}
                </span>
              ) : null}
              {stepOption.contextLabel && stepOption.contextLabel !== stepOption.parentLabel ? (
                <span className="rounded-full bg-bg px-3 py-1 text-xs font-semibold text-text-muted">
                  {stepOption.contextLabel}
                </span>
              ) : null}
            </div>
          </>
        )}
      </button>
    )
  })
  const specialStepDesktopActions = isGroupCircleStep && hasIgnore && shouldShowTpStepActions ? (
    <div className="flex flex-wrap items-center justify-center gap-3 max-sm:hidden">
    {isTpStep && hasBack ? (
        <button
          type="button"
          className="rounded-full border border-transparent bg-transparent px-4 py-2 text-sm font-medium text-text-muted transition-colors duration-150 hover:text-text focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
          onClick={onBack}
          disabled={isLoading}
        >
          Précédent
        </button>
      ) : null}
      <button
        type="button"
        className="rounded-full border border-transparent bg-transparent px-4 py-2 text-sm font-medium text-text-muted transition-colors duration-150 hover:text-text focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
        onClick={onIgnore}
        disabled={isLoading}
      >
        Ignorer
      </button>
    </div>
  ) : null

  return (
    <section
      className={`flex-1 flex items-center justify-center bg-bg min-h-0 ${
        isGroupCircleStep
          ? `px-8 py-10 max-sm:px-5 ${isTpStep ? 'max-sm:pt-8 max-sm:pb-32' : 'max-sm:py-8'}`
          : 'p-8 max-sm:p-5'
      }`}
      aria-label={currentStepConfig.title}
    >
      <div
        key={currentStep}
        className={`onboarding-step-panel ${isTdStep ? 'onboarding-step-panel--td-intro' : ''} ${transitionDirection === 'back' ? 'onboarding-step-panel--back' : ''} flex w-full ${isGroupCircleStep ? 'max-w-[1040px] flex-col items-center gap-8' : 'max-w-[920px] flex-col gap-8'}`}
      >
        {isGroupCircleStep ? (
          <>
            <div className="flex w-full max-w-[920px] flex-col items-center gap-3">
              <div className="flex w-full flex-wrap items-center justify-center gap-3">
                {selectedYear ? (
                  <span className="rounded-full border border-[color:var(--color-border)] bg-widget-bg px-4 py-2 text-sm font-semibold text-text shadow-[0_8px_20px_-16px_rgba(17,24,39,0.35)]">
                    Année : {selectedYear.label}
                  </span>
                ) : null}
                {isTpStep && selectedTd ? (
                  <span className="rounded-full border border-[color:var(--color-border)] bg-widget-bg px-4 py-2 text-sm font-semibold text-text shadow-[0_8px_20px_-16px_rgba(17,24,39,0.35)]">
                    TD : {selectedTd.label}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col items-center gap-3 text-center">
              <h1 className="m-0 text-[2.35rem] font-bold leading-[0.94] text-text max-sm:text-[1.95rem]">
                {specialStepTitle}
              </h1>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <h1 className="text-[3.5rem] font-bold leading-[0.9] text-text m-0 max-sm:text-[2.25rem]">
                Hello, {userName || 'étudiant'}
              </h1>
              <p className="text-lg font-medium leading-[1.2] text-text-muted m-0 font-body max-sm:text-base">
                {contextLabel
                  ? `Tu es dans ${contextLabel}, choisis maintenant ton groupe exact.`
                  : "Choisis ton groupe exact"}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
              {STEP_ORDER.map((stepKey, index) => {
                const isCurrent = stepKey === currentStep
                const isCompleted = (
                  (stepKey === 'year' && selectedYear)
                  || (stepKey === 'td' && selectedTd)
                )

                return (
                  <div
                    key={stepKey}
                    className={`corners-[22px] border p-4 transition-colors duration-300 ${isCurrent ? 'border-brand bg-widget-bg' : 'border-[color:var(--color-border)] bg-widget-bg'}`}
                  >
                    <p className="m-0 text-xs font-bold uppercase tracking-[0.08em] text-text-muted font-body">
                      Étape {index + 1}
                    </p>
                    <p className="m-0 mt-2 text-base font-semibold text-text">{STEP_CONFIG[stepKey].label}</p>
                    <p className="m-0 mt-2 text-sm text-text-muted font-body">
                      {stepKey === 'year' && selectedYear ? selectedYear.label : null}
                      {stepKey === 'td' && selectedTd ? selectedTd.label : null}
                      {stepKey === 'tp' ? 'Groupe final' : null}
                      {!isCompleted && !isCurrent ? 'À choisir' : null}
                      {isCurrent ? 'En cours' : null}
                    </p>
                  </div>
                )
              })}
            </div>

            <div className="flex flex-wrap gap-2">
              {selectedYear ? (
                <span className="rounded-full bg-widget-bg px-3 py-2 text-sm font-semibold text-text">
                  Année : {selectedYear.label}
                </span>
              ) : null}
              {selectedTd ? (
                <span className="rounded-full bg-widget-bg px-3 py-2 text-sm font-semibold text-text">
                  TD : {selectedTd.label}
                </span>
              ) : null}
            </div>

            <div className="flex items-start justify-between gap-4 max-sm:flex-col">
              <div className="flex flex-col gap-2">
                <h2 className="m-0 text-[1.7rem] font-bold text-text leading-tight">{currentStepConfig.title}</h2>
                <p className="m-0 text-base text-text-muted font-body">{currentStepConfig.description}</p>
              </div>
      {isTpStep && hasBack ? (
                <button
                  type="button"
                  className="inline-flex items-center justify-center corners-[14px] border border-[color:var(--color-border)] bg-bg px-4 py-3 text-sm font-semibold text-text transition-transform duration-150 ease-in-out hover:scale-[1.01] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
                  onClick={onBack}
                  disabled={isLoading}
                >
                  Retour
                </button>
              ) : null}
            </div>
          </>
        )}

        {errorMessage ? (
          <div className={`corners-[22px] border border-[color:var(--color-border)] bg-widget-bg p-5 ${isGroupCircleStep ? 'w-full max-w-[720px]' : ''}`}>
            <p className="m-0 text-base font-semibold text-text">Impossible de récupérer ce niveau de groupe pour le moment</p>
            <p className="m-0 mt-2 text-sm text-text-muted font-body">{errorMessage}</p>
            {hasRetry ? (
              <button
                type="button"
                className="mt-4 inline-flex items-center justify-center corners-[14px] border border-[color:var(--color-border)] bg-bg px-4 py-3 text-sm font-semibold text-text transition-transform duration-150 ease-in-out hover:scale-[1.01] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
                onClick={onRetry}
                disabled={isLoading}
              >
                Réessayer
              </button>
            ) : null}
          </div>
        ) : null}

        {isTpStep && !errorMessage ? (
          <div className="flex w-full max-w-[920px] flex-col items-center gap-6">
            <div className="w-full">
              <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${isLoading ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                <div className="overflow-hidden">
                  <div className="flex w-full items-center justify-center py-6">
                    <LoadingDots label={loadingMessage || 'Chargement'} className="text-text-muted" />
                  </div>
                </div>
              </div>
              <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${hasOptions ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                <div className={hasOptions ? 'overflow-visible' : 'overflow-hidden'}>
                  <div className="-mb-7 -mt-5 -mx-5 px-5 pt-5 pb-7">
                    <div key={hasOptions ? 'loaded' : 'empty'} className="flex w-full flex-wrap items-center justify-center gap-5 pt-1 max-sm:gap-4">
                      {groupOptionButtons}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {specialStepDesktopActions}
          </div>
        ) : hasOptions ? (
          <div className={isGroupCircleStep ? 'flex w-full max-w-[920px] flex-col items-center gap-6' : 'contents'}>
            <div className={isGroupCircleStep ? 'flex w-full flex-wrap items-center justify-center gap-5 max-sm:gap-4' : 'grid grid-cols-2 gap-3 max-sm:grid-cols-1'}>
              {groupOptionButtons}
            </div>

            {specialStepDesktopActions}
          </div>
        ) : errorMessage ? null : isTpStep && isLoading ? (
          <div className="flex w-full max-w-[720px] items-center justify-center py-6">
            <LoadingDots label={loadingMessage || 'Chargement'} className="text-text-muted" />
          </div>
        ) : (
          <div className={`corners-[22px] border border-[color:var(--color-border)] bg-widget-bg p-5 ${isGroupCircleStep ? 'w-full max-w-[720px] text-center' : ''}`}>
            <p className="m-0 text-base font-semibold text-text">{emptyStateTitle || "Aucun choix n'a encore été trouvé pour cette étape"}</p>
            <div className="mt-3 min-h-[20px]">
              {isLoading ? (
                <LoadingDots label={loadingMessage || 'Chargement'} className="text-text-muted" />
              ) : emptyStateBody ? (
                <div className="flex flex-col items-center gap-4">
                  <p className="m-0 text-sm text-text-muted font-body">{emptyStateBody}</p>
                  {hasRetry ? (
                    <button
                      type="button"
                      className="inline-flex items-center justify-center corners-[14px] border border-[color:var(--color-border)] bg-bg px-4 py-3 text-sm font-semibold text-text transition-transform duration-150 ease-in-out hover:scale-[1.01] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
                      onClick={onRetry}
                      disabled={isLoading}
                    >
                      {emptyStateActionLabel || 'Réessayer'}
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="m-0 text-sm text-text-muted font-body">Réessaie dans quelques instants</p>
              )}
            </div>
          </div>
        )}
      </div>

      {isGroupCircleStep && hasIgnore && shouldShowTpStepActions ? (
        <div className="fixed inset-x-0 bottom-0 z-20 hidden max-sm:flex justify-center px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-4">
          <div className="flex w-full max-w-[420px] items-center justify-center gap-3">
            {hasBack ? (
              <button
                type="button"
                className="min-h-[44px] flex-1 rounded-full border border-transparent bg-transparent px-4 py-2 text-sm font-medium text-text-muted transition-colors duration-150 hover:text-text focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
                onClick={onBack}
                disabled={isLoading}
              >
                Précédent
              </button>
            ) : null}
            {hasIgnore ? (
              <button
                type="button"
                className="min-h-[44px] flex-1 rounded-full border border-transparent bg-transparent px-4 py-2 text-sm font-medium text-text-muted transition-colors duration-150 hover:text-text focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
                onClick={onIgnore}
                disabled={isLoading}
              >
                Ignorer
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default OnboardingPage
