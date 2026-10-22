import { Icon } from '@iconify/react'

// The in-app pages' frame, after « Mes notes » (GradesPage): the page's top
// on the tinted band (.page-top-band) with the title, its controls right
// after it and the actions at the end of the row, then an overview (cards,
// notices); the detail below, on the plain background. On a phone the band
// tops the screen: the app's top bar is hidden on these pages (App.jsx).

// A page action: a white pill, an icon in a round button on a phone (touch
// area 44px). `label` stays its accessible name there.
export const PAGE_BUTTON = 'relative inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-widget-bg px-3.5 py-2 font-body text-[14px] font-semibold text-text no-underline cursor-pointer transition-colors duration-150 hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-45 max-md:size-10 max-md:justify-center max-md:p-0 max-md:shadow-xs max-md:after:absolute max-md:after:-inset-[3px]'
// The page's one highlighted action (Simuler, Nouveau message…): the warm
// accent of « Mes notes » (.accent-button).
export const PAGE_ACCENT_BUTTON = PAGE_BUTTON.replace('border-border bg-widget-bg', 'accent-button').replace('hover:bg-bg-subtle ', '')
// Add to a PageButton's className: an icon in a round button everywhere
// (secondary actions), its label kept as the accessible name.
export const ICON_ONLY = 'md:size-10 md:justify-center md:p-0 [&>span]:hidden'
// Inside a card or a section: a smaller pill that keeps its text everywhere.
export const INLINE_BUTTON = 'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-widget-bg px-3 py-1.5 font-body text-[13px] font-semibold text-text no-underline cursor-pointer transition-colors duration-150 hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-45'
export const PRIMARY_BUTTON = 'inline-flex shrink-0 items-center gap-1.5 rounded-full border-0 bg-brand px-4 py-2 font-body text-[14px] font-semibold text-bg no-underline cursor-pointer transition-colors duration-150 hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-45'

// The cards of the pages, as « Mes notes » draws them: white, a white
// hairline, a soft shadow.
export const PAGE_CARD = 'widget-card widget-card-visible shadow-md border border-white rounded-[22px] bg-widget-bg text-text min-w-0 max-md:rounded-[20px]'

export function PageButton({ icon, label, onClick, href = null, accent = false, className = '', children = null, ...rest }) {
  const classes = `${accent ? PAGE_ACCENT_BUTTON : PAGE_BUTTON} ${className}`
  const content = (
    <>
      {icon ? <Icon icon={icon} className="size-4 max-md:size-[18px]" aria-hidden="true" /> : null}
      <span className="max-md:hidden">{label}</span>
      {children}
    </>
  )

  return href ? (
    <a href={href} className={classes} aria-label={label} target="_blank" rel="noopener noreferrer" {...rest}>{content}</a>
  ) : (
    <button type="button" onClick={onClick} className={classes} aria-label={label} {...rest}>{content}</button>
  )
}

// `controls`: next to the title (a semester, a period). `actions`: at the
// end of the row. `overview`: the band's cards and notices. `bare`: no band
// (a page that puts a full-height tool right under its title).
export function AppPage({ titleId, title, subtitle = null, controls = null, actions = null, overview = null, footer = null, bare = false, children = null, className = '' }) {
  return (
    <section className={`grades-page w-full grid grid-cols-[minmax(0,1fr)] content-start gap-4 pt-4 px-6 pb-6 4xl:pt-5 max-md:px-3 max-md:pt-3 max-md:pb-5 max-md:gap-3 ${className}`} aria-labelledby={titleId}>
      <div className={bare ? 'grid grid-cols-[minmax(0,1fr)] gap-4' : 'page-top-band grid grid-cols-[minmax(0,1fr)] gap-5 -mx-6 -mt-4 px-6 pt-4 pb-6 4xl:-mt-5 4xl:pt-5 max-md:-mx-3 max-md:-mt-3 max-md:gap-4 max-md:px-3 max-md:pt-5 max-md:pb-4'}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2 max-md:flex-nowrap max-md:items-center max-md:gap-x-2">
          <div className="flex min-w-0 flex-col gap-1 max-md:mr-auto">
            <h1 id={titleId} className="m-0 leading-[1.15] text-2xl font-bold max-md:flex max-md:min-h-10 max-md:items-center max-md:text-[26px] max-md:tracking-[-0.01em]">{title}</h1>
          </div>
          {controls}
          {actions ? (
            <div className="ml-auto flex items-center gap-2 self-center max-md:ml-0 max-md:shrink-0">{actions}</div>
          ) : null}
        </div>
        {subtitle ? (
          <p className="mb-0 -mt-3 font-body text-[15px] font-medium text-text-secondary max-md:-mt-2 max-md:text-[14px]" aria-live="polite">{subtitle}</p>
        ) : null}
        {overview}
      </div>
      {children}
      {footer ? <p className="m-0 pt-2 text-center font-body text-[13px] font-medium leading-none text-text-muted">{footer}</p> : null}
    </section>
  )
}

