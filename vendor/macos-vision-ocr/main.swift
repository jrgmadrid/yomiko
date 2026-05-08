// macos-vision-ocr — Apple Vision Japanese OCR sidecar.
//
// Reads length-prefixed PNG frames from stdin, runs VNRecognizeTextRequest
// (Japanese + English, accurate, language correction), emits NDJSON to
// stdout — one line per request.
//
// Protocol:
//   client → sidecar:  [u32-BE length][PNG bytes] (length excludes the prefix)
//   sidecar → client:  {"lines": [...], "ts": <unix ms>} \n
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

func recognize(pngData: Data) -> [String] {
    guard let nsImage = NSImage(data: pngData),
          let cgImage = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        logErr("recognize: failed to decode PNG")
        return []
    }

    var collected: [String] = []
    let request = VNRecognizeTextRequest { req, err in
        if let err = err {
            logErr("recognize: VN error: \(err.localizedDescription)")
            return
        }
        guard let observations = req.results as? [VNRecognizedTextObservation] else { return }
        for obs in observations {
            if let candidate = obs.topCandidates(1).first {
                collected.append(candidate.string)
            }
        }
    }
    request.recognitionLanguages = ["ja-JP", "en-US"]
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.automaticallyDetectsLanguage = false

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
        try handler.perform([request])
    } catch {
        logErr("recognize: handler.perform failed: \(error.localizedDescription)")
    }
    return collected
}

struct OcrOutput: Encodable {
    let lines: [String]
    let ts: Double
}

struct OcrError: Encodable {
    let error: String
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
