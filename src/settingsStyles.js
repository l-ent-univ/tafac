// Réglages look, shared by the settings pages and whatever borrows it (the
// « Équipe » card of À propos). What's pressed or sits on top is raised,
// what shows a value or a preview is carved in:
// - CARD_CLASSES: the groups' cards, quiet solid glass; their rows split
//   by engraved hairlines, inset (.settings-rows, SettingsGroup).
// - MUTED_FILL_CLASSES: raised solid glass (.glass-solid): the icons'
//   discs, the buttons and dropdowns in a row, small tags.
// - WELL_CLASSES: engraved (.engraved): a preview (the signature), a track,
//   an empty slot.
export const CARD_CLASSES = 'glass-solid glass--quiet overflow-hidden modal-inner-corners'
export const ROW_CLASSES = 'flex min-h-[54px] items-center justify-between gap-3 px-4 py-[11px]'
export const MUTED_FILL_CLASSES = 'glass-solid'
export const WELL_CLASSES = 'engraved'
// A whole row that's a button or a link, with its hover.
export const PRESSABLE_ROW_CLASSES = `${ROW_CLASSES} w-full border-0 bg-transparent text-left cursor-pointer transition-colors duration-[120ms] hover:bg-[#f8f7f3] dark:hover:bg-[var(--color-bg-subtle)]`
