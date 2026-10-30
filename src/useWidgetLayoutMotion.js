import { useEffect } from 'react'

// The dashboard's widgets glide to their new place when the row lays them
// out again, instead of jumping: a card widening (Prochain cours), one
// loading in or going away (the others closing the gap), the row
// rearranging past a breakpoint. Purely visual: the cards are laid out at
// once where they end up, and only painted from where they were (a
// `translate` gliding back to 0) and, when they grew, from the size they had
// (a clip-path opening up to the new size). Nothing animated touches the
// layout, so the row never rewraps mid-way. `translate`, not `transform`,
// which the cards' intro uses. While a window is being resized the cards
// follow the row at once: only a jump (a card changing size by more than the
// row did, or changing height or line) animates. Nothing with reduced
// motion.

const DURATION_MS = 420
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
const CARD_SELECTOR = '.widget-card'
// Below this, a change is rounding.
const TOLERANCE_PX = 1
// A card resizing by this much more than the row did jumped (a breakpoint).
const JUMP_PX = 8

function readBox(card) {
  return { width: card.offsetWidth, height: card.offsetHeight, left: card.offsetLeft, top: card.offsetTop }
}

const LAYOUT_ANIMATION = 'widget-layout'
const FADE_ANIMATION = 'widget-layout-fade'

// Where a card shows now, against its layout box `box`: shifted by a glide
// still under way, cut by an opening clip. A change landing mid-glide starts
// from there, without a jump.
function readShownBox(card, box) {
  const style = getComputedStyle(card)
  const [tx = 0, ty = 0] = style.translate === 'none' ? [] : style.translate.split(' ').map((value) => Number.parseFloat(value) || 0)
  const inset = style.clipPath.match(/^inset\(\S+ (\S+) (\S+)/)
  const right = inset ? Number.parseFloat(inset[1]) || 0 : 0
  const bottom = inset ? Number.parseFloat(inset[2]) || 0 : 0
  return { left: box.left + tx, top: box.top + ty, width: box.width - right, height: box.height - bottom }
}

function differs(before, after) {
  return Math.abs(before.width - after.width) > TOLERANCE_PX
    || Math.abs(before.height - after.height) > TOLERANCE_PX
    || Math.abs(before.left - after.left) > TOLERANCE_PX
    || Math.abs(before.top - after.top) > TOLERANCE_PX
}

// The clip showing `size` of a card laid out at `box`, its corners kept.
function clipTo(card, box, size) {
  const radius = getComputedStyle(card).borderTopLeftRadius || '0px'
  const right = Math.max(0, box.width - size.width)
  const bottom = Math.max(0, box.height - size.height)
  return `inset(0px ${right}px ${bottom}px 0px round ${radius})`
}

// `before`: where the card showed (readShownBox), null for a card coming in.
function animateCard(card, before, after) {
  const options = { duration: DURATION_MS, easing: EASING, id: LAYOUT_ANIMATION }

  // A card coming in: opens up from its left edge, fading in once the
  // intro is over (during it, the intro's own fade runs).
  if (!before) {
    card.animate([
      { clipPath: clipTo(card, after, { width: 0, height: after.height }) },
      { clipPath: clipTo(card, after, after) },
    ], options)
    if (card.classList.contains('widget-card-visible')) {
      card.animate([{ opacity: 0 }, { opacity: 1 }], { ...options, id: FADE_ANIMATION })
    }
    return
  }

  const dx = before.left - after.left
  const dy = before.top - after.top
  if (Math.abs(dx) > TOLERANCE_PX || Math.abs(dy) > TOLERANCE_PX) {
    card.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], options)
  }
  // Grown: shown at its old size first, opening up to the new one. A card
  // that shrank just takes its new size (a clip can't paint it bigger).
  if (after.width - before.width > TOLERANCE_PX || after.height - before.height > TOLERANCE_PX) {
    card.animate([
      { clipPath: clipTo(card, after, { width: Math.min(before.width, after.width), height: Math.min(before.height, after.height) }) },
      { clipPath: clipTo(card, after, after) },
    ], options)
  }
}

function cancelLayoutAnimations(card) {
  card.getAnimations().forEach((animation) => {
    if (animation.id === LAYOUT_ANIMATION) animation.cancel()
  })
}

export function useWidgetLayoutMotion(rowRef) {
  useEffect(() => {
    const row = rowRef.current
    if (!row || typeof ResizeObserver === 'undefined' || typeof row.animate !== 'function') return undefined

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const listCards = () => [...row.querySelectorAll(CARD_SELECTOR)]
    let boxes = new Map(listCards().map((card) => [card, readBox(card)]))
    let rowWidth = row.offsetWidth

    function settle() {
      const cards = listCards()
      const previous = boxes
      const previousRowWidth = rowWidth
      boxes = new Map(cards.map((card) => [card, readBox(card)]))
      rowWidth = row.offsetWidth

      // Hidden behind another page, back from it, or no motion wanted.
      if (rowWidth === 0 || previousRowWidth === 0 || reducedMotion?.matches) return

      const rowDelta = Math.abs(rowWidth - previousRowWidth)
      const jumped = (card) => {
        const before = previous.get(card)
        const after = boxes.get(card)
        if (!before) return true
        if (rowDelta <= TOLERANCE_PX) return differs(before, after)
        // The window is being resized: only a jump animates.
        return Math.abs(before.width - after.width) > rowDelta + JUMP_PX
          || Math.abs(before.height - after.height) > TOLERANCE_PX
          || before.top !== after.top
      }
      if (!cards.some(jumped)) return

      // Where each card shows, read before anything is cancelled.
      const shown = new Map(cards.map((card) => [card, previous.has(card) ? readShownBox(card, previous.get(card)) : null]))
      cards.forEach((card) => {
        const from = shown.get(card)
        const to = boxes.get(card)
        if (from && !differs(from, to)) return
        cancelLayoutAnimations(card)
        animateCard(card, from, to)
      })
    }

    // The animations only paint: these fire on real layout changes.
    const resizeObserver = new ResizeObserver(settle)
    const observeCards = () => {
      resizeObserver.observe(row)
      listCards().forEach((card) => resizeObserver.observe(card))
    }
    // Cards mounting or unmounting (a widget loading in, going away).
    const mutationObserver = new MutationObserver(() => {
      observeCards()
      settle()
    })

    observeCards()
    mutationObserver.observe(row, { childList: true, subtree: true })

    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      listCards().forEach(cancelLayoutAnimations)
    }
  }, [rowRef])
}
