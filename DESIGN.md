# yomiko design language

## Aesthetic identity

Late-90s / early-2000s Japanese game UI (Konami dating-sim lineage; TokiMemo as the reference point) translated into a transparent screen overlay. Panel surfaces are treated as 16-bit-game dialogue boxes: warm-tinted-dark surfaces (never pure black), sharp square corners, double-line borders, hard offset drop shadows. No anti-aliased glass blur; the chrome is meant to read as discrete game UI, not as a modern translucent-card overlay. Readability comes first: the overlay sits on top of someone's reading material, so decoration is rationed to the surfaces that invite it (popup, modals) and absent from the surfaces that don't (translation overlay, status strip).

## Palette

OKLCH, declared in a Tailwind `@theme` block in `src/renderer/src/assets/main.css` — so each token is both a CSS variable and a generated utility class (`text-text-secondary`, `bg-surface-base`, `bg-accent-rose-tint`, …). Components style color via those utilities, never inline `style` objects; the `.vnr-*` chrome classes consume the variables directly.

- Surfaces — `--color-surface-base` `oklch(0.18 0.012 350)`, `--color-surface-raised` `oklch(0.22 0.015 350)`, `--color-surface-edge` `oklch(0.32 0.02 350)`.
- Text — `--color-text-primary` `oklch(0.95 0.015 80 / 0.92)`, `--color-text-secondary` `oklch(0.95 0.015 80 / 0.58)`, `--color-text-tertiary` `oklch(0.95 0.015 80 / 0.32)`. Three tiers, no other opacities.
- Accents — `--color-accent-rose` `oklch(0.78 0.1 0)` (primary; headlines, active state, mining hint), `--color-accent-mint` `oklch(0.85 0.06 165)` (ready/success), `--color-accent-amber` `oklch(0.82 0.09 75)` (warning/offline), `--color-accent-lavender` `oklch(0.75 0.08 300)` (secondary info — parts of speech, deinflection chain). `--color-accent-rose-dim` is reserved for double-line border halos.
- Tints — `--color-accent-{rose,mint,amber}-tint`: the one sanctioned wash alpha per accent for pill/hover backgrounds. Don't invent new alphas inline.

## Typography

Japanese: Hiragino Maru Gothic ProN, then YuGothic Maru, then the Kaku Gothic fallbacks. Maru's rounded terminals are the JP-game-UI tell. Latin falls through to the system stack. Weights: 400 body, 500 panel headlines. No italics, no condensed.

## Borders & elevation

Panels (popup, force-translate card, source picker) get the pixel-box treatment as the `.vnr-panel` utility. Three inset box-shadow layers paint a double border:

1. inset 1px `--color-surface-edge` — outer line.
2. inset 1px `--color-surface-base` (rows 2–3, so a 2px gap) — space between outer and inner border lines.
3. inset 1px `--color-accent-rose-dim` — inner line.

`clip-path: polygon(...)` notches the four corners by 4px on each axis so the panel reads as an octagonal game-UI shape rather than a generic rectangle. No drop shadow, no `border-radius`, no outer outline, no `backdrop-blur`. The double border carries the edge against any captured background.

Ambient surfaces (translation overlay, status strip) skip `.vnr-panel` entirely. They use a quiet tinted background and, for the status strip (`.vnr-strip`), a two-tone pixel-band top edge: an inset 1px `--color-surface-edge` line followed by a 1px gap and a 1px `--color-accent-rose-dim` line. The band reads as the bottom rail of a game-UI panel without enclosing the strip in chrome.

The translation overlay additionally gates its render on a `dwelledLineKey` state in `HoverProtoLayer` — the overlay does not mount until the user has held a hover on a single `(frameId, lineIdx)` long enough for the 250ms dwell timer to fire. Cursor passing through hover zones never flashes overlay content. Re-hovers of an already-dwelled line show the cached translation instantly.

## Motion

Durations 150–250ms; curve `cubic-bezier(0.16, 1, 0.3, 1)` (`--ease-out-expo`). The pulsing three-dot affordance (`.vnr-pulse`) is the only sanctioned loading visual; it animates opacity, not position, so it never reads as a generic shimmer sweep.

## Ornament policy

No ornament on persistent surfaces — no hearts, sparkles, dingbats on translation, status, or popup chrome. Transient success states (e.g. a future mining-result toast) may earn a small mark; persistent chrome never does. The existing `⚠` in the VLM-offline pill and `⇧` in the dict hint are functional glyphs, not ornament.

## Chrome differentiation by role

| Surface | Treatment |
|---|---|
| Status strip (`App.tsx`) | `.vnr-strip`: tinted-dark backdrop (surface-base at 85%) so pills remain legible against bright captured pixels. Two-tone pixel-band top edge per the borders section. No card enclosure. |
| Translation overlay (`HoverProtoLayer.tsx`) | Ambient. Quiet tinted backdrop (surface-base at 78%), no border, no shadow, no rounded corners. The reading surface is sacred. |
| JMdict popup (`Popup.tsx`) | Full panel. Double-line border, raised surface, rose headline, lavender for parts-of-speech and deinflection chain. |
| Force-translate card (`ForceTranslationOverlay.tsx`) | Same panel treatment as the popup. Dismiss caption in normal case at `--text-tertiary`. |
| Source picker (`SourcePicker.tsx`) | Same panel treatment. Thumbnail tiles use `--surface-raised`; hover swaps the inset edge to rose. |
