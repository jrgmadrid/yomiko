// macos-vision-ocr — Apple Vision Japanese OCR sidecar.
//
// Reads length-prefixed PNG frames from stdin, runs VNRecognizeTextRequest
// (Japanese, .accurate level), emits NDJSON to stdout — one line per request.
//
// Why .accurate: .fast returns essentially zero observations for Japanese
// VN text in practice — empirically tested 2026-05-08. .accurate is the only
// recognitionLevel that produces usable Japanese results.
//
// Per-character bbox tradeoff: VNRecognizedText.boundingBox(for:) at .accurate
// collapses every character range inside a "word" to the same word-level rect,
// and Japanese has no spaces — so the whole line collapses to one rect. We
// emit only the line-level bbox and synthesize per-character rects on the Node
// side by proportionally dividing the line width. CJK fonts are near-monospace
// so this approximation is tight enough for hover hit zones.
//
// Bounding boxes are Vision-normalized: 0–1, bottom-left origin, relative to
// the input image. Conversion to image pixels and Y-flip happen on the Node
// side (apple-vision.ts).
//
// Protocol:
//   client → sidecar:  [u32-BE length][PNG bytes] (length excludes the prefix)
//   sidecar → client:  {"lines":[{"text":"...","bbox":[x,y,w,h]}, ...],
//                       "ts": <unix ms>} \n
//   sidecar → client:  {"error": "..."} \n   (recoverable; sidecar continues)
//
// Logging goes to stderr to keep stdout clean for the JSON stream.

import Foundation
import Vision
import AppKit

@inline(__always)
func logErr(_ message: String) {
    if let data = (message + "\n").data(using: .utf8) {
        FileHandle.standardError.write(data)
    }
}

func readExactly(_ handle: FileHandle, count: Int) -> Data? {
    var buf = Data()
    buf.reserveCapacity(count)
    while buf.count < count {
        let chunk = handle.readData(ofLength: count - buf.count)
        if chunk.isEmpty { return nil }
        buf.append(chunk)
    }
    return buf
}

func readUInt32BE(_ handle: FileHandle) -> UInt32? {
    guard let data = readExactly(handle, count: 4) else { return nil }
    return (UInt32(data[0]) << 24)
        | (UInt32(data[1]) << 16)
        | (UInt32(data[2]) << 8)
        | UInt32(data[3])
}

struct LineBox: Encodable {
    let text: String
    let bbox: [Double]  // [x, y, w, h], normalized, bottom-left origin
}

struct OcrOutput: Encodable {
    let lines: [LineBox]
    let ts: Double
}

struct OcrError: Encodable {
    let error: String
}

func bboxArray(_ rect: CGRect) -> [Double] {
    return [Double(rect.minX), Double(rect.minY), Double(rect.width), Double(rect.height)]
}

func recognize(pngData: Data) -> [LineBox] {
    guard let nsImage = NSImage(data: pngData),
          let cgImage = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        logErr("recognize: failed to decode PNG")
        return []
    }

    var collected: [LineBox] = []
    let request = VNRecognizeTextRequest { req, err in
        if let err = err {
            logErr("recognize: VN error: \(err.localizedDescription)")
            return
        }
        guard let observations = req.results as? [VNRecognizedTextObservation] else { return }
        for obs in observations {
            guard let candidate = obs.topCandidates(1).first else { continue }
            collected.append(LineBox(text: candidate.string, bbox: bboxArray(obs.boundingBox)))
        }
    }
    request.recognitionLanguages = ["ja-JP", "en-US"]
    request.recognitionLevel = .accurate
    // Autocorrects VN character names into common nouns; rely on raw OCR text.
    request.usesLanguageCorrection = false
    request.automaticallyDetectsLanguage = false

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
        try handler.perform([request])
    } catch {
        logErr("recognize: handler.perform failed: \(error.localizedDescription)")
    }
    return collected
}

let encoder = JSONEncoder()
let stdout = FileHandle.standardOutput

func writeJSON<T: Encodable>(_ value: T) {
    do {
        let data = try encoder.encode(value)
        stdout.write(data)
        stdout.write(Data([0x0A])) // \n
    } catch {
        logErr("writeJSON: encode failed: \(error.localizedDescription)")
    }
}

logErr("macos-vision-ocr ready")

let stdin = FileHandle.standardInput
while let length = readUInt32BE(stdin) {
    if length == 0 || length > 32_000_000 {
        writeJSON(OcrError(error: "invalid length: \(length)"))
        continue
    }
    guard let pngData = readExactly(stdin, count: Int(length)) else {
        logErr("stdin closed mid-frame; exiting")
        break
    }
    let lines = recognize(pngData: pngData)
    writeJSON(OcrOutput(lines: lines, ts: Date().timeIntervalSince1970 * 1000))
}
