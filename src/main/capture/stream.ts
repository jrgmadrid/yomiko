import { session, desktopCapturer } from 'electron'

let pendingSourceId: string | null = null
let configured = false

// Registers a one-time `setDisplayMediaRequestHandler` so when the renderer
// calls `getDisplayMedia()`, we feed it the desktopCapturer source the user
// picked. We bypass the OS picker because Ship 2 puts the user in our own
// drag-rectangle UX inside the captured frame.
export function configureDisplayMediaHandler(): void {
  if (configured) return
  configured = true
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      if (!pendingSourceId) {
        callback({})
        return
      }
      const sources = await desktopCapturer.getSources({ types: ['window'] })
      const source = sources.find((s) => s.id === pendingSourceId)
      if (!source) {
        callback({})
        return
      }
      callback({ video: source })
    },
    { useSystemPicker: false }
  )
}

export function setPendingSource(sourceId: string): void {
  pendingSourceId = sourceId
}

export function clearPendingSource(): void {
  pendingSourceId = null
}

export function getPendingSource(): string | null {
  return pendingSourceId
}
