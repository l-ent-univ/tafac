import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'
import { getLinkPreview } from '../../entApi'
import LoadingDots from '../LoadingDots'

const WIDTH = 320
const MARGIN = 12

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// A link's preview under (or over) it, as the site shows it (its image,
// name, title and description; server/linkPreview.js). Its real address
// always shows, so a link can't pass for another. Opens the link; stays
// while the pointer is on it. `anchor`: the link's box on screen.
export default function LinkPreviewCard({ url, anchor, onPointerEnter, onPointerLeave }) {
  const [loaded, setLoaded] = useState({ url: null, preview: null })
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setImageFailed(false)
    getLinkPreview(url).then((preview) => {
      if (alive) setLoaded({ url, preview })
    })
    return () => {
      alive = false
    }
  }, [url])

  const isLoading = loaded.url !== url
  const preview = isLoading ? null : loaded.preview
  const host = hostOf(url)
  const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN)
  const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - width - MARGIN))
  // Over the link when it sits low on the screen.
  const placement = anchor.bottom > window.innerHeight * 0.6
    ? { bottom: window.innerHeight - anchor.top + 8 }
    : { top: anchor.bottom + 8 }

  return createPortal(
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed z-60 flex flex-col overflow-hidden rounded-[18px] border border-border bg-widget-bg text-text no-underline shadow-[0_18px_40px_var(--color-shadow)] animate-context-menu-in"
      style={{ left, width, ...placement }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      aria-label={`${preview?.title ?? host}, ouvrir ${host}`}
    >
      {preview?.image && !imageFailed ? (
        <img
          src={preview.image}
          alt=""
          referrerPolicy="no-referrer"
          className="aspect-[1.91] w-full object-cover bg-bg-subtle"
          onError={() => setImageFailed(true)}
        />
      ) : null}
      <span className="flex flex-col gap-1.5 px-4 py-3 font-body">
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-text-muted">
          {preview?.icon ? <img src={preview.icon} alt="" referrerPolicy="no-referrer" className="size-4 shrink-0 rounded-[4px]" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : <Icon icon="carbon:earth" className="size-4 shrink-0" aria-hidden="true" />}
          <span className="truncate">{preview?.siteName ?? host}</span>
        </span>
        {isLoading ? <LoadingDots label={null} className="w-6 py-1" /> : (
          <>
            <span className="line-clamp-2 text-[14.5px] font-semibold leading-snug text-text">{preview?.title ?? 'Aperçu indisponible'}</span>
            {preview?.description ? <span className="line-clamp-2 text-[13px] leading-snug text-text-secondary">{preview.description}</span> : null}
          </>
        )}
        <span className="flex min-w-0 items-center gap-1 pt-0.5 text-[12px] font-medium text-text-muted">
          <Icon icon="carbon:arrow-up-right" className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{host}</span>
        </span>
      </span>
    </a>,
    document.body,
  )
}
