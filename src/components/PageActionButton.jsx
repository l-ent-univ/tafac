import SmoothSurface from './SmoothSurface'

// A page state's action (PageEmptyState's `action`): « Réessayer », « Afficher
// ici » on « Moodle » (the desktop app).
function PageActionButton({ onClick, label }) {
  return (
    <button
      type="button"
      className="material inline-flex shrink-0 items-center px-3 py-2 rounded-full text-text cursor-pointer focus-visible:outline-2 focus-visible:outline-text"
      onClick={onClick}
    >
      <SmoothSurface />
      {/* On a span: index.css gives buttons the inherited font. */}
      <span className="text-[13px] font-semibold leading-none">{label}</span>
    </button>
  )
}

export default PageActionButton
