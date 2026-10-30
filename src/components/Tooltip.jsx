// What an icon button stands for, in a bubble beside it on hover or keyboard
// focus: the compact sidebar's (to its right), the mail toolbar's (below).
// The control names itself (aria-label), so the bubble is for the eyes only.
// The button carries `group relative`. `side`: right, or bottom (centred,
// or held to the button's start or end edge near the side of a panel).
const SIDE_CLASSES = {
  right: 'left-full top-1/2 ml-3 -translate-x-1 -translate-y-1/2 group-hover:translate-x-0 group-focus-visible:translate-x-0',
  bottom: 'left-1/2 top-full mt-2 -translate-x-1/2 -translate-y-1 group-hover:translate-y-0 group-focus-visible:translate-y-0',
  'bottom-start': 'left-0 top-full mt-2 -translate-y-1 group-hover:translate-y-0 group-focus-visible:translate-y-0',
  'bottom-end': 'right-0 top-full mt-2 -translate-y-1 group-hover:translate-y-0 group-focus-visible:translate-y-0',
}

function Tooltip({ title, detail = null, side = 'right', className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute z-40 flex flex-col gap-[2px] w-max max-w-[240px] scale-95 whitespace-normal text-left corners-[12px] border border-black/10 bg-black px-[10px] py-[6px] text-[12px] font-medium leading-tight text-white opacity-0 invisible shadow-[0_12px_32px_rgba(0,0,0,0.18)] transition-[opacity,transform] duration-180 ease-out group-hover:visible group-hover:scale-100 group-hover:opacity-100 group-focus-visible:visible group-focus-visible:scale-100 group-focus-visible:opacity-100 dark:border-white/15 dark:bg-white dark:text-black ${SIDE_CLASSES[side]} ${className}`}
    >
      <span className="block font-semibold">{title}</span>
      {detail ? <span className="block text-[11px] text-white/70 dark:text-black/60">{detail}</span> : null}
    </span>
  )
}

export default Tooltip
