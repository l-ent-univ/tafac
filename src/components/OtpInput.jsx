import { useRef } from 'react'

const OTP_LENGTH = 6

export function OtpInput({ id = 'login-otp', value, onChange, autoFocus,fieldClass}) {
    const refs = useRef([])

    const focusAt = (i) => {
        refs.current[Math.min(Math.max(i, 0), OTP_LENGTH - 1)]?.focus()
    }

    const handleChange = (index, e) => {
        let entered = e.target.value.replace(/\D/g, '')
        if (!entered) return
        if (value[index] && entered.length === 2) {
            entered = entered[1]
        }

        const next = (value.slice(0, index) + entered + value.slice(index + entered.length)).slice(0, OTP_LENGTH)
        onChange(next)
        focusAt(index + entered.length)
    }

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace') {
            e.preventDefault()
            if (value[index]) {
                onChange(value.slice(0, index) + value.slice(index + 1))
            } else if (index > 0) {
                onChange(value.slice(0, index - 1) + value.slice(index))
                focusAt(index - 1)
            }
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault()
            focusAt(index - 1)
        } else if (e.key === 'ArrowRight') {
            e.preventDefault()
            focusAt(index + 1)
        }
    }

    return (
        <div className="flex flex-col gap-[7px]">
            <label
                htmlFor={`${id}-0`}
                className="pl-[18px] text-left text-[13px] font-semibold leading-none text-text-70 font-body">
                JETON 2FA / Mot de passe à usage unique
            </label>

            <div className="flex flex-row gap-[5px]" role="group" aria-label="Code à 6 chiffres">
                {Array.from({ length: OTP_LENGTH }, (_, i) => (
                    <input
                        key={i}
                        id={`${id}-${i}`}
                        ref={(el) => { refs.current[i] = el }}
                        name={i === 0 ? 'otp' : undefined}
                        className={fieldClass + " text-center"}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="one-time-code"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        autoFocus={autoFocus && i === 0}
                        value={value[i] ?? ''}
                        aria-label={`Chiffre ${i + 1} sur ${OTP_LENGTH}`}
                        onChange={(e) => handleChange(i, e)}
                        onKeyDown={(e) => handleKeyDown(i, e)}
                        onFocus={(e) => e.target.select()}
                    />
                ))}
            </div>
        </div>
    )
}