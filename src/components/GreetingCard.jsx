import { Icon } from '@iconify/react'
import { useContextMenu } from '../useContextMenu'
import useDailyBriefing from '../useDailyBriefing'
import LoadingDots from './LoadingDots'
import { r } from '../register.js'

// `headingAs`: the greeting's tag ('p' where the card is only a demo, as on
// the landing page).
function GreetingCard({
  displayName,
  greeting,
  visible = false,
  onDismiss,
  classesSource = null,
  classesCacheKey = '',
  selection = null,
  lookaheadDays,
  expectDeadlines = false,
  headingAs = 'h2',
}) {
  const Heading = headingAs
  const briefing = useDailyBriefing({
    classesSource,
    classesCacheKey,
    selection,
    lookaheadDays,
    expectDeadlines,
  })
  const subtitle = greeting ?? briefing.text
  const isLoading = greeting == null && briefing.loading
  // Its right-click menu: the close button's « Masquer ».
  const menuProps = useContextMenu(typeof onDismiss === 'function'
    ? () => [{ id: 'hide', label: 'Masquer', icon: 'ph:eye-slash', onSelect: onDismiss }]
    : null)

  return (
    // On phones the card shrinks to what it says: the wave sits beside the
    // heading instead of above it, and the card loses its minimum height.
    <article className={`greeting-card widget-card group relative shadow-md flex-[0_1_280px] min-h-[140px] p-4 border border-white card-corners overflow-hidden bg-widget-bg text-base leading-6 min-w-0 max-2xl:flex-[1_1_calc(50%-6px)] max-2xl:min-w-[min(280px,100%)] max-md:min-h-[124px] max-md:p-3 max-xs:flex-[1_1_100%] max-xs:min-w-0 max-xs:min-h-0 flex flex-col justify-end gap-1 text-text ${visible ? 'widget-card-visible' : ''}`} {...menuProps()}>
      <div className="contents max-xs:flex max-xs:items-center max-xs:gap-2 max-xs:min-w-0 max-xs:pr-8">
        <Icon icon="ph:hand-waving" className="greeting-icon w-[34px] h-[34px] text-inherit shrink-0 max-xs:w-[26px] max-xs:h-[26px]" aria-hidden="true" />
        <Heading className="m-0 min-w-0 leading-[1.15] text-2xl font-bold overflow-hidden text-ellipsis whitespace-nowrap max-md:text-[22px] max-xs:text-xl" title={`Salut ${displayName} !`}>Salut {displayName} !</Heading>
      </div>
      {isLoading ? (
        <LoadingDots label={r('Chargement du résumé de ta journée', 'Chargement du résumé de votre journée')} className="h-[18px] text-text-muted" />
      ) : subtitle ? (
        <p className="m-0 leading-[1.2] text-[15px] font-medium line-clamp-2" title={subtitle}>{subtitle}</p>
      ) : null}
      {typeof onDismiss === 'function' ? (
        // 44px hit area on touch screens, same 16px cross.
        <button
          type="button"
          className="absolute top-2.5 right-2.5 inline-flex items-center justify-center w-7 h-7 p-0 border-0 rounded-full bg-transparent text-text-muted opacity-0 cursor-pointer transition-[opacity,background-color,color] duration-[120ms] ease-in-out hover:bg-brand-subtle hover:text-text group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 max-md:top-0.5 max-md:right-0.5 max-md:w-11 max-md:h-11"
          onClick={onDismiss}
          aria-label="Masquer la carte de bienvenue"
          title="Masquer (réactivable dans Mon compte)"
        >
          <Icon icon="ph:x" className="w-4 h-4" aria-hidden="true" />
        </button>
      ) : null}
    </article>
  )
}

export default GreetingCard
