import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { openChangelog, useChangelog } from '../changelogStore'
import { getPillIds } from '../changelogState'
import { downloadSchoolCertificate, getCachedSchoolCertificateStatus, getSchoolCertificateStatus } from '../entApi'
import { usePlanningExport } from '../usePlanningExport'
import { AboutContent, AboutTeam } from './AboutModal'
import SettingsGroup, { RowText } from './SettingsGroup'
import { CARD_CLASSES, MUTED_FILL_CLASSES, PRESSABLE_ROW_CLASSES, ROW_CLASSES } from '../settingsStyles'
import { PrivacyContent } from './PrivacyModal'
import Dropdown from './Dropdown'
import LoadingDots from './LoadingDots'
import CloseButton from './CloseButton'

function buildSelectOptions(options, selectedOption) {
  const normalizedOptions = Array.isArray(options) ? [...options] : []

  if (
    selectedOption?.resourceId
    && !normalizedOptions.some((option) => option.resourceId === selectedOption.resourceId)
  ) {
    normalizedOptions.unshift(selectedOption)
  }

  return normalizedOptions
}

function AccountModalLoadingDots({ label }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-[10px] text-center text-[13px] font-medium leading-none text-text-60"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <LoadingDots label={null} />
      <span className="font-body">{label}</span>
    </div>
  )
}

// Knob is intentionally larger than the 26px track so it pokes out above and
// below the bar, and the blue fill runs up to its trailing edge — the circle
// visually caps the end of the progress bar.
const STEP_SLIDER_KNOB_PX = 34

function clampIndex(index, count) {
  if (index < 0) {
    return 0
  }
  if (index > count - 1) {
    return count - 1
  }
  return index
}

function findNearestIndex(options, value) {
  const exactIndex = options.indexOf(value)
  if (exactIndex !== -1) {
    return exactIndex
  }

  let nearestIndex = 0
  let nearestDistance = Infinity
  options.forEach((option, index) => {
    const distance = Math.abs(option - value)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  })
  return nearestIndex
}

