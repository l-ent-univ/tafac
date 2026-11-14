// Clips with a transparent background come in two encodings, as no browser
// plays both with transparency: HEVC with alpha (.mov) for WebKit, VP9 with
// alpha (.webm) for the others. Every iOS browser is WebKit; on a Mac only
// Safari is.
export function isWebKit() {
  const agent = navigator.userAgent
  return /AppleWebKit/.test(agent) && !/Chrome|Chromium|Edg|OPR|Android/.test(agent)
}