// A titled part of a page, like « Dernières notes »: an icon and a title in
// the brand colour, `aside` at the end of the row.
export function PageSection({ id, icon, title, count = null, aside = null, children, className = '', ...rest }) {
  return (
    <section className={`grid gap-3 min-w-0 ${className}`} aria-labelledby={id} {...rest}>
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-[5px] text-brand">
          {icon ? <Icon icon={icon} className="w-[17px] h-[17px] shrink-0" aria-hidden="true" /> : null}
          <h2 id={id} className="m-0 font-body text-base font-medium leading-[1.06]">
            {title}
            {count != null ? <span className="ml-1.5 text-text-muted">{count}</span> : null}
          </h2>
        </div>
        {aside ? <div className="ml-auto flex items-center gap-2">{aside}</div> : null}
      </div>
      {children}
    </section>
  )
}

// A figure in the band (« 3 h injustifiées », « 12 non lus »): the cards of
// « Mes notes »' overview, a label on top and the number at the bottom.
// `tone`: 'alert' for what needs action. On a phone the row scrolls sideways
// (StatRow).
export function StatCard({ label, value, unit = null, detail = null, icon = null, tone = 'default', onClick = null, className = '' }) {
  const Tag = onClick ? 'button' : 'article'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick ?? undefined}
      className={`${PAGE_CARD} relative flex min-h-[132px] w-[220px] flex-[0_1_220px] flex-col gap-[6px] p-4 text-left max-md:min-h-[116px] max-md:flex-[1_0_clamp(136px,42%,180px)] max-md:snap-start max-md:p-3 ${onClick ? 'cursor-pointer transition-colors duration-150 hover:bg-bg-subtle' : ''} ${className}`}
    >
      <span className="flex min-w-0 items-center gap-[5px] font-body text-base font-medium leading-[1.06] text-text-muted max-md:text-[14px]">
        {icon ? <Icon icon={icon} className="size-4 shrink-0" aria-hidden="true" /> : null}
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <span className="mt-auto flex items-baseline gap-1">
        <span className={`font-display text-[40px] font-bold leading-none tracking-[-0.02em] max-md:text-[32px] ${tone === 'alert' ? 'text-error' : 'text-text'}`}>{value}</span>
        {unit ? <span className="font-body text-[15px] font-semibold text-text-muted">{unit}</span> : null}
      </span>
      {detail ? <span className="font-body text-[13px] font-medium leading-snug text-text-secondary">{detail}</span> : null}
    </Tag>
  )
}

export function StatRow({ children }) {
  return (
    <div className="flex flex-wrap items-stretch gap-3 max-md:-mx-3 max-md:-mt-2 max-md:-mb-7 max-md:flex-nowrap max-md:gap-2 max-md:overflow-x-auto max-md:snap-x max-md:snap-mandatory max-md:scroll-px-3 max-md:px-3 max-md:pt-2 max-md:pb-7 favorites-scroll-hide">
      {children}
    </div>
  )
}
