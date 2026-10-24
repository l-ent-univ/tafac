import universityConfig from '@university'
import tafacMark from '../assets/tafac-mark.png'
import tafacWordmark from '../assets/tafac-wordmark.svg'

const appName = universityConfig.branding.appName

// Tafac logo from Figma (Group 853): the chocolate mark is a PNG cropped to
// its visible edges, the wordmark stays vector (white in dark mode). In Figma
// units the mark is 86.25 × 130.65, then a 14 gap, then the 311.69 × 101.52
// wordmark sitting 11 from the top; positions are those in percent, so the
// logo is sized by its height alone (pass e.g. className="h-10").
// `wordmarkClassName`: on the wordmark alone (e.g. white on a photo).
function LogoBut1({ className = '', wordmarkClassName = '' }) {
  return (
    <span role="img" aria-label={appName} className={`relative block shrink-0 aspect-[411.94/130.65] ${className}`}>
      <img src={tafacMark} alt="" className="absolute left-0 top-0 h-full w-[20.94%]" />
      <img src={tafacWordmark} alt="" className={`absolute left-[24.34%] top-[8.42%] h-[77.7%] w-[75.66%] dark:[filter:brightness(0)_invert(1)] ${wordmarkClassName}`} />
    </span>
  )
}

export default LogoBut1
