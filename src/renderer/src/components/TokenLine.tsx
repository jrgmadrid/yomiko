import type { SharedWordGroup } from '@shared/ipc'

interface Props {
  groups: SharedWordGroup[]
  onHover: (group: SharedWordGroup, target: HTMLElement) => void
  onLeave: () => void
}

const NON_LOOKUPABLE_POS = new Set(['記号', 'BOS/EOS'])

export function TokenLine({ groups, onHover, onLeave }: Props): React.JSX.Element {
  return (
    <div className="text-[22px] leading-relaxed text-white/95">
      {groups.map((g, i) => {
        if (NON_LOOKUPABLE_POS.has(g.headPos)) {
          return (
            <span key={i} className="text-white/50">
              {g.surface}
            </span>
          )
        }
        return (
          <span
            key={i}
            className="hit rounded transition-colors hover:bg-white/15"
            onMouseEnter={(e) => onHover(g, e.currentTarget)}
            onMouseLeave={onLeave}
          >
            {g.surface}
          </span>
        )
      })}
    </div>
  )
}