// Discrete pill slider (see the account modal "prochain cours" setting):
// a rounded track with a blue fill up to a draggable white knob and a tick
// dot for every available step.
function StepSlider({ options, value, onChange, ariaLabel, disabled = false }) {
  const trackRef = useRef(null)
  const pressedRef = useRef(false)
  const [dragRatio, setDragRatio] = useState(null)
  const isDragging = dragRatio != null

  const count = options.length
  const activeIndex = findNearestIndex(options, value)
  const stepRatio = count > 1 ? activeIndex / (count - 1) : 0
  // While dragging, the knob tracks the pointer 1:1; otherwise it sits on the
  // active step (and CSS-animates towards it).
  const displayRatio = dragRatio ?? stepRatio

  const commitIndex = useCallback((nextIndex) => {
    const safeIndex = clampIndex(nextIndex, count)
    const nextValue = options[safeIndex]
    if (nextValue !== value) {
      onChange(nextValue)
    }
  }, [count, onChange, options, value])

  const ratioFromClientX = useCallback((clientX) => {
    const track = trackRef.current
    if (!track || count <= 1) {
      return null
    }

    const rect = track.getBoundingClientRect()
    const railWidth = rect.width - STEP_SLIDER_KNOB_PX
    if (railWidth <= 0) {
      return null
    }

    const rawRatio = (clientX - rect.left - STEP_SLIDER_KNOB_PX / 2) / railWidth
    return Math.min(1, Math.max(0, rawRatio))
  }, [count])

  const handlePointerDown = useCallback((event) => {
    if (disabled) {
      return
    }

    const ratio = ratioFromClientX(event.clientX)
    if (ratio == null) {
      return
    }

    event.currentTarget.setPointerCapture?.(event.pointerId)
    pressedRef.current = true
    // A simple press glides the knob to the tapped step; free-form dragging
    // only starts once the pointer moves.
    commitIndex(Math.round(ratio * (count - 1)))
  }, [commitIndex, count, disabled, ratioFromClientX])

  const handlePointerMove = useCallback((event) => {
    if (!pressedRef.current) {
      return
    }

    const ratio = ratioFromClientX(event.clientX)
    if (ratio == null) {
      return
    }

    setDragRatio(ratio)
    commitIndex(Math.round(ratio * (count - 1)))
  }, [commitIndex, count, ratioFromClientX])

  const endDragging = useCallback((event) => {
    if (event?.pointerId != null) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
    pressedRef.current = false
    // Releasing lets the knob snap-animate from the pointer to its step.
    setDragRatio(null)
  }, [])

  const handleKeyDown = useCallback((event) => {
    if (disabled) {
      return
    }

    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        event.preventDefault()
        commitIndex(activeIndex - 1)
        break
      case 'ArrowRight':
      case 'ArrowUp':
        event.preventDefault()
        commitIndex(activeIndex + 1)
        break
      case 'Home':
        event.preventDefault()
        commitIndex(0)
        break
      case 'End':
        event.preventDefault()
        commitIndex(count - 1)
        break
      default:
        break
    }
  }, [activeIndex, commitIndex, count, disabled])

  const knobLeft = `calc(${STEP_SLIDER_KNOB_PX / 2}px + (100% - ${STEP_SLIDER_KNOB_PX}px) * ${displayRatio})`
  // Fill runs to the knob's trailing edge, so the knob always caps the bar.
  const fillWidth = `calc(${STEP_SLIDER_KNOB_PX}px + (100% - ${STEP_SLIDER_KNOB_PX}px) * ${displayRatio})`
  const snapEasing = 'cubic-bezier(0.22, 1, 0.36, 1)'

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      aria-valuemin={options[0]}
      aria-valuemax={options[count - 1]}
      aria-valuenow={value}
      aria-valuetext={`${value} jours`}
      aria-disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDragging}
      onPointerCancel={endDragging}
      onKeyDown={handleKeyDown}
      className={`relative h-[26px] w-full touch-none select-none rounded-full bg-[#e7e4dc] outline-none transition-shadow dark:bg-[var(--color-bg-muted)] ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} focus-visible:ring-2 focus-visible:ring-brand/45`}
    >
      <div
        className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-brand"
        style={{ width: fillWidth, transition: isDragging ? 'none' : `width 260ms ${snapEasing}` }}
        aria-hidden="true"
      />

      {options.map((option, index) => {
        const dotRatio = count > 1 ? index / (count - 1) : 0
        const isFilled = index <= activeIndex
        return (
          <span
            key={option}
            className={`pointer-events-none absolute top-1/2 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-200 ${isFilled ? 'bg-white/75' : 'bg-black/25 dark:bg-white/25'}`}
            style={{ left: `calc(${STEP_SLIDER_KNOB_PX / 2}px + (100% - ${STEP_SLIDER_KNOB_PX}px) * ${dotRatio})` }}
            aria-hidden="true"
          />
        )
      })}

      <span
        className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border border-black/5 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.28)] ${isDragging ? 'scale-110' : ''} ${disabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
        style={{
          left: knobLeft,
          height: `${STEP_SLIDER_KNOB_PX}px`,
          width: `${STEP_SLIDER_KNOB_PX}px`,
          transition: isDragging ? 'transform 160ms ease' : `left 260ms ${snapEasing}, transform 160ms ease`,
        }}
        aria-hidden="true"
      />
    </div>
  )
}

const SETTING_BUTTON_CLASSES = `inline-flex h-9 items-center justify-center gap-[6px] rounded-full border-0 ${MUTED_FILL_CLASSES} px-3 font-body text-[14px] font-medium text-[var(--color-text)] transition-colors duration-[120ms] ease-in-out hover:bg-[#edebe5] cursor-pointer disabled:cursor-wait disabled:opacity-60 dark:hover:bg-[var(--color-bg-subtle)]`

// Also the debug menu's toggles (src/components/debug/).
export function Switch({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[26px] w-[44px] shrink-0 items-center rounded-full border-0 p-0 transition-colors duration-150 ease-in-out cursor-pointer ${checked ? 'bg-text' : 'bg-text-30'}`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-[3px] top-[3px] h-5 w-5 rounded-full bg-widget-bg shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-transform duration-150 ease-in-out ${checked ? 'translate-x-[18px]' : 'translate-x-0'}`}
      />
    </button>
  )
}

