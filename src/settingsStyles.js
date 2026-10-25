// Réglages look, shared by the settings pages and whatever borrows it (the
// « Équipe » card of À propos): white cards, hairline-split rows, muted
// round fills behind icons.
export const CARD_CLASSES = 'overflow-hidden corners-[20px] border border-white bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:border-[var(--color-border)] dark:bg-[var(--color-bg-surface)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)]'
export const ROW_CLASSES = 'flex min-h-[54px] items-center justify-between gap-3 px-4 py-[11px]'
export const MUTED_FILL_CLASSES = 'bg-[#f3f1eb] dark:bg-[var(--color-bg-muted)]'
// A whole row that's a button or a link, with its hover.
export const PRESSABLE_ROW_CLASSES = `${ROW_CLASSES} w-full border-0 bg-transparent text-left cursor-pointer transition-colors duration-[120ms] hover:bg-[#f8f7f3] dark:hover:bg-[var(--color-bg-subtle)]`
