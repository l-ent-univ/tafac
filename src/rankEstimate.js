// Proof of concept (src/rankPoc.js): a semester rank estimated from what
// the relevé says of the promo's averages, its lowest, mean and highest,
// and its size. No one else's grade is known, so it's a model: the
// averages spread as a bell curve, lopsided as grades often are (its width
// above the mean set by the gap to the highest, below it by the gap to the
// lowest, each read as the typical extreme of that many students). Pure,
// see tests/rankEstimate.test.js.

// Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7).
export function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

// Inverse of normalCdf (Acklam's rational approximation), p in (0, 1).
export function normalQuantile(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const low = 0.02425
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - low) return -normalQuantile(1 - p)
  const q = p - 0.5
  const r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

// The share of the promo above `average`: { above } in [0, 1].
function shareAbove(average, { min, moy, max, total }) {
  // How far, in widths, the highest of `total` students typically sits
  // from the mean (Blom's plotting position).
  const extreme = normalQuantile((total - 0.375) / (total + 0.25))
  const up = Math.max((max - moy) / extreme, 1e-6)
  const down = Math.max((moy - min) / extreme, 1e-6)
  const upperShare = up / (up + down)
  if (average >= moy) return upperShare * 2 * (1 - normalCdf((average - moy) / up))
  return 1 - (1 - upperShare) * 2 * normalCdf((average - moy) / down)
}

// The estimated rank of `average` among `total` students whose averages
// run from `min` to `max` around `moy`: { position, total }, 1 the best.
// Null without what it needs (a promo of fewer than 2, stats out of order).
export function estimateRank({ average, min, moy, max, total }) {
  const values = [average, min, moy, max]
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return null
  if (!(Number.isInteger(total) && total >= 2) || !(min <= moy && moy <= max) || max <= min) return null
  let position
  if (average >= max) position = 1
  else if (average <= min) position = total
  else position = 1 + Math.round(shareAbove(average, { min, moy, max, total }) * (total - 1))
  return { position: Math.min(total, Math.max(1, position)), total }
}
