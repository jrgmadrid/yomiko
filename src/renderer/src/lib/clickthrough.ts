// Click-through-except-hit-zones for transparent overlay windows.
//
// The overlay window is created with setIgnoreMouseEvents(true, { forward: true }),
// which lets clicks fall through to whatever's below while still forwarding mouse
// events to the renderer. We watch those forwarded events, and whenever the
// cursor sits over an element with the `hit` class, we flip ignore=false so the
// element actually receives clicks. We poll on rAF instead of trusting :hover /
// mouseleave to fire reliably (Electron #35030 hover flicker on Windows).

let lastIgnore = true
let lastX = -1
let lastY = -1
let rafId = 0

function tick(): void {
  if (lastX >= 0 && lastY >= 0) {
    const el = document.elementFromPoint(lastX, lastY)
    const overHit = !!el && el.closest('.hit') !== null
    const ignore = !overHit
    if (ignore !== lastIgnore) {
      lastIgnore = ignore
      window.vnr.setIgnoreMouseEvents(ignore)
    }
  }
  rafId = requestAnimationFrame(tick)
}

function onMouseMove(e: MouseEvent): void {
  lastX = e.clientX
  lastY = e.clientY
}

export function attachClickThrough(): () => void {
  document.addEventListener('mousemove', onMouseMove)
  rafId = requestAnimationFrame(tick)
  return () => {
    document.removeEventListener('mousemove', onMouseMove)
    cancelAnimationFrame(rafId)
  }
}
