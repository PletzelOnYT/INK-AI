// INK AI optional macOS companion.
// Uses Apple's on-device Vision framework, not a network OCR API.
// Only listens on loopback, requires a random per-launch token, and never
// saves or logs captured images. Build with the shipped start script.
import Foundation
import AppKit
import Vision
import ImageIO
import Darwin

private let port: UInt16 = 17861
private let token = ProcessInfo.processInfo.environment["INK_VISION_TOKEN"] ?? ""
private let originAllowlist = ["null", "http://localhost", "http://127.0.0.1"]
private let workLimit = DispatchSemaphore(value: 1)

private func json(_ value: Any) -> Data {
    return (try? JSONSerialization.data(withJSONObject: value, options: []))
        ?? Data("{}".utf8)
}

private func bound(_ box: CGRect, width: Int, height: Int) -> [String: Double] {
    return [
        "x0": Double(box.minX) * Double(width),
        "y0": (1.0 - Double(box.maxY)) * Double(height),
        "x1": Double(box.maxX) * Double(width),
        "y1": (1.0 - Double(box.minY)) * Double(height)
    ]
}

private func ocr(_ cgImage: CGImage, fast: Bool) throws -> [String: Any] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = fast ? .fast : .accurate
    request.usesLanguageCorrection = true
    request.minimumTextHeight = 0.004
    request.recognitionLanguages = ["en-US"]
    let started = CFAbsoluteTimeGetCurrent()
    try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
    let width = cgImage.width, height = cgImage.height
    var output: [[String: Any]] = []
    var allWords: [[String: Any]] = []
    let matcher = try NSRegularExpression(pattern: #"\S+"#)
    for observation in request.results ?? [] {
        guard let candidate = observation.topCandidates(1).first else { continue }
        let line = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !line.isEmpty, candidate.confidence >= 0.28 else { continue }
        var words: [[String: Any]] = []
        for match in matcher.matches(in: candidate.string,
                                     range: NSRange(candidate.string.startIndex...,
                                                    in: candidate.string)) {
            guard let range = Range(match.range, in: candidate.string) else { continue }
            let word = String(candidate.string[range])
            if word.isEmpty { continue }
            let rectangle = (try? candidate.boundingBox(for: range))?.boundingBox
                ?? observation.boundingBox
            let item: [String: Any] = [
                "text": word,
                "confidence": Double(candidate.confidence),
                "box": bound(rectangle, width: width, height: height)
            ]
            words.append(item)
            allWords.append(item)
        }
        output.append([
            "text": line,
            "confidence": Double(candidate.confidence),
            "box": bound(observation.boundingBox, width: width, height: height),
            "words": words
        ])
    }
    return ["engine": "apple-vision-local",
            "width": width, "height": height,
            "elapsedMs": (CFAbsoluteTimeGetCurrent() - started) * 1000.0,
            "lines": output, "words": allWords]
}

