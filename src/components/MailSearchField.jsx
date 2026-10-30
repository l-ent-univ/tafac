import { Icon } from '@iconify/react'

// A search field of the Messagerie, in the app's material (the other
// pages' buttons and fields): the mail list's (at the reader toolbar's
// height: the two line up from 4xl), the composer's grades drawer. Escape
// empties it (the event marked handled: a drawer around it stays open), ×
// too. `inputRef`: the input, for a drawer to focus it.
function MailSearchField({ value, onChange, placeholder = 'Rechercher', label = placeholder, inputRef = null, className = '' }) {
  return (
    <div className={`material mail-search-field flex h-11 min-w-0 items-center gap-2 rounded-full pl-4 pr-[5px] text-[15px] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-text/20 ${className}`}>
      <Icon icon="carbon:search" className="size-[17px] shrink-0 text-text-muted" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault()
            onChange('')
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        className="mail-search-input h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-text placeholder:text-text-muted [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          className="mobile-tab-bar-item inline-flex size-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-text-muted cursor-pointer"
          aria-label="Effacer la recherche"
          onClick={() => {
            onChange('')
            inputRef?.current?.focus()
          }}
        >
          <Icon icon="carbon:close" className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

export default MailSearchField