// A row whose whole surface toggles the switch.
function SwitchRow({ icon, label, description, checked, onChange }) {
  return (
    <label className={`${ROW_CLASSES} cursor-pointer`}>
      <RowText icon={icon} label={label} description={description} />
      <Switch checked={checked} onChange={onChange} />
    </label>
  )
}

// A setting row with the app's dropdown on the right (the menu opens under
// the pill, aligned on its right edge).
function PlanningSelect({ label, value, options, placeholder, disabled, onChange }) {
  return (
    <div className={ROW_CLASSES}>
      <span className="font-body text-[16px] font-medium leading-[1.2] tracking-[-0.3125px] text-[var(--color-text)]">{label}</span>
      <Dropdown
        label={label}
        options={options.map((option) => ({ value: option.resourceId, label: option.label }))}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={onChange}
        align="end"
        className="w-[min(220px,58%)]"
        triggerClassName={`flex h-9 w-full items-center justify-between gap-2 rounded-full border-0 ${MUTED_FILL_CLASSES} pl-[13px] pr-[11px] font-body text-[15px] font-medium text-[var(--color-text)] outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-brand/45 disabled:cursor-wait disabled:opacity-60`}
        chevronClassName="h-4 w-4 text-[var(--color-text)]"
      />
    </div>
  )
}

function LookaheadSetting({ days, options, onChange }) {
  const stepCount = options.length

  return (
    <div className="flex flex-col gap-[12px] px-4 pb-4 pt-[13px]">
      <div className="flex items-center justify-between gap-3">
        <span className="font-body text-[14px] font-medium leading-[1.35] text-text-60">
          Chercher le prochain cours sur
        </span>
        <span className={`inline-flex items-center rounded-full ${MUTED_FILL_CLASSES} px-[10px] py-[4px] font-body text-[13px] font-semibold leading-none text-[var(--color-text)]`}>
          {days} jours
        </span>
      </div>
      <StepSlider
        options={options}
        value={days}
        onChange={onChange}
        ariaLabel="Nombre de jours de recherche du prochain cours"
      />
      <div className="relative h-[15px]" aria-hidden="true">
        {options.map((option, index) => (
          <span
            key={option}
            className="absolute top-0 -translate-x-1/2 font-body text-[12px] font-medium leading-none text-text-50"
            style={{ left: `calc(${STEP_SLIDER_KNOB_PX / 2}px + (100% - ${STEP_SLIDER_KNOB_PX}px) * ${stepCount > 1 ? index / (stepCount - 1) : 0})` }}
          >
            {option}
          </span>
        ))}
      </div>
    </div>
  )
}

