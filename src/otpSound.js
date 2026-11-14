// The sounds of the login's code step: a few quiet notes made on the spot
// (Web Audio, no file). Each digit plays the next note of a rising scale,
// the whole code a small flourish; a code sent, a refused one and a login
// that went through have their own. Quiet on purpose (VOLUME): a login
// page is opened in lecture halls too. A phone on silent plays nothing.

// How loud the loudest note is, out of 1.
const VOLUME = 0.05

// One note a box: C major pentatonic, C5 to C6.
const DIGIT_NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5]

// What to play when the code goes from `previous` to `next`: a note for
// each digit added (a pasted code runs up the scale), 'complete' when it is
// whole, 'delete' when digits were taken back. As { cue, index } cues.
export function otpCuesFor(previous, next, length = DIGIT_NOTES.length) {
  if (next.length < previous.length) return [{ cue: 'delete' }]

  const cues = []
  for (let index = previous.length; index < Math.min(next.length, length); index += 1) {
    cues.push({ cue: 'digit', index })
  }
  if (cues.length > 0 && next.length >= length) cues.push({ cue: 'complete' })
  return cues
}

let context = null

// The page's audio context, started (or woken) here: call it from a user's
// gesture (a key, a click), browsers keep it silent otherwise.
function getContext() {
  const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext
  if (!AudioContext) return null
  try {
    context ??= new AudioContext()
    if (context.state === 'suspended') context.resume().catch(() => {})
  } catch {
    return null
  }
  return context
}

// One soft note: a sine with a fast attack and a decay, `level` out of 1.
function note(audio, { frequency, slideTo = null, at = 0, duration = 0.11, level = 1, type = 'sine' }) {
  const start = audio.currentTime + at
  const oscillator = audio.createOscillator()
  const gain = audio.createGain()

  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, start)
  if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + duration)

  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(VOLUME * level, start + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

  oscillator.connect(gain).connect(audio.destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.02)
}

const CUES = {
  // The box's note, with a faint octave over it for a glassy edge.
  digit(audio, at, index) {
    const frequency = DIGIT_NOTES[Math.max(0, Math.min(index, DIGIT_NOTES.length - 1))]
    note(audio, { frequency, at, duration: 0.12 })
    note(audio, { frequency: frequency * 2, at, duration: 0.07, level: 0.22 })
  },
  // The code is whole: two small notes above the last one.
  complete(audio, at) {
    note(audio, { frequency: 1318.51, at: at + 0.07, duration: 0.1, level: 0.55 })
    note(audio, { frequency: 1567.98, at: at + 0.14, duration: 0.16, level: 0.5 })
  },
  // A digit taken back: a short, lower tick.
  delete(audio, at) {
    note(audio, { frequency: 392, slideTo: 330, at, duration: 0.06, level: 0.5 })
  },
  // A code on its way (SMS, mail): two notes up.
  sent(audio, at) {
    note(audio, { frequency: 783.99, at, duration: 0.1, level: 0.7 })
    note(audio, { frequency: 1174.66, at: at + 0.09, duration: 0.18, level: 0.7 })
  },
  // A refused code: two low notes down, rounder.
  refused(audio, at) {
    note(audio, { frequency: 233.08, at, duration: 0.13, type: 'triangle' })
    note(audio, { frequency: 185, at: at + 0.12, duration: 0.2, type: 'triangle' })
  },
  // Signed in: the chord of the scale, bottom to top.
  success(audio, at) {
    ;[523.25, 659.25, 783.99, 1046.5].forEach((frequency, step) => {
      note(audio, { frequency, at: at + step * 0.07, duration: 0.2, level: 0.7 })
    })
  },
}

// Wakes the sound from a gesture whose own result comes later (the form's
// submit: the code refused, the login gone through).
export function primeOtpSound() {
  getContext()
}

// Plays a cue ('digit' with its box's `index`, 'complete', 'delete', 'sent',
// 'refused', 'success'), `at` seconds from now. Never throws: no sound is
// not an error.
export function playOtpSound(cue, { index = 0, at = 0 } = {}) {
  const audio = getContext()
  if (!audio || !CUES[cue]) return
  try {
    CUES[cue](audio, at, index)
  } catch {
    // An audio graph that can't be built: silence.
  }
}

// The cues of a code going from `previous` to `next` (otpCuesFor), a pasted
// code's notes a moment apart.
export function playOtpChange(previous, next) {
  otpCuesFor(previous, next).forEach(({ cue, index }, step) => {
    playOtpSound(cue, { index, at: cue === 'complete' ? Math.max(0, step - 1) * 0.045 : step * 0.045 })
  })
}
