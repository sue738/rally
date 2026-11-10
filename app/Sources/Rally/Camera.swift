// カメラで撮る: one photo from a camera — this Mac's, or an iPhone that offers itself (Continuity Camera) —
// taken in a sheet over the board and handed back as a JPEG. The camera runs only while the sheet is open:
// nothing is kept before 撮る, and closing the sheet lets go of it (the green light goes out).
import AppKit
import AVFoundation

final class CameraSheet: NSObject, AVCapturePhotoCaptureDelegate {
    private let session = AVCaptureSession()
    private let output = AVCapturePhotoOutput()
    /// startRunning / stopRunning block, and a camera can take a second to wake
    private let sessionQueue = DispatchQueue(label: "rally.camera")
    private var panel: NSPanel?
    private var preview: AVCaptureVideoPreviewLayer?
    private var picker: NSPopUpButton?
    private var shoot: NSButton?
    private var note: NSTextField?
    private var devices: [AVCaptureDevice] = []
    private var done: ((Data?, String?) -> Void)?
    private weak var parent: NSWindow?

    var isOpen: Bool { done != nil }

    static var deniedText: String {
        L("カメラが許可されていません(システム設定 → プライバシーとセキュリティ → カメラ で Rally をオンにしてください)",
          "The camera is not allowed (turn Rally on in System Settings → Privacy & Security → Camera)")
    }