// « Documents »: the certificat de scolarité, only once the server confirmed
// one exists (it asks MonDossierWeb, see server/schoolCertificate.js).
function SchoolCertificateGroup() {
  const [status, setStatus] = useState(getCachedSchoolCertificateStatus)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let isCancelled = false
    void getSchoolCertificateStatus().then((nextStatus) => {
      if (!isCancelled) setStatus(nextStatus)
    })
    return () => {
      isCancelled = true
    }
  }, [])

  if (!status?.available) {
    return null
  }

  const handleDownload = async () => {
    setBusy(true)
    setError('')
    try {
      await downloadSchoolCertificate()
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : String(downloadError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-[7px]">
      <SettingsGroup title="Documents">
        <button
          type="button"
          className={`${ROW_CLASSES} w-full border-0 bg-transparent text-left cursor-pointer transition-colors duration-[120ms] hover:bg-[#f8f7f3] disabled:cursor-wait dark:hover:bg-[var(--color-bg-subtle)]`}
          onClick={() => void handleDownload()}
          disabled={busy}
        >
          <RowText
            icon="carbon:document-pdf"
            label="Certificat de scolarité"
            description={busy ? 'Téléchargement…' : status.schoolYear ? `Année ${status.schoolYear} · PDF` : 'PDF'}
          />
          {busy
            ? <LoadingDots label={null} className="w-4 shrink-0 text-text-60" />
            : <Icon icon="carbon:download" className="h-4 w-4 shrink-0 text-text-60" aria-hidden="true" />}
        </button>
      </SettingsGroup>
      {error ? (
        <p className="m-0 px-1 font-body text-[13px] font-semibold leading-[1.2] text-[#b91c1c] dark:text-[var(--color-error)]" role="alert">{error}</p>
      ) : null}
    </div>
  )
}

// The planning's .ics export (usePlanningExport), as the certificate's
// download: the row is the button, dots while it's asked, and why when
// there's nothing to export or it fails. None without a group.
const EXPORT_DESCRIPTIONS = {
  idle: 'Fichier .ics · Google Agenda, Apple Calendrier, Outlook',
  loading: 'Préparation…',
  empty: 'Aucun cours à exporter',
  error: 'Export indisponible pour le moment',
}

function PlanningExportGroup({ selection }) {
  const { state, run } = usePlanningExport(selection, { from: 'settings' })
  if (!selection) return null
  const busy = state === 'loading'
  return (
    <SettingsGroup title="Agenda" footer="Contient les cours des 60 prochains jours">
      <button
        type="button"
        className={`${ROW_CLASSES} w-full border-0 bg-transparent text-left cursor-pointer transition-colors duration-[120ms] hover:bg-[#f8f7f3] disabled:cursor-wait dark:hover:bg-[var(--color-bg-subtle)]`}
        onClick={() => void run()}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        <RowText icon="carbon:calendar-add" label="Exporter vers un agenda" description={EXPORT_DESCRIPTIONS[state] ?? EXPORT_DESCRIPTIONS.idle} />
        {busy
          ? <LoadingDots label={null} className="w-4 shrink-0 text-text-60" />
          : <Icon icon="carbon:download" className="h-4 w-4 shrink-0 text-text-60" aria-hidden="true" />}
      </button>
    </SettingsGroup>
  )
}

// « Nouveautés » (À propos): the whole changelog, pill or not. The list
// opens above Réglages and closes back to it. Its dot follows the pill's.
function ChangelogGroup() {
  const { entries, unseenIds: allUnseenIds } = useChangelog()
  const unseenIds = getPillIds(entries, allUnseenIds)

  if (entries.length === 0) {
    return null
  }

  return (
    <SettingsGroup>
      <button
        type="button"
        className={PRESSABLE_ROW_CLASSES}
        onClick={openChangelog}
      >
        <RowText icon="ph:sparkle" label="Nouveautés" description="Ce qui a changé récemment" />
        <span className="flex shrink-0 items-center gap-2">
          {unseenIds.length > 0 ? (
            <>
              <span className="changelog-new-dot h-[7px] w-[7px] rounded-full" aria-hidden="true" />
              <span className="sr-only">{`${unseenIds.length} à découvrir`}</span>
            </>
          ) : null}
          <Icon icon="carbon:chevron-right" className="h-4 w-4 text-text-60" aria-hidden="true" />
        </span>
      </button>
    </SettingsGroup>
  )
}

const THEME_CHOICES = [
  { id: 'auto', label: 'Automatique', icon: 'carbon:screen' },
  { id: 'light', label: 'Clair', icon: 'carbon:sun' },
  { id: 'dark', label: 'Sombre', icon: 'carbon:moon' },
]

// Three-way pill: follow the device, or force light or dark.
function ThemeSetting({ value, onChange }) {
  return (
    <div className="flex flex-col gap-[7px]">
      <h4 className="m-0 px-1 font-body text-[13px] font-semibold leading-none text-text-60">Thème</h4>
      <div className={`flex gap-1 rounded-full ${MUTED_FILL_CLASSES} p-1`}>
        {THEME_CHOICES.map((choice) => {
          const isActive = choice.id === value
          return (
            <button
              key={choice.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(choice.id)}
              className={`inline-flex h-9 min-w-0 flex-auto items-center justify-center gap-[6px] rounded-full border px-3 font-body text-[14px] font-medium text-[var(--color-text)] cursor-pointer transition-[background-color,box-shadow,border-color] duration-150 ease-in-out max-sm:text-[13px] ${
                isActive
                  ? 'bg-widget-bg border-white dark:border-[rgba(255,255,255,0.08)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]'
                  : 'bg-transparent border-transparent hover:bg-brand-subtle'
              }`}
            >
              <Icon icon={choice.icon} className="h-4 w-4 shrink-0 max-sm:hidden" aria-hidden="true" />
              <span className="truncate">{choice.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Dashboard background: large preview, an on/off switch, and (when on) pick
// an image or go back to the default photo.
function WallpaperSetting({ previewSrc, hasCustom, enabled, onEnabledChange, onChange, onReset }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canToggle = typeof onEnabledChange === 'function'
  const canPick = typeof onChange === 'function'

  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setBusy(true)
    setError('')
    try {
      await onChange(file)
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : String(changeError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsGroup
      title="Fond d’écran"
      footer={canPick ? 'Ton image reste sur cet appareil, elle n’est envoyée nulle part.' : null}
    >
      {previewSrc ? (
        <div className="p-2">
          <div
            className={`relative aspect-[16/6] w-full corners-[14px] bg-cover bg-center transition-[opacity,filter] duration-200 ${enabled ? '' : 'opacity-35 grayscale'}`}
            style={{ backgroundImage: `url("${previewSrc}")` }}
            aria-hidden="true"
          >
            {hasCustom && enabled ? (
              <span className="absolute left-2 top-2 rounded-full bg-black/45 px-[9px] py-[4px] font-body text-[12px] font-semibold leading-none text-white backdrop-blur-sm">
                Image personnalisée
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      {canToggle ? (
        <SwitchRow
          label="Afficher le fond d’écran"
          description="Photo en haut du tableau de bord"
          checked={enabled}
          onChange={onEnabledChange}
        />
      ) : null}
      {canPick && enabled ? (
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={SETTING_BUTTON_CLASSES} onClick={() => inputRef.current?.click()} disabled={busy}>
              <Icon icon="carbon:upload" className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
              {busy ? 'Enregistrement…' : hasCustom ? 'Changer d’image' : 'Choisir une image'}
            </button>
            {hasCustom ? (
              <button type="button" className={SETTING_BUTTON_CLASSES} onClick={() => { setError(''); onReset() }} disabled={busy}>
                <Icon icon="carbon:reset" className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
                Photo par défaut
              </button>
            ) : null}
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          </div>
          {error ? (
            <p className="m-0 font-body text-[13px] font-semibold leading-[1.2] text-[#b91c1c] dark:text-[var(--color-error)]" role="alert">{error}</p>
          ) : null}
        </div>
      ) : null}
    </SettingsGroup>
  )
}

function AccountModal({
  open,
  onClose,
  onManageAccount,
  onYearChange,
  onTdChange,
  onTpChange,
  displayInfo,
  profilePhotoSrc,
  planningState,
  planningFieldLabels = null,
  lookaheadDays,
  lookaheadOptions,
  onLookaheadChange,
  widgetToggles = [],
  onWidgetVisibilityChange,
  backgroundPreviewSrc = null,
  showWallpaper = true,
  onShowWallpaperChange,
  theme = 'auto',
  onThemeChange,
  hasCustomBackground = false,
  onCustomBackgroundChange,
  onCustomBackgroundReset,
  showAppDescriptions = false,
  onShowAppDescriptionsChange,
  showPlanningWeekend = false,
  onShowPlanningWeekendChange = null,
  planningSelection = null,
  anonymousAnalytics = true,
  onAnonymousAnalyticsChange = null,
}) {
  const [activeSectionId, setActiveSectionId] = useState('account')
  const tabRefs = useRef({})

  useEffect(() => {
    if (!open) {
      return undefined
    }

    function handleKeyDown(event) {
      // An open dropdown takes its own Escape (and marks it handled).
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  if (!open) {
    return null
  }

  const yearOptions = buildSelectOptions(planningState.yearOptions, planningState.draftYear)
  const tdOptions = buildSelectOptions(planningState.tdOptions, planningState.draftTd)
  const tpOptions = buildSelectOptions(planningState.tpOptions, planningState.draftTp)

  const isPlanningBusy = planningState.loading || planningState.applying
  // Only swap the planning selects for the loading dots when there is nothing
  // stored to show — with a stored selection the selects render immediately
  // (disabled) while ADE loads in the background.
  const shouldShowPlanningLoader = planningState.loading && !planningState.draftYear

  const loadingPlaceholder = isPlanningBusy ? 'Chargement...' : 'Choisir'
  const fieldLabels = {
    year: planningFieldLabels?.year || 'Année',
    td: planningFieldLabels?.td || 'Classe TD',
    tp: planningFieldLabels?.tp || 'Classe TP',
  }

  const canConfigureLookahead = typeof onLookaheadChange === 'function'
    && Array.isArray(lookaheadOptions)
    && lookaheadOptions.length > 1
  const canToggleWidgets = typeof onWidgetVisibilityChange === 'function' && widgetToggles.length > 0
  const nextClassToggle = canToggleWidgets ? widgetToggles.find((widget) => widget.id === 'nextClass') : null
  // The lookahead only tunes the "Prochain cours" card, so it lives under that
  // card's switch. Without the card in the list it falls back to Planning.
  const lookaheadInDashboard = canConfigureLookahead && Boolean(nextClassToggle)
  const hasAppearance = typeof onThemeChange === 'function'
    || typeof onCustomBackgroundChange === 'function'
    || typeof onShowWallpaperChange === 'function'
    || typeof onShowAppDescriptionsChange === 'function'
  const hasPrivacy = typeof onAnonymousAnalyticsChange === 'function'

  const sections = [
    { id: 'account', label: 'Compte', icon: 'carbon:user-avatar' },
    { id: 'planning', label: 'Planning', icon: 'carbon:calendar' },
    canToggleWidgets ? { id: 'dashboard', label: 'Tableau de bord', icon: 'carbon:dashboard' } : null,
    hasAppearance ? { id: 'appearance', label: 'Apparence', icon: 'carbon:image' } : null,
    hasPrivacy ? { id: 'privacy', label: 'Confidentialité', icon: 'carbon:locked' } : null,
    { id: 'about', label: 'À propos', icon: 'carbon:information' },
  ].filter(Boolean)
  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0]

  // On phones the tabs scroll sideways: bring the picked one fully into view.
  const selectSection = (sectionId) => {
    setActiveSectionId(sectionId)
    tabRefs.current[sectionId]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }

  const focusSection = (index) => {
    const section = sections[(index + sections.length) % sections.length]
    selectSection(section.id)
    tabRefs.current[section.id]?.focus()
  }

  const handleTabKeyDown = (event) => {
    const index = sections.findIndex((section) => section.id === activeSection.id)
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault()
        focusSection(index + 1)
        break
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault()
        focusSection(index - 1)
        break
      case 'Home':
        event.preventDefault()
        focusSection(0)
        break
      case 'End':
        event.preventDefault()
        focusSection(sections.length - 1)
        break
      default:
        break
    }
  }

  const renderSection = () => {
    switch (activeSection.id) {
      case 'account':
        return (
          <>
            <div className={`${CARD_CLASSES} flex items-center gap-[18px] p-[18px]`}>
              <div className={`flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-[rgba(27,27,27,0.16)] ${MUTED_FILL_CLASSES} dark:border-[var(--color-border)]`}>
                {profilePhotoSrc ? (
                  <img
                    className="h-full w-full object-cover"
                    src={profilePhotoSrc}
                    alt={`Photo de profil de ${displayInfo.firstName || displayInfo.email || 'l’utilisateur'}`}
                  />
                ) : (
                  <Icon icon="carbon:user-avatar-filled-alt" className="h-9 w-9 text-[var(--color-text)]" aria-hidden="true" />
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-[4px]">
                <p className="m-0 truncate font-body text-[19px] font-semibold leading-[1.2] tracking-[-0.3125px]">
                  {[displayInfo.firstName, displayInfo.lastName].filter(Boolean).join(' ') || '—'}
                </p>
                <p className="m-0 truncate font-body text-[14px] font-medium leading-[1.3] text-text-60">
                  {displayInfo.email || '—'}
                </p>
              </div>
            </div>

            {typeof onManageAccount === 'function' ? (
              <SettingsGroup>
                <button type="button" className={PRESSABLE_ROW_CLASSES} onClick={onManageAccount}>
                  <RowText icon="carbon:password" label="Gérer mon compte sur Sésame" />
                  <Icon icon="carbon:launch" className="h-4 w-4 shrink-0 text-text-60" aria-hidden="true" />
                </button>
              </SettingsGroup>
            ) : null}

            <SchoolCertificateGroup />
          </>
        )

      case 'planning':
        return (
          <>
            <SettingsGroup
              title="Mon groupe"
              footer="Sert à trouver tes cours. Le changement s’applique quand tu fermes les réglages."
            >
              {shouldShowPlanningLoader ? (
                <div className="flex h-[162px] w-full items-center justify-center">
                  <AccountModalLoadingDots label={planningState.loadingMessage || 'Chargement...'} />
                </div>
              ) : (
                <>
                  <PlanningSelect
                    label={fieldLabels.year}
                    value={planningState.draftYear?.resourceId ?? ''}
                    options={yearOptions}
                    placeholder={loadingPlaceholder}
                    disabled={isPlanningBusy || yearOptions.length === 0}
                    onChange={onYearChange}
                  />
                  <PlanningSelect
                    label={fieldLabels.td}
                    value={planningState.draftTd?.resourceId ?? ''}
                    options={tdOptions}
                    placeholder={loadingPlaceholder}
                    disabled={isPlanningBusy || !planningState.draftYear}
                    onChange={onTdChange}
                  />
                  <PlanningSelect
                    label={fieldLabels.tp}
                    value={planningState.draftTp?.resourceId ?? ''}
                    options={tpOptions}
                    placeholder={loadingPlaceholder}
                    disabled={isPlanningBusy || !planningState.draftTd}
                    onChange={onTpChange}
                  />
                </>
              )}
            </SettingsGroup>

            {planningState.errorMessage ? (
              <p className="m-0 px-1 font-body text-[13px] font-semibold leading-[1.2] text-[#b91c1c] dark:text-[var(--color-error)]" role="alert">
                {planningState.errorMessage}
              </p>
            ) : null}

            {typeof onShowPlanningWeekendChange === 'function' ? (
              <SettingsGroup title="Semaine">
                <SwitchRow
                  icon="carbon:calendar"
                  label="Week-end"
                  description="Afficher le week-end dans l’emploi du temps"
                  checked={showPlanningWeekend}
                  onChange={onShowPlanningWeekendChange}
                />
              </SettingsGroup>
            ) : null}

            <PlanningExportGroup selection={planningSelection} />

            {canConfigureLookahead && !lookaheadInDashboard ? (
              <SettingsGroup title="Prochain cours">
                <LookaheadSetting days={lookaheadDays} options={lookaheadOptions} onChange={onLookaheadChange} />
              </SettingsGroup>
            ) : null}
          </>
        )

      case 'dashboard':
        return (
          <SettingsGroup title="Cartes affichées" footer="Les cartes masquées disparaissent du haut du tableau de bord.">
            {widgetToggles.map((widget) => (
              <div key={widget.id}>
                <SwitchRow
                  icon={widget.icon}
                  label={widget.label}
                  checked={widget.visible}
                  onChange={(visible) => onWidgetVisibilityChange(widget.id, visible)}
                />
                {widget.id === 'nextClass' && lookaheadInDashboard && widget.visible ? (
                  <div className="border-t border-[var(--color-border)]">
                    <LookaheadSetting days={lookaheadDays} options={lookaheadOptions} onChange={onLookaheadChange} />
                  </div>
                ) : null}
              </div>
            ))}
          </SettingsGroup>
        )

      case 'appearance':
        return (
          <>
            {typeof onThemeChange === 'function' ? (
              <ThemeSetting value={theme} onChange={onThemeChange} />
            ) : null}
            {typeof onCustomBackgroundChange === 'function' || typeof onShowWallpaperChange === 'function' ? (
              <WallpaperSetting
                previewSrc={backgroundPreviewSrc}
                hasCustom={hasCustomBackground}
                enabled={showWallpaper}
                onEnabledChange={onShowWallpaperChange}
                onChange={onCustomBackgroundChange}
                onReset={onCustomBackgroundReset}
              />
            ) : null}
            {typeof onShowAppDescriptionsChange === 'function' ? (
              <SettingsGroup title="Applications">
                <SwitchRow
                  icon="carbon:text-short-paragraph"
                  label="Descriptions des applications"
                  description="Une ligne d’explication sous chaque application"
                  checked={showAppDescriptions}
                  onChange={onShowAppDescriptionsChange}
                />
              </SettingsGroup>
            ) : null}
          </>
        )

      case 'privacy':
        return (
          <PrivacyContent
            embedded
            control={(
              <SettingsGroup>
                <SwitchRow
                  icon="carbon:chart-line"
                  label="Statistiques anonymes"
                  description={anonymousAnalytics ? 'Activées, merci !' : 'Désactivées, plus rien n’est envoyé'}
                  checked={anonymousAnalytics}
                  onChange={onAnonymousAnalyticsChange}
                />
              </SettingsGroup>
            )}
          />
        )

      case 'about':
        return (
          <>
            <ChangelogGroup />
            <div className={`${CARD_CLASSES} p-[18px]`}>
              <AboutContent onPrivacyClick={hasPrivacy ? () => selectSection('privacy') : null} />
            </div>
            <AboutTeam />
          </>
        )

      default:
        return null
    }
  }

  return (
    <div
      className="weather-modal-backdrop fixed inset-0 z-40 flex items-center justify-center bg-backdrop p-5 animate-modal-backdrop-in max-sm:p-[14px]"
      onClick={onClose}
      role="presentation"
    >
      <section
        className="account-modal-card flex h-[600px] w-[min(780px,100%)] max-h-[calc(100vh-40px)] flex-col overflow-hidden corners-[22px] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] animate-modal-card-in max-sm:h-[calc(100dvh-28px)] max-sm:max-h-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-[21px] pb-[12px] pt-[21px]">
          <h2
            id="account-modal-title"
            className="m-0 text-[26.4px] font-bold leading-[26.6px] text-[var(--color-text)]"
          >
            Réglages
          </h2>

          <CloseButton large label="Fermer les réglages" onClick={onClose} />
        </div>

        <div className="flex min-h-0 flex-1 max-sm:flex-col">
          <nav
            className="flex w-[208px] shrink-0 flex-col gap-1 overflow-y-auto px-[13px] pb-[21px] max-sm:w-auto max-sm:flex-row max-sm:overflow-x-auto max-sm:px-[14px] max-sm:pb-[10px] max-sm:[scrollbar-width:none]"
            role="tablist"
            aria-orientation="vertical"
            aria-label="Sections des réglages"
          >
            {sections.map((section) => {
              const isActive = section.id === activeSection.id
              return (
                <button
                  key={section.id}
                  ref={(element) => { tabRefs.current[section.id] = element }}
                  id={`settings-tab-${section.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls="settings-panel"
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => selectSection(section.id)}
                  onKeyDown={handleTabKeyDown}
                  className={`inline-flex h-10 w-full shrink-0 items-center gap-2 rounded-full border px-3 text-left font-body text-[15px] font-medium leading-6 whitespace-nowrap text-text cursor-pointer transition-[background-color,box-shadow,border-color] duration-150 ease-in-out max-sm:w-auto max-sm:h-9 max-sm:text-[14px] ${
                    isActive
                      ? 'bg-widget-bg border-white dark:border-[rgba(255,255,255,0.08)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]'
                      : 'bg-transparent border-transparent hover:bg-brand-subtle'
                  }`}
                >
                  <Icon icon={section.icon} className="h-[17px] w-[17px] shrink-0" aria-hidden="true" />
                  {section.label}
                </button>
              )
            })}
          </nav>

          <div
            key={activeSection.id}
            id="settings-panel"
            role="tabpanel"
            aria-labelledby={`settings-tab-${activeSection.id}`}
            className="account-modal-layout-panel account-modal-layout-panel--compact flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto overscroll-contain pb-[21px] [&>*]:shrink-0 pl-[8px] pr-[21px] max-sm:px-[14px] max-sm:pt-1"
          >
            <h3 className="m-0 font-body text-[19px] font-semibold leading-[1.2] tracking-[-0.3125px] max-sm:hidden">
              {activeSection.label}
            </h3>
            {renderSection()}
          </div>
        </div>
      </section>
    </div>
  )
}

export default AccountModal
