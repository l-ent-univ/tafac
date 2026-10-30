// The composer's drop zone (MailComposer): three little sheets, a page of
// text, a photo and a PDF, fanning out of a pile as the files come over,
// then floating gently, each at its own pace (.mail-drop-sheet in
// overrides.css). Drawn, not icons: the sheets' paper takes the theme's
// widget colour, their accents stay.
function Sheet({ kind, className }) {
  return (
    <svg viewBox="0 0 48 60" className={`mail-drop-sheet ${className}`} aria-hidden="true">
      <path className="mail-drop-sheet-paper" d="M7 1.5H32L46.5 16V53Q46.5 58.5 41 58.5H7Q1.5 58.5 1.5 53V7Q1.5 1.5 7 1.5Z" />
      <path className="mail-drop-sheet-fold" d="M32 1.5V11Q32 16 37 16H46.5Z" />
      {kind === 'photo' ? (
        <>
          <rect x="8" y="21" width="32" height="24" rx="4" fill="#dff1e6" />
          <circle cx="31.5" cy="28" r="3" fill="#f5b83d" />
          <path d="M8 40.5 17 32l7 6.5 4.5-3.5L40 43v-2.5" fill="none" stroke="#3f9b62" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="8" y="49" width="18" height="3" rx="1.5" className="mail-drop-sheet-line" />
        </>
      ) : kind === 'pdf' ? (
        <>
          <rect x="8" y="10" width="15" height="3" rx="1.5" className="mail-drop-sheet-line" />
          <rect x="8" y="22" width="32" height="3" rx="1.5" className="mail-drop-sheet-line" />
          <rect x="8" y="29" width="27" height="3" rx="1.5" className="mail-drop-sheet-line" />
          <rect x="8" y="36" width="30" height="3" rx="1.5" className="mail-drop-sheet-line" />
          <rect x="8" y="46" width="17" height="7" rx="3.5" fill="#e5484d" />
          <rect x="11" y="48.5" width="11" height="2" rx="1" fill="#ffffff" opacity="0.9" />
        </>
      ) : (
        <>
          <rect x="8" y="10" width="18" height="3.5" rx="1.75" fill="#6e8ff0" />
          <rect x="8" y="21" width="32" height="3" rx="1.5" className="mail-drop-sheet-line" />
          <rect x="8" y="28" width="28" height="3" rx="1.5" className="mail-drop-sheet-line" />
          <rect x="8" y="35" width="32" height="3" rx="1.5" className="mail-drop-sheet-line" />
          <rect x="8" y="42" width="21" height="3" rx="1.5" className="mail-drop-sheet-line" />
          <rect x="8" y="49" width="25" height="3" rx="1.5" className="mail-drop-sheet-line" />
        </>
      )}
    </svg>
  )
}

function MailDropSheets() {
  return (
    <span className="mail-drop-sheets" aria-hidden="true">
      <Sheet kind="photo" className="mail-drop-sheet--left" />
      <Sheet kind="pdf" className="mail-drop-sheet--right" />
      <Sheet kind="text" className="mail-drop-sheet--front" />
    </span>
  )
}

export default MailDropSheets
