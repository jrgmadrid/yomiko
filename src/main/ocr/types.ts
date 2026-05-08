// OCR backend interface. All backends speak the same recognize(png) → text
// contract; the OCRSource picks one based on platform (Apple Vision on Mac,
// Windows.Media.Ocr on Win, manga-ocr ONNX in heavy mode).

export interface OcrBackend {
  readonly id: string

  /**
   * Run OCR on a PNG-encoded image and return the recognized text. Lines are
   * joined with `\n`. Throws on backend failure (sidecar crash, etc.); the
   * caller decides whether to retry.
   */
  recognize(png: Buffer): Promise<string>

  /** Tear down underlying processes/resources. Idempotent. */
  close(): Promise<void>
}
