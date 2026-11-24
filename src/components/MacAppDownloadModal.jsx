import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'
import heroImage from '../assets/mac-app/hero.webp'
import appleMenuShot from '../assets/mac-app/apple-menu.webp'
import aboutThisMacShot from '../assets/mac-app/about-this-mac.webp'
import CloseButton from './CloseButton'
import { ChipAppleSilicon, ChipIntel } from './MacChip'
import LentButton from './LentButton'
import { r } from '../register.js'

// « Tafac pour Mac » (Figma: toutatice, node 901:1287): the website on a Mac
// whose browser doesn't say its processor (Safari, Firefox) asks which disk
// image to download. Apple Silicon first, chosen: every Mac sold since
// late 2020. `installers`: { 'darwin-aarch64': url, 'darwin-x86_64': url }
// (src/macAppDownload.js).

const CHOICES = [
  {
    platform: 'darwin-aarch64',
    title: 'Apple Silicon',
    detail: 'Puce M1, M2, M3, M4…',
    tag: 'Mac depuis fin 2020',
    Chip: ChipAppleSilicon,
  },
  {
    platform: 'darwin-x86_64',
    title: 'Intel',
    detail: 'Processeur Intel Core',
    tag: 'Mac jusqu’en 2020',
    Chip: ChipIntel,
  },
]

// The app's sliding curve (the segmented control's thumb, overrides.css):
// the picked card glides on it, what changes with the pick follows.
const GLIDE = 'duration-[380ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none'
const GLIDE_CURVE = '380ms cubic-bezier(0.32, 0.72, 0, 1)'

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// Its width eases to its text's when the text changes (the download
// button's chip name): the button grows or shrinks instead of jumping.
function EasedWidth({ children }) {
  const innerRef = useRef(null)
  const [width, setWidth] = useState(null)
  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner) return undefined
    const measure = () => setWidth(inner.scrollWidth)
    measure()
    // The font landing late changes it too.
    const observer = new ResizeObserver(measure)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [children])
  return (
    <span
      className="inline-block overflow-hidden whitespace-nowrap align-bottom"
      style={{ width: width ?? 'auto', transition: width == null || prefersReducedMotion() ? 'none' : `width ${GLIDE_CURVE}` }}
    >
      <span ref={innerRef} className="inline-block">{children}</span>
    </span>
  )
}

// One option of the chooser, on one row: the chip (never resized, in full
// colour when picked, faded otherwise), its name and its years, the
// wallpaper tiles' check popping in at the end.
function ChoiceContent({ choice, active }) {
  return (
    <>
      <choice.Chip className={`-my-1.5 -ml-1 h-[49px] w-12 shrink-0 transition-[opacity,filter] ${GLIDE} ${active ? 'opacity-100' : 'opacity-75 saturate-[0.6]'}`} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-body text-[15px] font-semibold leading-[1.2]">{choice.title}</span>
        <span className="truncate font-body text-[12.5px] font-normal leading-[1.25] text-text-muted">{choice.tag}</span>
      </span>
      {/* The wallpaper tiles' check (Réglages › Apparence): the tag's
          material, popping in when picked. */}
      <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
        {active ? (
          <span className="wallpaper-tile-check lent-button lent-button--tag relative flex size-5 items-center justify-center rounded-full">
            <Icon icon="ph:check-bold" className="size-[11px]" />
          </span>
        ) : (
          <span className="size-[18px] rounded-full border-[1.5px] border-[color-mix(in_srgb,var(--color-text)_22%,transparent)]" />
        )}
      </span>
    </>
  )
}

