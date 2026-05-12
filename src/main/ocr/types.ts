// OCR backend interface. All backends speak the same recognize(png) → result
// contract; the OCRSource picks one based on platform (Apple Vision on Mac,
// Windows.Media.Ocr on Win, manga-ocr ONNX in heavy mode).

export interface OcrRect {
  /** Image-pixel coords, top-left origin. */
  x: number
  y: number
  w: number
  h: number
}

export interface OcrCharBox {
  text: string
  rect: OcrRect
}

export interface OcrLine {
  text: string
  rect: OcrRect
  /**
   * Per-character bounding boxes inside this line. Empty for backends that
   * don't yet emit char-level data (Win sidecar pre-bbox extension).
   */
  chars: OcrCharBox[]
}

export interface OcrResult {
  lines: OcrLine[]
  /** Pixel dimensions of the image that produced this result. Needed for
   *  un-rotating bboxes when the renderer pre-rotated the input for
   *  vertical Japanese — rotImgH = orig_W, so bbox-back math requires
   *  knowing the rotated-image dimensions. Zero on backends that don't
   *  populate it (Win OCR sidecar pre-bbox extension). */
  imageWidth: number
  imageHeight: number
}

export interface OcrBackend {
  readonly id: string

  /**
   * Run OCR on a PNG-encoded image. Returns recognized lines with bounding
   * boxes in image-pixel coords, top-left origin. Throws on backend failure
   * (sidecar crash, etc.); the caller decides whether to retry.
   */
  recognize(png: Buffer): Promise<OcrResult>

  /** Tear down underlying processes/resources. Idempotent. */
  close(): Promise<void>
}

/** Joins all line texts with `\n` — used by callers that only want the text. */
export function ocrResultToText(result: OcrResult): string {
  return result.lines.map((l) => l.text).join('\n')
}
