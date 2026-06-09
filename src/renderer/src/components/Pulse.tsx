// The three-dot loading affordance — the only sanctioned loading visual
// (DESIGN.md, Motion). Chrome lives in .vnr-pulse; this just owns the
// markup so call sites don't copy-paste the span triple.

interface Props {
  /** Accessible description of what's loading, e.g. "Translating". */
  label: string
  className?: string
  style?: React.CSSProperties
}

export function Pulse({ label, className, style }: Props): React.JSX.Element {
  return (
    <div
      className={className ? `vnr-pulse ${className}` : 'vnr-pulse'}
      style={style}
      aria-label={label}
    >
      <span />
      <span />
      <span />
    </div>
  )
}