// The chooser, in the app's materials: an engraved well (as À propos'
// header) and, over the pick, a card of solid glass gliding to it. A radio
// group: the arrow keys move the pick.
function ChipChooser({ value, onChange }) {
  const index = Math.max(0, CHOICES.findIndex((choice) => choice.platform === value))
  const optionRefs = useRef([])
  const handleKeyDown = (event) => {
    const next = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: 0, ArrowUp: 0, Home: 0, End: 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    onChange(CHOICES[next].platform)
    optionRefs.current[next]?.focus()
  }
  return (
    <div role="radiogroup" aria-label="Puce de ce Mac" className="engraved relative grid grid-cols-2 gap-1 corners-[22px] p-[5px]" onKeyDown={handleKeyDown}>
      {/* The transition inline: .glass-solid's own (its hover colour, in
          overrides.css, unlayered) would win over a utility's. */}
      <span
        className="glass-solid absolute top-[5px] bottom-[5px] left-[5px] w-[calc(50%-7px)] corners-[17px]"
        style={{
          transform: index ? 'translateX(calc(100% + 4px))' : 'translateX(0)',
          transition: prefersReducedMotion() ? 'none' : `transform ${GLIDE_CURVE}, background-color 150ms ease`,
        }}
        aria-hidden="true"
      />
      {CHOICES.map((choice, choiceIndex) => {
        const active = choiceIndex === index
        return (
          <button
            key={choice.platform}
            ref={(element) => { optionRefs.current[choiceIndex] = element }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${choice.title}, ${choice.tag}`}
            title={choice.detail}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(choice.platform)}
            className="relative flex min-w-0 items-center gap-2.5 rounded-[17px] border-0 bg-transparent py-2.5 pr-3 pl-2.5 text-left font-body text-text cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <ChoiceContent choice={choice} active={active} />
          </button>
        )
      })}
    </div>
  )
}

// What only the Mac app does (docs/DESKTOP.md), each with its icon on a
// tile of the primary button's material in its own colour (as the mail's
// unread count wears it in blue: --lent-button-fill).
const MAC_FEATURES = [
  {
    icon: 'ph:key',
    color: '#34a853',
    title: 'Toujours connecté',
    detail: () => r('Reconnecté tout seul quand ta session expire', 'Reconnecté tout seul quand votre session expire'),
  },
  {
    icon: 'ph:graduation-cap',
    color: '#f57c00',
    title: 'Moodle dans l’app',
    detail: () => 'Déjà connecté, aux couleurs de Tafac',
  },
  {
    icon: 'ph:password',
    color: '#1a73e8',
    title: 'Mots de passe de macOS',
    detail: () => 'Remplis depuis l’app Mots de passe',
  },
  {
    icon: 'ph:rocket',
    color: '#8e44d6',
    title: 'Mises à jour automatiques',
    detail: () => 'Installées en arrière-plan',
  },
]

function MacFeatures() {
  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-3.5 p-0 max-[480px]:grid-cols-1" aria-label="Seulement dans l’app Mac">
      {MAC_FEATURES.map((feature) => (
        <li key={feature.title} className="flex min-w-0 items-start gap-2.5">
          <span
            className="lent-button lent-button--tag relative flex size-8 shrink-0 items-center justify-center rounded-[10px]"
            style={{ '--lent-button-fill': feature.color, '--lent-button-ink': '#ffffff' }}
            aria-hidden="true"
          >
            <Icon icon={feature.icon} className="size-[18px]" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5 pt-px">
            <span className="text-[14px] font-semibold leading-[1.2]">{feature.title}</span>
            <span className="text-[12.5px] leading-[1.3] text-text-muted">{feature.detail()}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

// A step's screenshot (macOS 27, dark), in an engraved frame: the Apple
// menu, « À propos de ce Mac » cropped above the serial number.
function StepPhoto({ step, caption, src, position = 'center' }) {
  return (
    <figure className="m-0 flex min-w-0 flex-1 flex-col gap-2">
      <span className="engraved relative block aspect-[4/3] overflow-hidden corners-[14px]">
        <img src={src} alt="" draggable="false" className="absolute inset-0 size-full object-cover" style={{ objectPosition: position }} />
      </span>
      <figcaption className="flex items-baseline gap-1.5 text-[12.5px] leading-[1.25]">
        <span className="font-semibold">{step}</span>
        <span className="text-text-secondary">{caption}</span>
      </figcaption>
    </figure>
  )
}

const POPOVER_WIDTH = 380
const POPOVER_GAP = 10
const VIEWPORT_EDGE = 12

// « Comment savoir ? »: hovering it (or focusing it, or a tap) shows where
// macOS writes the chip, in a frosted panel over the modal. Above the
// trigger, kept inside the window; in a portal, out of the modal's scroll.
function HowToTell() {
  const [isHovered, setIsHovered] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const [position, setPosition] = useState(null)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const panelId = useId()
  const isOpen = isHovered || isFocused || isPinned

  const close = useCallback(() => {
    setIsHovered(false)
    setIsPinned(false)
  }, [])

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current || !panelRef.current) return
    const anchor = triggerRef.current.getBoundingClientRect()
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - 2 * VIEWPORT_EDGE)
    const height = panelRef.current.offsetHeight
    const fitsAbove = anchor.top - POPOVER_GAP - height >= VIEWPORT_EDGE
    setPosition({
      top: fitsAbove ? anchor.top - POPOVER_GAP - height : anchor.bottom + POPOVER_GAP,
      left: Math.min(Math.max(VIEWPORT_EDGE, anchor.left - 8), window.innerWidth - width - VIEWPORT_EDGE),
      width,
      above: fitsAbove,
    })
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return undefined
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [isOpen, close])

  const isShown = isOpen && position != null

  return (
    <span
      className="inline-flex self-start"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setIsHovered(true)
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') setIsHovered(false)
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="inline-flex items-center gap-2 border-0 bg-transparent p-0 text-[14px] font-medium text-text-secondary cursor-pointer transition-colors duration-150 hover:text-text"
        aria-expanded={isOpen}
        aria-describedby={panelId}
        onClick={() => setIsPinned((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && isOpen) {
            event.stopPropagation()
            close()
          }
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false)
          setIsPinned(false)
        }}
      >
        <Icon icon="ph:question" className="size-[18px]" aria-hidden="true" />
        Comment savoir ?
      </button>
      {createPortal(
        <span
          ref={panelRef}
          id={panelId}
          role="tooltip"
          // Opens as the app's modals do (animate-modal-card-in), each time.
          className={`glass pointer-events-none fixed z-[60] flex flex-col gap-3.5 corners-[22px] p-3.5 font-body text-[var(--color-text)] motion-reduce:animate-none ${
            isShown ? 'visible animate-modal-card-in' : 'invisible opacity-0'
          }`}
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            width: position?.width ?? POPOVER_WIDTH,
            transformOrigin: position?.above === false ? 'top left' : 'bottom left',
          }}
        >
          <span className="flex gap-2.5">
            <StepPhoto step="1" caption="Menu Apple" src={appleMenuShot} position="left top" />
            <StepPhoto step="2" caption="À propos de ce Mac" src={aboutThisMacShot} />
          </span>
          <span className="px-0.5 text-[13px] leading-[1.4] text-text-secondary">
            « Puce Apple »&#8239;: Apple Silicon. « Processeur Intel »&#8239;: Intel
          </span>
        </span>,
        document.body,
      )}
    </span>
  )
}

function MacAppDownloadModal({ open, onClose, installers }) {
  const [platform, setPlatform] = useState('darwin-aarch64')
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    // Into the dialog, not onto a button: no focus ring before a key is pressed.
    dialogRef.current?.focus({ preventScroll: true })
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open, onClose])

  if (!open) return null

  const chosen = CHOICES.find((choice) => choice.platform === platform) ?? CHOICES[0]
  // The disk image is sent as an attachment: the page stays where it is.
  const handleDownload = () => {
    const url = installers?.[platform]
    if (url) window.location.assign(url)
    onClose()
  }

  return createPortal(
    <div
      className="weather-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-backdrop p-5 animate-modal-backdrop-in max-sm:p-[14px]"
      onClick={onClose}
      role="presentation"
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="glass-solid glass--quiet modal-surface relative flex outline-none w-[min(560px,100%)] max-h-[calc(var(--app-h)-40px)] flex-col overflow-y-auto overflow-x-hidden corners-[32px] border font-body text-[var(--color-text)] animate-modal-card-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mac-app-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <img
          src={heroImage}
          alt=""
          width="558"
          height="248"
          className="block aspect-[558/248] w-full shrink-0 object-cover"
          draggable="false"
        />
        <CloseButton glass className="absolute top-4 right-4 z-10" label="Fermer" onClick={onClose} />

        <div className="flex flex-col gap-5 px-7 pt-6 pb-2 max-sm:px-5">
          <div className="flex flex-col gap-1.5">
            <h2 id="mac-app-modal-title" className="m-0 font-display text-[28px] font-bold leading-[1.1] tracking-[-0.01em]">
              Tafac pour Mac
            </h2>
            <p className="m-0 text-[15px] leading-[1.4] text-text-secondary">
              {r('Choisis la version qui correspond à la puce de ce Mac', 'Choisissez la version qui correspond à la puce de ce Mac')}
            </p>
          </div>

          <ChipChooser value={platform} onChange={setPlatform} />

          <HowToTell />

          <MacFeatures />
        </div>

        <div className="flex items-center justify-end gap-2.5 px-7 pt-5 pb-7 max-sm:px-5 max-sm:flex-col-reverse max-sm:items-stretch">
          <button
            type="button"
            className="glass-solid inline-flex min-h-[44px] items-center justify-center rounded-full border px-5 text-[15px] font-semibold text-text cursor-pointer"
            onClick={onClose}
          >
            Annuler
          </button>
          <LentButton className="font-semibold!" onClick={handleDownload}>
            <Icon icon="ph:download-simple" className="size-[18px]" aria-hidden="true" />
            Télécharger pour
            {/* The chip's name slides in when the pick changes, the button's
                width easing to it. */}
            <EasedWidth>
              <span key={chosen.platform} className="mac-choice-name">{chosen.title}</span>
            </EasedWidth>
          </LentButton>
        </div>
      </section>
    </div>,
    document.body,
  )
}

export default MacAppDownloadModal
