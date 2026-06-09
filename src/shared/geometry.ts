/** Vertical-text heuristic shared by main (line-crop padding) and renderer
 *  (translation-overlay placement): a line whose bbox is much taller than
 *  wide is vertical Japanese. */
export function isVerticalRect(rect: { w: number; h: number }): boolean {
  return rect.h > rect.w * 1.5
}
