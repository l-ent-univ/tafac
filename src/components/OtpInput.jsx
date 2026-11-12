import { useState } from 'react'

export const OTP_LENGTH = 6

// A one-time code (two-factor login). One real field, so the keyboard, a
// paste and the code a phone or a password manager offers all work as in
// any field; it lies invisible over one box per digit, which is what shows.
// The caret stays at the end: a digit fills the next box, Backspace empties
// the last one. `busy` (the code is being checked) keeps the field and its
// focus, so the keyboard stays up, and ignores what is typed.
function OtpInput({ id = 'login-otp', label, hint, value, onChange, inputRef, busy = false, invalid = false }) {
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
      <label htmlFor={id} className="text-center text-[13px] font-semibold leading-none text-text-70 font-body">{label}</label>
      <div className={`relative ${refused ? 'otp-shake' : ''}`}>
        <div className="flex gap-2" aria-hidden="true">
          {Array.from({ length: OTP_LENGTH }, (_, index) => {
            const digit = digits[index] ?? ''
            const active = focused && !busy && index === activeIndex
            return (
              <span
                key={index}
                className={[
                  'flex h-14 min-w-0 flex-1 items-center justify-center corners-[16px] border bg-widget-bg text-[22px] font-semibold leading-none text-text font-body tabular-nums transition-[border-color,opacity] duration-150',
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
        <input
          ref={inputRef}
          id={id}
          name="otp"
          // 16px: under it, iOS zooms the page on focus.
          className="absolute inset-0 h-full w-full cursor-text border-0 bg-transparent p-0 text-base opacity-0"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={digits}
          aria-describedby={hint ? `${id}-hint` : undefined}
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
        />
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="m-0 text-center text-[13px] font-medium leading-[1.35] text-text-muted font-body">{hint}</p>
      ) : null}
    </div>
  )
}

export default OtpInput
