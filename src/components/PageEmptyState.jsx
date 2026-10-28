import { Icon } from '@iconify/react'

// Whole-page empty state for the in-app pages (nothing to show yet): an icon
// in a soft disc, a title and a line of explanation, centred under the page
// header. `action`: a button under it, when there's something to do.
function PageEmptyState({ icon, title, children = null, action = null }) {
  return (
    <div className="page-enter flex flex-col items-center justify-center gap-3 px-6 py-16 text-center max-md:py-12" role="status">
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-brand-subtle text-text" aria-hidden="true">
        <Icon icon={icon} className="size-[26px]" />
      </span>
      <p className="m-0 font-body text-[17px] font-semibold leading-[1.2] text-text">{title}</p>
      {children ? (
        <p className="m-0 max-w-[360px] font-body text-[15px] font-medium leading-[1.4] text-text-secondary">{children}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

export default PageEmptyState
