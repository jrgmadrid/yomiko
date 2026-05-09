// macos-window-info — looks up window bounds via CGWindowListCopyWindowInfo.
//
// Persistent sidecar: reads window IDs (CGWindowID, decimal) one per line on
// stdin, writes one JSON object per line to stdout. Used by yomiko to
// track a captured window's screen position so we can place hover zones in
// screen coords over the user's mouse target.
//
// Why a sidecar (vs. FFI from Node): CGWindowListCopyWindowInfo returns CFArray
// of CFDictionary which is painful to walk via koffi/ffi-napi. Native module
// is build-ops cost we don't need. Sidecar is microsecond-cheap per call and
// matches the pattern we already use for macos-vision-ocr.
//
// Permission: enumerating window bounds needs no permission on macOS. Only
// kCGWindowName (titles) and the actual window contents require Screen
// Recording. We deliberately do not return titles to avoid the prompt.
//
// Protocol:
//   client → sidecar:  "<window-id>\n"
//   sidecar → client:  {"bounds":[x,y,w,h]} \n          (success)
//   sidecar → client:  {"error":"window not on-screen"} \n   (recoverable)
//
// Bounds are in macOS screen coordinates (DIPs / points), top-left origin —
// same coordinate space as Electron's BrowserWindow.getBounds(). Responses
// are FIFO-aligned with requests; the client matches them by order.

import Foundation
import CoreGraphics

@inline(__always)
func logErr(_ message: String) {
    if let data = (message + "\n").data(using: .utf8) {
        FileHandle.standardError.write(data)
    }
}

func writeLine(_ obj: [String: Any]) {
    do {
        let data = try JSONSerialization.data(withJSONObject: obj, options: [])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A])) // \n
    } catch {
        logErr("writeLine: \(error.localizedDescription)")
    }
}

logErr("macos-window-info ready")

while let raw = readLine() {
    let trimmed = raw.trimmingCharacters(in: .whitespaces)
    guard let id = UInt32(trimmed) else {
        writeLine(["error": "invalid id: \(trimmed)"])
        continue
    }

    // CGWindowList's single-window query (.optionIncludingWindow means
    // "above window N including N") is fiddly; enumerate-and-filter is
    // simpler and microsecond-cheap.
    let opts: CGWindowListOption = [.optionOnScreenOnly]
    guard let infoArr = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
        writeLine(["error": "CGWindowListCopyWindowInfo returned nil"])
        continue
    }

    guard let dict = infoArr.first(where: { ($0["kCGWindowNumber"] as? UInt32) == id }) else {
        writeLine(["error": "window not on-screen"])
        continue
    }

    var x: Double = 0, y: Double = 0, w: Double = 0, h: Double = 0
    if let bounds = dict["kCGWindowBounds"] as? [String: Any] {
        x = bounds["X"] as? Double ?? 0
        y = bounds["Y"] as? Double ?? 0
        w = bounds["Width"] as? Double ?? 0
        h = bounds["Height"] as? Double ?? 0
    }

    writeLine(["bounds": [x, y, w, h]])
}

logErr("stdin closed; exiting")
