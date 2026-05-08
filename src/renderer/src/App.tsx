import { useEffect } from 'react'
import { attachClickThrough } from './lib/clickthrough'

function App(): React.JSX.Element {
  useEffect(() => attachClickThrough(), [])

  return (
    <div className="flex h-full w-full items-end justify-center pb-6">
      <div className="hit rounded-lg bg-black/70 px-6 py-3 backdrop-blur">
        <span className="text-base tracking-wide text-white/90">
          yomiko · ship 1 · placeholder bar
        </span>
      </div>
    </div>
  )
}

export default App
