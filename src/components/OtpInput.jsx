import { useState } from 'react'

export const OTP_LENGTH = 6

// Each box's own colour, for the ring and the sparks of a digit landing in
// it: the home icons' colours, in a row.
const BOX_COLORS = ['#3b82ff', '#8b5cf6', '#ff5c93', '#ff8a1f', '#ffb81a', '#2fc462']

// A one-time code (two-factor login). One real field, so the keyboard, a
// paste and the code a phone or a password manager offers all work as in
// any field; it lies invisible over one box per digit, which is what shows.
// The caret stays at the end: a digit fills the next box, Backspace empties
// the last one. `busy` (the code is being checked) keeps the field and its
// focus, so the keyboard stays up, and ignores what is typed. A digit
// landing pops its box (a ring, a few sparks); the whole code, a wave
// along the row (overrides.css, « Login: one-time code »). The field is
// only there while `active` (its step shown): folded away, the boxes stay
// for the step's animation, but the form holds the identifiers alone, which
// password managers read as a login, and none of them fills a code into it.
function OtpInput({ id = 'login-otp', label, value, onChange, inputRef, active: isActive = true, busy = false, invalid = false }) {
  const [focused, setFocused] = useState(false)
  const digits = String(value ?? '').slice(0, OTP_LENGTH)
  // The box the next digit goes to: the last one once the code is whole.
  const activeIndex = Math.min(digits.length, OTP_LENGTH - 1)
  const refused = invalid && !digits

  function moveCaretToEnd(event) {
    const { length } = event.target.value
    event.target.setSelectionRange(length, length)
  }

  return (
    <div className="flex flex-col gap-[7px]">
      {/* The label follows the code (asked, sent, refused): said again
          when it changes. */}
      <label htmlFor={id} className={`text-center text-[13px] font-semibold leading-[1.3] font-body transition-colors duration-150 ${invalid ? 'text-error' : 'text-text-70'}`} aria-live="polite">{label}</label>
      <div className={`relative ${refused ? 'otp-shake' : ''}`}>
        <div className={`flex gap-2 ${busy ? 'otp-wave' : ''}`} aria-hidden="true">
          {Array.from({ length: OTP_LENGTH }, (_, index) => {
            const digit = digits[index] ?? ''
            const active = focused && isActive && !busy && index === activeIndex
            return (
              <span
                key={index}
                style={{ '--i': index, '--otp-pop': BOX_COLORS[index % BOX_COLORS.length] }}
                className={[
                  'otp-box relative flex aspect-square min-w-0 flex-1 items-center justify-center corners-[16px] border bg-widget-bg text-[24px] font-semibold leading-none text-text font-body tabular-nums transition-[border-color,opacity] duration-150',
                  digit ? 'otp-box--filled' : '',
                  // Read as two groups of three, like the apps show it.
                  index === OTP_LENGTH / 2 ? 'ml-1.5' : '',
                  active ? 'border-text-60 outline-2 outline-offset-2 outline-text' : refused ? 'border-error/60' : 'border-border-input',
                  busy ? 'opacity-60' : '',
                ].filter(Boolean).join(' ')}
              >
                {digit ? <span className="otp-digit">{digit}</span> : active ? <span className="otp-caret" /> : null}
              </span>
            )
          })}
        </div>
        {isActive ? <input
          ref={inputRef}
          id={id}
          name="otp"
          // 16px: under it, iOS zooms the page on focus.
          className="otp-field absolute inset-0 h-full w-full cursor-text border-0 bg-transparent p-0 text-base"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={digits}
          aria-invalid={invalid || undefined}
          aria-busy={busy || undefined}
          onChange={(event) => {
            if (busy) return
            onChange(event.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))
          }}
          onFocus={(event) => {
            setFocused(true)
            moveCaretToEnd(event)
          }}
          onBlur={() => setFocused(false)}
          onClick={moveCaretToEnd}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'Home') {
              event.preventDefault()
            }
          }}
        /> : null}
      </div>
    </div>
  )
}

export default OtpInput
