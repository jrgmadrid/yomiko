import { useEffect, useState } from 'react'
import { attachClickThrough } from './lib/clickthrough'
import type { SourceStatus } from '@shared/ipc'

function App(): React.JSX.Element {
  const [status, setStatus] = useState<SourceStatus>('disconnected')
  const [lastLine, setLastLine] = useState<string>('')

  useEffect(() => attachClickThrough(), [])

  useEffect(
    () =>
      window.vnr.onLine((line) => {
        console.log('[text:line]', line)
        setLastLine(line)
      }),
    []
  )

  useEffect(
    () =>
      window.vnr.onStatus((s) => {
        console.log('[text:status]', s)
        setStatus(s)
      }),
    []
  )

  return (
    <div className="flex h-full w-full items-end justify-center pb-6">
      <div className="hit max-w-[90%] rounded-lg bg-black/70 px-6 py-3 backdrop-blur">
        <div className="text-xs uppercase tracking-widest text-white/50">{status}</div>
        <div className="mt-1 text-base text-white/90">
          {lastLine || 'yomiko · ship 1 · waiting for text'}
        </div>
      </div>
    </div>
  )
}

export default App
