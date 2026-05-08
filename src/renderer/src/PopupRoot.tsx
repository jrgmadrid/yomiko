import { useEffect, useState } from 'react'
import { Popup } from './components/Popup'
import type { SharedLookupResult } from '@shared/ipc'

// Lives in its own BrowserWindow (loaded via ?mode=popup). The window
// itself is positioned by main relative to the hovered token's screen
// coordinates; this component just paints the popup body to fill the
// window. Offset/clamping logic moved out of the Popup component since
// the OS now handles positioning.

interface PopupPayload {
  data: SharedLookupResult
}

export default function PopupRoot(): React.JSX.Element {
  const [payload, setPayload] = useState<PopupPayload | null>(null)

  useEffect(() => {
    const off = window.electron.ipcRenderer.on('popup:data', (_e, data: SharedLookupResult) => {
      setPayload({ data })
    })
    return () => off()
  }, [])

  if (!payload) {
    return <div style={{ width: '100%', height: '100%', background: 'transparent' }} />
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'transparent',
        fontFamily:
          '"Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif',
        color: 'rgba(255,255,255,0.92)'
      }}
    >
      <Popup data={payload.data} />
    </div>
  )
}
