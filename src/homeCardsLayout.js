// « Accueil »'s cards in their order on the page (HomeDraftPage) and in its
// miniature (Réglages › Accueil, HomeLayoutSetting).
export const HOME_CARD_ORDER = ['nextClass', 'average', 'mail', 'latestGrade', 'deadlines']

// Where each card goes on two columns, for the cards drawn (whatever their
// order in `ids`): { id: 'tall' | 'half' | 'full' }. « Prochains cours »
// with two cards or more runs down the left ('tall', two rows) beside the
// next two, stacked on the right; the cards after it go two by two
// ('half'), a card left alone across the row ('full'), so no row keeps an
// empty column. « Prochains cours » with « Dernières notes » alone: each
// across its row, the grades' single row would run the classes' height
// with a blank under it.
export function layoutHomeCards(ids) {
  const cards = HOME_CARD_ORDER.filter((id) => ids.includes(id))
  const placement = {}
  let rest = cards
  if (cards[0] === 'nextClass' && cards.length >= 3) {
    placement.nextClass = 'tall'
    placement[cards[1]] = 'half'
    placement[cards[2]] = 'half'
    rest = cards.slice(3)
  } else if (cards.length === 2 && cards[0] === 'nextClass' && cards[1] === 'latestGrade') {
    placement.nextClass = 'full'
    placement.latestGrade = 'full'
    rest = []
  }
  for (let index = 0; index < rest.length; index += 2) {
    const pair = rest[index + 1] !== undefined
    placement[rest[index]] = pair ? 'half' : 'full'
    if (pair) placement[rest[index + 1]] = 'half'
  }
  return placement
}
