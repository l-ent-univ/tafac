import { useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import appsIcon from '../assets/home-icons/apps.png'
import assiduityIcon from '../assets/home-icons/assiduity.png'
import averageIcon from '../assets/home-icons/average.png'
import calendarIcon from '../assets/home-icons/calendar.png'
import gradesIcon from '../assets/home-icons/grades.png'
import homeworkIcon from '../assets/home-icons/homework.png'
import mailIcon from '../assets/home-icons/mail.png'
import menuIcon from '../assets/home-icons/menu.png'
import { HOME_CARD_ORDER, layoutHomeCards } from '../homeCardsLayout'
import { r } from '../register.js'

// « Accueil »'s icons, as its cards and greeting row show them.
const CARD_ICONS = {
  nextClass: calendarIcon,
  average: averageIcon,
  mail: mailIcon,
  latestGrade: gradesIcon,
  deadlines: homeworkIcon,
  assiduity: assiduityIcon,
}

// A tile's place in the miniature's grid (layoutHomeCards).
const PLACE_CLASSES = { tall: 'row-span-2 min-h-[152px]', half: '', full: 'col-span-full' }

const GREETING_ICONS = [
  { src: appsIcon, rotate: -9 },
  { src: calendarIcon, rotate: 7 },
  { src: gradesIcon, rotate: -4 },
  { src: homeworkIcon, rotate: 10 },
  { src: mailIcon, rotate: -7 },
  { src: menuIcon, rotate: 6 },
]

// A card of the miniature: a switch the size of its card. Shown, it's a
// white card with its icon and a check; hidden, a dashed outline in its
// place, so it can come back. `refusing`: the last card shown, just asked
// to go; it shakes (the key replays it on each try).
function CardTile({ widget, onToggle, refusing = null, className = '' }) {
  const shown = widget.visible
  return (
    <button
      key={refusing ?? 'idle'}
      type="button"
      role="switch"
      aria-checked={shown}
      onClick={() => onToggle(widget)}
      className={`${refusing ? 'home-tile-refuse ' : ''}group relative flex min-w-0 flex-col items-start justify-between gap-2 corners-[14px] border p-[10px] text-left cursor-pointer transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text ${shown
        ? 'border-white bg-widget-bg shadow-[0_1px_3px_rgba(0,0,0,0.08)] hover:shadow-[0_3px_10px_rgba(0,0,0,0.1)] dark:border-[var(--color-border)]'
        : 'border-dashed border-text-30 bg-transparent hover:border-text-50 hover:bg-widget-bg/40'} ${className}`}
    >
      <img
        src={CARD_ICONS[widget.id]}
        alt=""
        width="22"
        height="22"
        draggable="false"
        className={`size-[22px] shrink-0 select-none transition-[opacity,filter] duration-150 ${shown ? '' : 'opacity-40 grayscale'}`}
      />
      <span className="flex min-w-0 max-w-full flex-col gap-[2px]">
        <span className={`truncate font-body text-[13px] font-semibold leading-[1.2] tracking-[-0.1px] ${shown ? 'text-[var(--color-text)]' : 'text-text-50'}`}>
          {widget.label}
        </span>
        <span className="font-body text-[11px] font-medium leading-none text-text-50">
          {shown ? 'Affichée' : 'Masquée'}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={`absolute right-[8px] top-[8px] flex size-[18px] items-center justify-center rounded-full transition-colors duration-150 ${shown ? 'bg-text text-widget-bg' : 'border border-text-30 text-transparent group-hover:border-text-50'}`}
      >
        <Icon icon="ph:check-bold" className="size-[10px]" />
      </span>
    </button>
  )
}

// Réglages › Accueil: « Accueil » in miniature, laid out as the
// page lays its cards out (HomeDraftPage): the tinted band with the
// greeting (and the wallpaper, when on), the favourites' row, then the
// cards placed as the page places them (layoutHomeCards): « Prochains
// cours » down the left beside « Moyenne » over « Mails », then
// « Dernières notes » beside « Échéances ». Each card is a switch; only the
// cards this student can get are drawn, the others close up.
function HomeLayoutSetting({ widgets, onChange, wallpaperSrc = null, firstName = '' }) {
  const byId = Object.fromEntries(widgets.map((widget) => [widget.id, widget]))
  const place = layoutHomeCards(widgets.map((widget) => widget.id))
  const shownCount = widgets.filter((widget) => widget.visible).length
  // The last card shown stays: asked to go, it shakes and the line under
  // the miniature says why, for a moment. { id, count } (count replays).
  const [refusal, setRefusal] = useState(null)
  const refusalTimeoutRef = useRef(null)
  useEffect(() => () => window.clearTimeout(refusalTimeoutRef.current), [])

  const toggle = (widget) => {
    if (widget.visible && shownCount <= 1) {
      setRefusal((current) => ({ id: widget.id, count: (current?.count ?? 0) + 1 }))
      window.clearTimeout(refusalTimeoutRef.current)
      refusalTimeoutRef.current = window.setTimeout(() => setRefusal(null), 2400)
      return
    }
    setRefusal(null)
    onChange(widget.id, !widget.visible)
  }
  const tileProps = (id) => ({
    widget: byId[id],
    onToggle: toggle,
    refusing: refusal?.id === id ? refusal.count : null,
  })
  const greeting = firstName ? `Salut ${firstName} !` : 'Salut !'

  return (
    <div className="flex flex-col gap-[7px]">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h4 className="m-0 font-body text-[13px] font-semibold leading-none text-text-60">Cartes de l’accueil</h4>
        <span className="font-body text-[13px] font-medium leading-none text-text-50">
          {shownCount} sur {widgets.length}
        </span>
      </div>

      <div className="overflow-hidden modal-inner-corners border border-white bg-bg shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:border-[var(--color-border)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
        {/* The band: not a card, always there. */}
        <div
          aria-hidden="true"
          className="relative flex min-h-[92px] flex-col justify-end gap-[6px] overflow-hidden border-b border-[color-mix(in_srgb,var(--color-brand)_14%,var(--color-bg))] bg-[color-mix(in_srgb,var(--color-brand)_5%,var(--color-bg))] px-3 pb-3 pt-4 dark:border-[color-mix(in_srgb,#ffffff_11%,var(--color-bg))] dark:bg-[color-mix(in_srgb,#ffffff_4%,var(--color-bg))]"
        >
          {wallpaperSrc ? (
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-[70%] bg-cover bg-[center_40%] opacity-90 [mask-image:linear-gradient(to_right,transparent,black_55%)] dark:opacity-70"
              style={{ backgroundImage: `url("${wallpaperSrc}")` }}
            />
          ) : null}
          <div className="relative flex items-center gap-[3px]">
            {GREETING_ICONS.map(({ src, rotate }) => (
              <img
                key={src}
                src={src}
                alt=""
                width="18"
                height="18"
                draggable="false"
                className="size-[18px] shrink-0 select-none"
                style={{ transform: `rotate(${rotate}deg)` }}
              />
            ))}
          </div>
          <div className="relative flex min-w-0 items-center gap-2">
            <span className="truncate font-body text-[15px] font-bold leading-[1.15] text-[var(--color-text)]">{greeting}</span>
            <span className="h-[6px] w-[72px] shrink-0 rounded-full bg-text-30 opacity-60" />
          </div>
        </div>

        <div className="flex flex-col gap-[10px] p-3">
          {/* « Applications »: the favourites' tiles. */}
          <div className="flex items-center gap-[6px]" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((index) => (
              <span key={index} className="size-[22px] shrink-0 corners-[7px] bg-text-30 opacity-40" />
            ))}
          </div>

          <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] auto-rows-[minmax(72px,auto)] gap-2">
            {HOME_CARD_ORDER.filter((id) => byId[id]).map((id) => (
              <CardTile key={id} {...tileProps(id)} className={PLACE_CLASSES[place[id]]} />
            ))}
          </div>
        </div>
      </div>

      <p
        className={`m-0 flex items-center gap-[6px] px-1 font-body text-[13px] font-medium leading-[1.4] transition-colors duration-150 ${refusal ? 'text-[var(--color-text)]' : 'text-text-50'}`}
        role="status"
        aria-live="polite"
      >
        {refusal ? (
          <>
            <Icon icon="ph:info-bold" className="size-[14px] shrink-0" aria-hidden="true" />
            {r('Garde au moins une carte sur l’accueil', 'Gardez au moins une carte sur l’accueil')}
          </>
        ) : r('Touche une carte pour l’afficher ou la masquer', 'Touchez une carte pour l’afficher ou la masquer')}
      </p>
    </div>
  )
}

export default HomeLayoutSetting
