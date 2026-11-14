import { Icon } from '@iconify/react'
import universityConfig from '@university'
import { isServiceNoticeHiddenByDebug } from '../serviceNoticeDebug'

const notice = isServiceNoticeHiddenByDebug() ? null : universityConfig.serviceNotice ?? null

// University-wide outage banner (`serviceNotice` in the university's
// client.js). Renders nothing when the config has none, or when the debug
// panel hides it (src/serviceNoticeDebug.js). Raised, in solid glass
// tinted amber (.service-notice).
export default function ServiceNotice({ className = '' }) {
  if (!notice) return null

  return (
    <div role="status" className={`service-notice flex items-start gap-3 corners-[20px] px-4 py-3 text-left text-text ${className}`}>
      <Icon icon="ph:warning-circle-fill" className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[#b76e00]" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1 font-body">
        <p className="m-0 text-sm font-semibold leading-[1.4]">{notice.title}</p>
        {notice.detail ? <p className="m-0 text-[13px] leading-[1.5] text-text-muted">{notice.detail}</p> : null}
      </div>
    </div>
  )
}
