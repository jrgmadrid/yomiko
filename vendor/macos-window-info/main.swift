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
//   sidecar → client:  {"id":12345,"bounds":[x,y,w,h],"name":"Safari","onScreen":true} \n
//   sidecar → client:  {"id":12345,"error":"window not found"} \n
//
// Bounds are in macOS screen coordinates (DIPs / points), top-left origin —
// same coordinate space as Electron's BrowserWindow.getBounds().

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
        writeLine(["id": NSNull(), "error": "invalid id: \(trimmed)"])
        continue
    }

    // Enumerate all on-screen windows and filter by ID. CGWindowList's
    // single-window query semantics are fiddly (.optionIncludingWindow
    // means "above window N including N"); enumerate is simpler and just
    // as fast.
    let opts: CGWindowListOption = [.optionOnScreenOnly]
    guard let infoArr = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
        writeLine(["id": id, "error": "CGWindowListCopyWindowInfo returned nil"])
        continue
    }

    let match = infoArr.first { ($0["kCGWindowNumber"] as? UInt32) == id }
    guard let dict = match else {
        writeLine(["id": id, "error": "window not on-screen"])
        continue
    }

    var x: Double = 0, y: Double = 0, w: Double = 0, h: Double = 0
    if let bounds = dict["kCGWindowBounds"] as? [String: Any] {
        x = bounds["X"] as? Double ?? 0
        y = bounds["Y"] as? Double ?? 0
        w = bounds["Width"] as? Double ?? 0
        h = bounds["Height"] as? Double ?? 0
    }
    let name = (dict["kCGWindowOwnerName"] as? String) ?? ""

    writeLine([
        "id": id,
        "bounds": [x, y, w, h],
        "name": name
    ])
}

logErr("stdin closed; exiting")
