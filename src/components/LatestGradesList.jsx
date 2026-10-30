import { Icon } from '@iconify/react'
import { buildUeWash, formatGradeDay as formatDay } from '../gradesSubjects'
import { gradeCopyText } from '../contextMenuItems'
import { copyToClipboard, useContextMenu } from '../useContextMenu'
import { useGradeDetail } from '../gradeDetailContext'
import { NewBadge, TypeBadge } from './SubjectsList'

// Always one row, scrolling sideways when the cards don't fit (snap, no
// scrollbar), running to the edges of the page's padding. A scrolling row
// clips what overflows it, so the padding (cancelled by negative margins)
// leaves room for the cards' shadow: 0 10px 28px -14px reaches 24px below.
const LIST_CLASSES = 'm-0 list-none flex gap-3 overflow-x-auto snap-x snap-mandatory -mx-6 px-6 scroll-px-6 pt-2 pb-7 -mt-2 -mb-7 favorites-scroll-hide max-md:gap-2 max-md:-mx-3 max-md:px-3 max-md:scroll-px-3'
const ITEM_CLASSES = 'flex w-[236px] shrink-0 snap-start min-w-0 max-md:w-[224px]'
// The card is a button: it opens the grade where it counts (onOpen); also
// the composer's grades drawer (MailGradePicker).
export const CARD_CLASSES = 'latest-grade-card isolate relative widget-card widget-card-visible shadow-md w-full p-3 border border-white card-corners overflow-hidden bg-widget-bg text-left text-text flex flex-col gap-[6px] min-w-0 cursor-pointer'


// One grade as a "Note" card's content, also the dashboard's "Dernière
// note": the subject (its icon, name, the date), the evaluation, the grade,
// under a wash of the colours of the UEs it counts for. A "Nouveau" badge
// when `isNew`. With a `heading` (the dashboard card's label), the heading
// leads (with the badge, and the date in the corner; on a phone's
// half-width card the badge is a dot by the grade), the grade
// stands big without its pill like the dashboard's other numbers, and the
// evaluation holds one line, to fit the dashboard's row height.
// `typeLabel`: "Rattrapage" or "Session 2", a tag beside the grade, as on
// the subjects' evaluation rows. `scale`: what follows the value (none for
// a grade given as a word, « Absent »).
export function LatestGradeCardBody({ moduleTitle, moduleCode, day, title, value, icon, wash, typeLabel = null, isNew = false, heading = null, scale = '/20' }) {
  const dayLabel = day ? <span className={`ml-auto shrink-0 font-body text-[13px] font-medium leading-[1.4] text-text-muted ${heading ? 'max-md:text-[12px]' : ''}`}>{day}</span> : null
  return (
    <>
      {wash ? <span className="latest-grade-wash" style={{ background: wash }} aria-hidden="true" /> : null}
      {heading ? (
        <div className="flex items-center gap-[6px] min-w-0">
          <span className="m-0 min-w-0 truncate text-base font-medium leading-[1.06] text-text-muted max-md:text-[15px]">{heading}</span>
          {isNew ? <span className="max-md:hidden"><NewBadge /></span> : null}
          {dayLabel}
        </div>
      ) : null}
      <div className="flex items-center gap-[6px] min-w-0">
        {icon ? <Icon icon={icon} className="size-4 shrink-0 text-text-secondary" aria-hidden="true" /> : null}
        <span className="min-w-0 truncate font-body text-[13px] font-semibold leading-[1.4] text-text-secondary" title={moduleCode ? `${moduleCode} · ${moduleTitle}` : moduleTitle}>
          {moduleTitle}
        </span>
        {heading ? null : (
          <>
            {isNew ? <NewBadge /> : null}
            {dayLabel}
          </>
        )}
      </div>
      <span className={`m-0 block font-body text-[15px] font-semibold leading-[1.25] text-text ${heading ? 'truncate' : 'h-[38px] line-clamp-2'}`} title={title}>{title}</span>
      {heading ? (
        <span className="mt-auto flex items-end gap-[3px] leading-[1.06]">
          <span className="font-display text-[32px] font-bold leading-none whitespace-nowrap max-md:text-[28px]">{value}</span>
          {scale ? <span className="pb-[2px] text-[17px] font-medium leading-[1.06] text-text-muted whitespace-nowrap max-md:text-[15px]">{scale}</span> : null}
          {typeLabel ? <span className="mb-[3px] ml-[6px] self-end max-md:hidden"><TypeBadge label={typeLabel} /></span> : null}
          {/* On a phone's half-width card the badge would crowd the heading:
              a dot by the grade instead. */}
          {isNew ? <span className="mb-[6px] ml-[5px] size-2 shrink-0 self-end rounded-full bg-brand md:hidden" aria-hidden="true" /> : null}
        </span>
      ) : (
        // Both texts trimmed to cap height and baseline (as in Figma), so
        // the pill's padding is even above and below the number. The page's
        // text scale: the subject rows' sizes and their grade pill's.
        <span className="flex items-center gap-[6px] self-start">
          <span className="inline-flex items-end gap-[2px] rounded-full border border-border bg-bg-subtle px-[9px] py-[8px] text-text">
            <span className="font-display text-[17px] font-bold leading-none [text-box:trim-both_cap_alphabetic]">{value}</span>
            {scale ? <span className="font-body text-[13px] font-medium leading-none text-text-muted [text-box:trim-both_cap_alphabetic]">{scale}</span> : null}
          </span>
          {typeLabel ? <TypeBadge label={typeLabel} /> : null}
        </span>
      )}
    </>
  )
}

