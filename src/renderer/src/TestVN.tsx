import { useEffect, useState } from 'react'

// VN-flavored dialogue lines covering different conjugation shapes so the
// OCR + tokenizer + JMdict roundtrip gets exercised. Line 9 is a Ship 2.7
// stress case: two pairs of bias-prone kanji (信×2, 言×2) — four
// refinement candidates per OCR fire. If Vision misreads any combination
// of them, the repeated-kanji heuristic should resolve every position.
// Line 10 is the Ship 2.6 / Ship 2.8 stress case: Marishiten mantra
// containing 唵, which no constrained-vocab JP OCR (Apple Vision,
// manga-OCR, EasyOCR, PaddleOCR) can produce. Tests that ⌘⇧T force-
// translate routes through the VLM and that Qwen's byte-level tokens
// recover the char Vision can't see.
// Line 11 is rendered with writing-mode: vertical-rl (see VERTICAL_INDICES
// below) — exercises the orientation-aware crop padding in main and the
// overlay-anchored-beside-the-line positioning in HoverProtoLayer.
const LINES = [
  'こんにちは、私はテストです。',
  '今日はとても暑い日ですね。',
  '彼女は静かに本を読んでいた。',
  '夜の窓辺で、月が光っていた。',
  'お元気ですか？私は元気です。',
  '魔法少女たちは、世界を救うために戦った。',
  '何度言われても、信じられなかった。',
  '猫が窓辺で眠っている。',
  '信じる言葉、言える信頼。',
  '唵・摩利支曳・娑婆訶——',
  '夜の海は、星よりも深い色をしていた。'
]

// 0-based indices into LINES that render in vertical writing mode. Pads
// the textbox layout so vertical text has enough column height to display.
const VERTICAL_INDICES = new Set<number>([10])

export default function TestVN(): React.JSX.Element {
  const [idx, setIdx] = useState(0)
  const [auto, setAuto] = useState(false)

  useEffect(() => {
    document.title = 'Test VN'
  }, [])

  useEffect(() => {
    if (!auto) return
    const timer = setInterval(() => {
      setIdx((i) => (i + 1) % LINES.length)
    }, 4000)
    return () => clearInterval(timer)
  }, [auto])

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowRight' || e.key === ' ') {
      e.preventDefault()
      setIdx((i) => (i + 1) % LINES.length)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setIdx((i) => (i - 1 + LINES.length) % LINES.length)
    }
  }

  return (
    <div
      tabIndex={0}
      onKeyDown={onKey}
      autoFocus
      style={{
        height: '100vh',
        margin: 0,
        background:
          'linear-gradient(180deg, #1b2030 0%, #0d111a 100%)',
        color: '#f5f5f5',
        fontFamily:
          '"Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif',
        display: 'flex',
        flexDirection: 'column',
        padding: 24,
        boxSizing: 'border-box',
        outline: 'none'
      }}
    >
      {/* "Game scene" placeholder */}
      <div
        style={{
          flex: 1,
          background:
            'radial-gradient(circle at 30% 40%, #2a3043 0%, #141822 70%)',
          borderRadius: 12,
          marginBottom: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#3d4356',
          fontSize: 14,
          letterSpacing: 4
        }}
      >
        [game scene]
      </div>

      {/* VN-style textbox */}
      <div
        style={{
          background: 'rgba(0, 0, 0, 0.78)',
          padding: '24px 32px',
          borderRadius: 14,
          fontSize: 30,
          lineHeight: 1.55,
          letterSpacing: 1.5,
          minHeight: VERTICAL_INDICES.has(idx) ? 480 : 120,
          border: '1px solid rgba(255, 255, 255, 0.06)',
          writingMode: VERTICAL_INDICES.has(idx) ? 'vertical-rl' : undefined
        }}
      >
        {LINES[idx]}
      </div>

      {/* Controls */}
      <div
        style={{
          marginTop: 14,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          fontSize: 13,
          color: '#aaa'
        }}
      >
        <button
          type="button"
          onClick={() => setIdx((i) => (i - 1 + LINES.length) % LINES.length)}
          style={btn}
        >
          ← Prev
        </button>
        <button
          type="button"
          onClick={() => setIdx((i) => (i + 1) % LINES.length)}
          style={btn}
        >
          Next →
        </button>
        <button type="button" onClick={() => setAuto((a) => !a)} style={btn}>
          {auto ? '⏸ Pause auto' : '▶ Auto-advance (4s)'}
        </button>
        <span style={{ marginLeft: 'auto' }}>
          Line {idx + 1} / {LINES.length}
        </span>
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: '#666' }}>
        Pick this window in the yomiko source picker, drag a rectangle
        over the textbox, advance lines with → or Space.
      </div>
    </div>
  )
}

const btn: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.05)',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  color: '#ddd',
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer'
}