private func recognizeJPEG(_ content: Data, fast: Bool) throws -> [String: Any] {
    guard let source = CGImageSourceCreateWithData(content as CFData, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { throw NSError(domain: "INKVision", code: 400,
                         userInfo: [NSLocalizedDescriptionKey: "Invalid JPEG image"]) }
    return try ocr(image, fast: fast)
}

private struct HTTPRequest {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data
}

private func readRequest(_ fd: Int32) -> HTTPRequest? {
    var data = Data(), headerEnd: Range<Data.Index>?
    let cap = 6 * 1024 * 1024
    while headerEnd == nil && data.count < 48_000 {
        var block = [UInt8](repeating: 0, count: 16_384)
        let count = block.withUnsafeMutableBytes {
            recv(fd, $0.baseAddress, $0.count, 0)
        }
        if count <= 0 { return nil }
        data.append(contentsOf: block.prefix(count))
        headerEnd = data.range(of: Data("\r\n\r\n".utf8))
    }
    guard let end = headerEnd,
          let headerText = String(data: data[..<end.lowerBound], encoding: .utf8)
    else { return nil }
    let lines = headerText.components(separatedBy: "\r\n")
    let first = lines[0].split(separator: " ")
    guard first.count >= 2 else { return nil }
    var headers = [String: String]()
    for line in lines.dropFirst() {
        guard let colon = line.firstIndex(of: ":") else { continue }
        let key = line[..<colon].lowercased()
        let value = line[line.index(after: colon)...]
            .trimmingCharacters(in: .whitespacesAndNewlines)
        headers[String(key)] = value
    }
    let length = Int(headers["content-length"] ?? "0") ?? 0
    guard length >= 0 && length <= cap else { return nil }
    var body = Data(data[end.upperBound...])
    while body.count < length {
        var block = [UInt8](repeating: 0, count: min(16_384, length-body.count))
        let count = block.withUnsafeMutableBytes {
            recv(fd, $0.baseAddress, $0.count, 0)
        }
        if count <= 0 { return nil }
        body.append(contentsOf: block.prefix(count))
    }
    if body.count > length { body = Data(body.prefix(length)) }
    return HTTPRequest(method: String(first[0]), path: String(first[1]),
                       headers: headers, body: body)
}

private func sendAll(_ fd: Int32, _ data: Data) {
    data.withUnsafeBytes { pointer in
        guard let base = pointer.baseAddress else { return }
        var offset = 0
        while offset < pointer.count {
            let sent = send(fd, base.advanced(by: offset), pointer.count-offset, 0)
            if sent <= 0 { return }
            offset += sent
        }
    }
}

private func respond(_ fd: Int32, status: Int, payload: [String: Any]) {
    let body = json(payload)
    let title = status == 200 ? "OK" : status == 401 ? "Unauthorized" :
        status == 403 ? "Forbidden" : status == 404 ? "Not Found" :
        status == 503 ? "Busy" : "Bad Request"
    let head = "HTTP/1.1 \(status) \(title)\r\n" +
        "Content-Type: application/json; charset=utf-8\r\n" +
        "Content-Length: \(body.count)\r\n" +
        "Access-Control-Allow-Origin: null\r\n" +
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
        "Access-Control-Allow-Headers: Content-Type, X-Ink-Token\r\n" +
        "Access-Control-Allow-Private-Network: true\r\n" +
        "Cache-Control: no-store\r\n" +
        "Connection: close\r\n\r\n"
    sendAll(fd, Data(head.utf8))
    sendAll(fd, body)
}

private func acceptedOrigin(_ origin: String?) -> Bool {
    guard let origin = origin else { return true }
    return origin == "null" || origin.hasPrefix("http://localhost:") ||
           origin.hasPrefix("http://127.0.0.1:")
}

private func handle(_ fd: Int32) {
    defer { close(fd) }
    guard let req = readRequest(fd) else {
        respond(fd, status: 400, payload: ["error": "Invalid request"])
        return
    }
    guard acceptedOrigin(req.headers["origin"]) else {
        respond(fd, status: 403, payload: ["error": "Origin not allowed"])
        return
    }
    if req.method == "OPTIONS" {
        respond(fd, status: 200, payload: ["ok": true])
        return
    }
    guard req.headers["x-ink-token"] == token else {
        respond(fd, status: 401, payload: ["error": "Token required"])
        return
    }
    if req.method == "GET", req.path == "/health" {
        respond(fd, status: 200,
                payload: ["engine": "apple-vision-local", "ok": true])
        return
    }
    guard req.method == "POST", req.path.hasPrefix("/ocr") else {
        respond(fd, status: 404, payload: ["error": "Unknown endpoint"])
        return
    }
    // Only one native Vision inference at once. Drop excess requests rather
    // than queue old camera frames and increase latency.
    guard workLimit.wait(timeout: .now()) == .success else {
        respond(fd, status: 503, payload: ["error": "Busy; retry next frame"])
        return
    }
    defer { workLimit.signal() }
    do {
        let response = try recognizeJPEG(req.body,
                                         fast: req.path.contains("mode=fast"))
        respond(fd, status: 200, payload: response)
    } catch {
        respond(fd, status: 400,
                payload: ["error": "OCR failed: \(error.localizedDescription)"])
    }
}

private func syntheticImage(_ contents: String, dark: Bool) -> CGImage {
    let width = 920, height = 200
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width,
        pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    (dark ? NSColor.black : NSColor.white)
        .setFill()
    NSRect(x: 0, y: 0, width: width, height: height).fill()
    (contents as NSString).draw(at: NSPoint(x: 60, y: 65),
       withAttributes: [
        .font: NSFont.boldSystemFont(ofSize: 72),
        .foregroundColor: dark ? NSColor.white : NSColor.black
       ])
    NSGraphicsContext.restoreGraphicsState()
    return rep.cgImage!
}

private func selftest() {
    do {
        for dark in [false, true] {
            let result = try ocr(syntheticImage("NY THREADS", dark: dark),
                                 fast: false)
            let lines = result["lines"] as? [[String: Any]] ?? []
            let text = lines.compactMap { $0["text"] as? String }
                            .joined(separator: " ").uppercased()
            guard text.contains("NY") && text.contains("THREADS") else {
                fputs("FAIL: Native Vision did not read NY THREADS: \(text)\n", stderr)
                exit(1)
            }
            print("PASS: \(dark ? "light on dark" : "dark on light") text; " +
                  "Vision recognized \(text)")
        }
        print("PASS: macOS Vision local OCR selftest")
    } catch {
        fputs("FAIL: Vision selftest: \(error)\n", stderr)
        exit(1)
    }
}

if CommandLine.arguments.contains("--selftest") {
    selftest()
    exit(0)
}
guard token.count >= 24 else {
    fputs("Set a random INK_VISION_TOKEN (minimum 24 characters).\n", stderr)
    exit(1)
}
let listener = socket(AF_INET, SOCK_STREAM, 0)
guard listener >= 0 else { fatalError("Unable to open local socket") }
var reusable: Int32 = 1
setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &reusable,
           socklen_t(MemoryLayout<Int32>.size))
var addr = sockaddr_in()
addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
addr.sin_family = sa_family_t(AF_INET)
addr.sin_port = port.bigEndian
addr.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
let bound = withUnsafePointer(to: &addr) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        bind(listener, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
    }
}
guard bound == 0, listen(listener, 8) == 0 else {
    fputs("INK Vision already running or port 17861 is unavailable.\n", stderr)
    exit(1)
}
print("INK Vision: on-device OCR at 127.0.0.1:\(port); no camera uploads")
fflush(stdout)
while true {
    let client = accept(listener, nil, nil)
    if client < 0 { continue }
    DispatchQueue.global(qos: .userInitiated).async {
        handle(client)
    }
}
