import { desktopCapturer } from 'electron'
import type { SharedWindowSource } from '@shared/ipc'

export async function listWindows(): Promise<SharedWindowSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 320, height: 180 }
  })
  return sources
    .filter((s) => s.name && s.name !== 'Electron' && !s.name.startsWith('yomiko'))
    .map((s) => ({
      id: s.id,
      name: s.name,
      thumbnailDataUrl: s.thumbnail.toDataURL()
    }))
}
