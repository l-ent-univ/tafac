import { useContext } from 'react'
import { Icon } from '@iconify/react'
import { NodeViewWrapper } from '@tiptap/react'
import { MailInlineImageContext } from '../mailInlineImageContext'
import SmoothSurface from './SmoothSurface'

// An image of the text as the composer shows it (the mailInlineImage node,
// src/mailInlineImageNode.js): from the composer's item (its file's URL, a
// resumed draft's part), dimmed while it uploads; failed, it says it won't
// go (the send leaves it out, the summary above it says the same in text)
// and offers to try again. Its button takes it out of the text.
function MailInlineImageView({ node, selected, deleteNode }) {
  const images = useContext(MailInlineImageContext)
  const { cid, alt, width, height } = node.attrs
  const item = images?.items.get(cid) ?? null
  const busy = item && (item.status === 'queued' || item.status === 'uploading')
  const failed = item?.status === 'error'
  const missing = !item || !item.url
  const ratio = width && height ? `${width} / ${height}` : undefined

  return (
    <NodeViewWrapper as="div" className="mail-inline-image group/image relative my-2 w-fit max-w-full" contentEditable={false} data-inline-cid={cid}>
      {missing ? (
        <div className="flex min-h-[72px] w-[min(360px,100%)] items-center gap-2 corners-[14px] engraved status-tag--dashed px-4 font-body text-[13.5px] font-medium text-text-muted">
          <Icon icon="ph:image" className="size-4 shrink-0" aria-hidden="true" />
          <span>Image indisponible</span>
        </div>
      ) : (
        <img
          src={item.url}
          alt={alt}
          width={width ?? undefined}
          height={height ?? undefined}
          draggable={false}
          className={`block h-auto max-w-full corners-[16px] border border-border transition-opacity duration-200 ${busy || failed ? 'opacity-45' : ''} ${selected ? 'outline-2 outline-offset-2 outline-text' : ''}`}
          style={{ aspectRatio: ratio }}
        />
      )}
      {busy ? (
        <span className="glass-solid pointer-events-none absolute bottom-3 left-3 rounded-full px-3 py-[7px] font-body text-[12.5px] font-semibold leading-none text-text-secondary" role="status">
          Chargement de l’image…
        </span>
      ) : null}
      {failed ? (
        <span className="absolute bottom-3 left-3 flex flex-wrap items-center gap-2" role="alert">
          <span className="glass-solid inline-flex items-center gap-[6px] rounded-full px-3 py-[7px] font-body text-[12.5px] font-semibold leading-none text-error">
            <Icon icon="ph:warning" className="size-[14px]" aria-hidden="true" />
            <span>Image non chargée, elle ne partira pas</span>
          </span>
          <button
            type="button"
            onClick={() => images?.retry(cid)}
            className="lent-button inline-flex items-center gap-[6px] rounded-full px-3 py-[7px] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
          >
            <SmoothSurface />
            <Icon icon="ph:arrows-clockwise" className="size-[14px]" aria-hidden="true" />
            <span className="font-body text-[12.5px] font-medium leading-none">Réessayer</span>
          </button>
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => deleteNode()}
        aria-label="Retirer l’image"
        className="glass-solid absolute top-2 right-2 inline-flex size-8 items-center justify-center rounded-full border-0 p-0 text-text cursor-pointer opacity-0 transition-opacity duration-150 group-hover/image:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-text max-4xl:opacity-100"
      >
        <Icon icon="ph:x" className="size-[18px]" aria-hidden="true" />
      </button>
    </NodeViewWrapper>
  )
}

export default MailInlineImageView