    /// The cameras a photo can come from: built in, plugged in, or an iPhone nearby.
    static func cameras() -> [AVCaptureDevice] {
        AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInWideAngleCamera, .external, .continuityCamera], mediaType: .video, position: .unspecified).devices
    }

    /// `done(jpeg, error)` is called once: both nil when the sheet was closed without a photo.
    func begin(on window: NSWindow, done: @escaping (Data?, String?) -> Void) {
        if isOpen { return done(nil, nil) }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            open(on: window, done: done)
        case .notDetermined:
            // macOS asks once; the answer is remembered for this app
            self.done = done
            AVCaptureDevice.requestAccess(for: .video) { ok in
                DispatchQueue.main.async {
                    self.done = nil
                    if ok { self.open(on: window, done: done) } else { done(nil, Self.deniedText) }
                }
            }
        default:
            done(nil, Self.deniedText)
        }
    }

    private func open(on window: NSWindow, done: @escaping (Data?, String?) -> Void) {
        devices = Self.cameras()
        guard !devices.isEmpty else { return done(nil, L("カメラが見つかりません", "No camera found")) }
        self.done = done
        parent = window
        let p = makePanel(cameras: devices.map { $0.localizedName })
        // the one macOS would pick (the user's own choice in the menu bar's video menu, when there is one)
        let first = AVCaptureDevice.systemPreferredCamera.flatMap { want in devices.firstIndex { $0.uniqueID == want.uniqueID } }
            ?? AVCaptureDevice.default(for: .video).flatMap { want in devices.firstIndex { $0.uniqueID == want.uniqueID } } ?? 0
        picker?.selectItem(at: first)
        use(devices[first])
        window.beginSheet(p) { _ in }
    }

    /// The sheet: the camera's picture, which camera (when there is a choice), やめる and 撮る. Starts no camera.
    func makePanel(cameras names: [String]) -> NSPanel {
        let vw: CGFloat = 640, vh: CGFloat = 400, pad: CGFloat = 16, bar: CGFloat = 52
        let p = NSPanel(contentRect: NSRect(x: 0, y: 0, width: vw + pad * 2, height: vh + pad + bar), styleMask: [.titled], backing: .buffered, defer: false)
        let root = NSView(frame: p.contentRect(forFrameRect: p.frame))
        let video = NSView(frame: NSRect(x: pad, y: bar, width: vw, height: vh))
        video.wantsLayer = true
        video.layer?.backgroundColor = NSColor.black.cgColor
        video.layer?.cornerRadius = 8
        video.layer?.masksToBounds = true
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspect
        layer.frame = video.bounds
        layer.autoresizingMask = [.layerWidthSizable, .layerHeightSizable]
        video.layer?.addSublayer(layer)
        preview = layer
        root.addSubview(video)

        let take = NSButton(title: L("撮る", "Take photo"), target: self, action: #selector(takePhoto))
        take.keyEquivalent = "\r"
        take.isEnabled = false
        take.sizeToFit()
        take.frame.origin = NSPoint(x: vw + pad - take.frame.width, y: (bar - take.frame.height) / 2)
        root.addSubview(take)
        shoot = take
        let cancel = NSButton(title: L("やめる", "Cancel"), target: self, action: #selector(cancelSheet))
        cancel.keyEquivalent = "\u{1b}"
        cancel.sizeToFit()
        cancel.frame.origin = NSPoint(x: take.frame.minX - cancel.frame.width - 4, y: take.frame.minY)
        root.addSubview(cancel)

        // which camera, when there is a choice (an iPhone nearby shows up here)
        let pop = NSPopUpButton(frame: .zero, pullsDown: false)
        // through the menu: addItem(withTitle:) drops an earlier item of the same name, and two cameras can share one
        for n in names { pop.menu?.addItem(NSMenuItem(title: n, action: nil, keyEquivalent: "")) }
        pop.target = self
        pop.action = #selector(pickCamera)
        pop.sizeToFit()
        pop.frame = NSRect(x: pad - 2, y: (bar - pop.frame.height) / 2, width: min(pop.frame.width, 260), height: pop.frame.height)
        pop.isHidden = names.count < 2
        root.addSubview(pop)
        picker = pop
        let label = NSTextField(labelWithString: "")
        label.textColor = .secondaryLabelColor
        label.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
        label.lineBreakMode = .byTruncatingTail
        let left = pop.isHidden ? pad : pop.frame.maxX + 8
        label.frame = NSRect(x: left, y: (bar - 16) / 2, width: max(0, cancel.frame.minX - left - 8), height: 16)
        root.addSubview(label)
        note = label

        p.contentView = root
        panel = p
        return p
    }

    /// Point the session at one camera and start it.
    private func use(_ device: AVCaptureDevice) {
        shoot?.isEnabled = false
        note?.stringValue = L("カメラを起こしています…", "Waking the camera…")
        sessionQueue.async {
            self.session.beginConfiguration()
            for i in self.session.inputs { self.session.removeInput(i) }
            var problem: String?
            do {
                let input = try AVCaptureDeviceInput(device: device)
                if self.session.canAddInput(input) { self.session.addInput(input) } else { problem = L("このカメラは使えません", "This camera cannot be used") }
            } catch { problem = error.localizedDescription }
            if self.session.outputs.isEmpty, self.session.canAddOutput(self.output) { self.session.addOutput(self.output) }
            if self.session.canSetSessionPreset(.photo) { self.session.sessionPreset = .photo }
            self.session.commitConfiguration()
            if problem == nil, !self.session.isRunning { self.session.startRunning() }
            DispatchQueue.main.async {
                guard self.isOpen else { return }
                // what is on screen is what is saved: not mirrored, so words held up to it read the right way
                if let c = self.preview?.connection, c.isVideoMirroringSupported {
                    c.automaticallyAdjustsVideoMirroring = false
                    c.isVideoMirrored = false
                }
                self.note?.stringValue = problem ?? ""
                self.shoot?.isEnabled = problem == nil
            }
        }
    }

    @objc private func pickCamera() {
        guard let i = picker?.indexOfSelectedItem, devices.indices.contains(i) else { return }
        use(devices[i])
    }

    @objc private func takePhoto() {
        guard isOpen, shoot?.isEnabled == true else { return }
        shoot?.isEnabled = false
        sessionQueue.async {
            guard self.session.isRunning, self.output.connection(with: .video) != nil else {
                return DispatchQueue.main.async { self.finish(nil, L("撮れませんでした", "Could not take the photo")) }
            }
            let settings = self.output.availablePhotoCodecTypes.contains(.jpeg)
                ? AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg]) : AVCapturePhotoSettings()
            self.output.capturePhoto(with: settings, delegate: self)
        }
    }

    @objc private func cancelSheet() { finish(nil, nil) }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        var data = photo.fileDataRepresentation()
        // a camera that hands back something else (HEIC, TIFF): a JPEG all the same, which every agent reads
        if let d = data, !(d.count > 2 && d[d.startIndex] == 0xFF && d[d.startIndex + 1] == 0xD8) {
            data = NSBitmapImageRep(data: d)?.representation(using: .jpeg, properties: [.compressionFactor: 0.9])
        }
        let problem = error?.localizedDescription ?? (data == nil ? L("撮れませんでした", "Could not take the photo") : nil)
        DispatchQueue.main.async { self.finish(problem == nil ? data : nil, problem) }
    }

    /// Close the sheet, let go of the camera, answer once.
    private func finish(_ data: Data?, _ error: String?) {
        guard let done = done else { return }
        self.done = nil
        sessionQueue.async {
            if self.session.isRunning { self.session.stopRunning() }
            self.session.beginConfiguration()
            for i in self.session.inputs { self.session.removeInput(i) }
            self.session.commitConfiguration()
        }
        if let p = panel {
            if let w = parent, p.sheetParent != nil { w.endSheet(p) }
            p.orderOut(nil)
        }
        panel = nil; preview = nil; picker = nil; shoot = nil; note = nil
        done(data, error)
    }

    /// The selftest's photo: drawn here, no camera touched (a test must never turn the camera on).
    static func fixtureJPEG() -> Data? {
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 64, pixelsHigh: 48, bitsPerSample: 8, samplesPerPixel: 4,
                                   hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
        guard let rep = rep, let ctx = NSGraphicsContext(bitmapImageRep: rep) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = ctx
        NSColor(calibratedRed: 0.20, green: 0.45, blue: 0.75, alpha: 1).setFill()
        NSRect(x: 0, y: 0, width: 64, height: 48).fill()
        NSColor.white.setFill()
        NSBezierPath(ovalIn: NSRect(x: 20, y: 12, width: 24, height: 24)).fill()
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .jpeg, properties: [.compressionFactor: 0.9])
    }
}
