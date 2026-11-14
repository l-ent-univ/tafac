// OKLCH to sRGB, for the colour palettes (src/theme.js, tokens.css): the
// brand colour a hue can carry inside the sRGB gamut, and the hex of a
// token for the browser chrome and the tests. Pure: tested in Node.

function channelToSrgb(linear) {
  const value = Math.min(1, Math.max(0, linear))
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
}

// Linear sRGB channels of oklch(l c h); out of gamut when one leaves 0–1.
function toLinear(l, c, h) {
  const radians = (h * Math.PI) / 180
  const a = c * Math.cos(radians)
  const b = c * Math.sin(radians)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
}

export function inGamut(l, c, h) {
  return toLinear(l, c, h).every((channel) => channel >= -0.0005 && channel <= 1.0005)
}

// The most chroma `l` and `h` keep inside sRGB, by halving.
export function maxChroma(l, h) {
  let low = 0
  let high = 0.4
  for (let step = 0; step < 20; step += 1) {
    const middle = (low + high) / 2
    if (inGamut(l, middle, h)) low = middle
    else high = middle
  }
  return low
}

// "#rrggbb" of oklch(l c h). Out of gamut, the chroma is reduced until it
// fits (lightness and hue kept), as CSS Color 4 asks of the browser.
export function oklchToHex(l, c, h) {
  const chroma = Math.min(c, maxChroma(l, h))
  return `#${toLinear(l, chroma, h)
    .map((channel) => Math.round(channelToSrgb(channel) * 255).toString(16).padStart(2, '0'))
    .join('')}`
}
