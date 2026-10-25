import { Icon } from '@iconify/react'
import universityConfig from '@university'
import { isServiceNoticeHiddenByDebug } from '../serviceNoticeDebug'

const notice = isServiceNoticeHiddenByDebug() ? null : universityConfig.serviceNotice ?? null

// University-wide outage banner (`serviceNotice` in the university's
// client.js). Renders nothing when the config has none, or when the debug
// panel hides it (src/serviceNoticeDebug.js).
export default function ServiceNotice({ className = '' }) {
  if (!notice) return null

  return (
    <div role="status" className={`flex items-start gap-3 rounded-[20px] border border-[#f2cf8f] bg-[#fff7e8] px-4 py-3 text-left text-text shadow-[0_10px_30px_rgba(0,0,0,0.05)] dark:border-[#6a4d15] dark:bg-[#2f2410] ${className}`}>
      <Icon icon="carbon:warning-filled" className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[#b76e00]" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1 font-body">
        <p className="m-0 text-sm font-semibold leading-[1.4]">{notice.title}</p>
        {notice.detail ? <p className="m-0 text-[13px] leading-[1.5] text-text-muted">{notice.detail}</p> : null}
      </div>
    </div>
  )
}