// The semester's latest grades (buildGradesReport's `latest`, newest first,
// at most 6), as Figma's "Note" cards in Tafac's style: the module and date,
// the evaluation, then the grade in a pill. A wash of the colours of the UEs
// the grade counts for (as on the UE ring) tints the top of the card; the
// subject's icon (src/subjectIcons.js) leads its name. A card opens the
// grade itself (onOpen): GradesPage takes it to its UE and subject.
function LatestGradesList({ grades, ueColors = {}, subjectIcon = () => null, onOpen = null }) {
  // A mail about a grade, under « Mes notes »'s sheet provider.
  const write = useGradeDetail()?.write ?? null
  // A card's right-click menu (a long press; `key`: its index): the grade
  // opened, a mail about it, and as text.
  const menuProps = useContextMenu((key) => {
    const grade = grades[Number(key)]
    if (!grade) return null
    return [
      onOpen ? { id: 'open', label: 'Voir la note', icon: 'carbon:view', onSelect: () => onOpen(grade) } : null,
      write ? { id: 'write', label: 'Écrire au sujet de cette note', icon: 'carbon:email', onSelect: () => void write({ moduleCode: grade.moduleCode, evaluationId: grade.id }) } : null,
      {
        id: 'copy',
        label: 'Copier',
        icon: 'carbon:copy',
        onSelect: () => void copyToClipboard(gradeCopyText({ title: grade.description || grade.moduleTitle, value: grade.grade.value, subject: grade.moduleTitle })),
      },
    ]
  })
  return (
    <ul className={LIST_CLASSES}>
      {grades.map((grade, index) => {
        const day = formatDay(grade.date)
        const value = String(parseFloat(grade.grade.value.toFixed(2)))
        const title = grade.description || grade.moduleTitle
        const wash = buildUeWash(grade.weights, ueColors)
        const icon = subjectIcon(grade.moduleTitle)
        return (
          <li key={`${grade.moduleCode}-${grade.id}`} className={ITEM_CLASSES}>
            <button
              type="button"
              className={CARD_CLASSES}
              onClick={onOpen ? () => onOpen(grade) : undefined}
              disabled={!onOpen}
              {...menuProps(index)}
              aria-label={`${title}${grade.typeLabel ? `, ${grade.typeLabel.toLowerCase()}` : ''} : ${value} sur 20${day ? `, le ${day}` : ''} (${grade.moduleTitle}). Voir la note`}
            >
              <LatestGradeCardBody
                moduleTitle={grade.moduleTitle}
                moduleCode={grade.moduleCode}
                day={day}
                title={title}
                value={value}
                icon={icon}
                wash={wash}
                typeLabel={grade.typeLabel}
              />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export default LatestGradesList
