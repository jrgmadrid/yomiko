import { Channels } from '@shared/ipc'
import { MacWindowInfo, type WindowState } from './window-info/macos'
import { sendToOverlay } from './window'

// Tracks the captured source window: its CGWindowID (parsed from the
// desktopCapturer source id when the user picks a window), the persistent
// Swift sidecar that resolves its live screen position, and a focus poll.
//
// Focus poll: the overlay is click-through and always-on-top, so the cursor
// can wander over hover zones while the user is actually focused on another
// app (Slack, browser, etc.). We poll the sidecar every 500ms to check
// whether the captured window is still the frontmost normal-level window,
// and emit `sourceFocusChanged` on transitions so the renderer can gate the
// dwell timer. The renderer pulls the current value via `sourceFocusGet` on
// mount, so a remount can't strand it on a stale default.

let activeSourceWindowId: number | null = null
let windowInfoBackend: MacWindowInfo | null = null
let focusPoll: NodeJS.Timeout | null = null
let lastFocusState: boolean | null = null

function getWindowInfo(): MacWindowInfo | null {
  if (process.platform !== 'darwin') return null
  if (!windowInfoBackend) windowInfoBackend = new MacWindowInfo()
  return windowInfoBackend
}

export function getActiveSourceWindowId(): number | null {
  return activeSourceWindowId
}

/** Live bounds + frontmost state of the active source window, or null when
 *  there is no active window / it's off-screen. Throws on sidecar errors. */
export async function lookupActiveWindowState(): Promise<WindowState | null> {
  if (activeSourceWindowId === null) return null
  const wi = getWindowInfo()
  if (!wi) return null
  return wi.lookup(activeSourceWindowId)
}

/** Current focus answer for the renderer: unknown counts as focused so
 *  untracked sources (screen capture, no poll) never suppress translation. */
export function getSourceFocused(): boolean {
  return lastFocusState ?? true
}

/** Switch tracking to a new source window (null = source with no window id,
 *  e.g. screen capture, or no source at all). Resets the focus latch; the
 *  first poll always emits, so the renderer converges on every switch. */
export function setActiveSourceWindow(id: number | null): void {
  activeSourceWindowId = id
  stopFocusPoll()
  if (id !== null) {
    startFocusPoll()
  } else {
    // No poll will ever fire for this source — tell the renderer explicitly
    // so a `false` latched from the previous source doesn't suppress it.
    sendToOverlay(Channels.sourceFocusChanged, true)
  }
}

export async function closeWindowInfo(): Promise<void> {
  await windowInfoBackend?.close()
}

async function pollSourceFocus(): Promise<void> {
  if (activeSourceWindowId === null) return
  let state: WindowState | null
  try {
    state = await lookupActiveWindowState()
  } catch {
    // Transient sidecar error — keep the previous answer rather than
    // false-firing a transition.
    return
  }
  // Off-screen windows count as not focused.
  const focused = state?.frontmost ?? false
  if (focused === lastFocusState) return
  lastFocusState = focused
  console.log(`[focus] source window ${focused ? 'focused' : 'unfocused'}`)
  sendToOverlay(Channels.sourceFocusChanged, focused)
}

function startFocusPoll(): void {
  // Fire one probe immediately so the renderer doesn't sit at the default
  // assumption for the full 500ms window.
  void pollSourceFocus()
  focusPoll = setInterval(() => {
    void pollSourceFocus()
  }, 500)
}

function stopFocusPoll(): void {
  if (focusPoll) {
    clearInterval(focusPoll)
    focusPoll = null
  }
  lastFocusState = null
}
