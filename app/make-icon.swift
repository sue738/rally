#!/usr/bin/env swift
// Draws AppIcon.iconset in code: a white face with two drawn-out corners and a prompt's >, on the brand blue.
// usage: swift make-icon.swift [ROOT]   (writes AppIcon.iconset here and, with ROOT, the same art where
// else it is shown: ROOT/docs/icon.png for the site)
import AppKit

func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255, alpha: a)
}

// Renders px×px exactly (no lockFocus: that follows the screen's backing scale).
// macOS icon grid: 824 tile on a 1024 canvas.
func render(_ px: Int, top: NSColor, bottom: NSColor, edge: NSColor,
            art: (_ s: CGFloat, _ r: (CGFloat, CGFloat, CGFloat, CGFloat) -> NSRect, _ small: Bool) -> Void) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        .retagging(with: .sRGB)!
    rep.size = NSSize(width: px, height: px)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let s = CGFloat(px) / 1024
    func r(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> NSRect {
        NSRect(x: x * s, y: (1024 - y - h) * s, width: w * s, height: h * s)
    }
    let tile = r(100, 100, 824, 824)
    let tilePath = NSBezierPath(roundedRect: tile, xRadius: 185 * s, yRadius: 185 * s)
    NSGraphicsContext.saveGraphicsState()
    let sh = NSShadow()
    sh.shadowColor = NSColor.black.withAlphaComponent(0.35)
    sh.shadowBlurRadius = 20 * s
    sh.shadowOffset = NSSize(width: 0, height: -10 * s)
    sh.set()
    bottom.setFill(); tilePath.fill()
    NSGraphicsContext.restoreGraphicsState()
    NSGraphicsContext.saveGraphicsState()
    tilePath.addClip()
    NSGradient(starting: top, ending: bottom)?.draw(in: tile, angle: -90)
    art(s, r, px <= 32)
    NSGraphicsContext.restoreGraphicsState()
    edge.setStroke()
    let e = NSBezierPath(roundedRect: tile.insetBy(dx: 1 * s, dy: 1 * s), xRadius: 184 * s, yRadius: 184 * s)
    e.lineWidth = max(1, 2 * s); e.stroke()
    NSGraphicsContext.restoreGraphicsState()
    return rep
}

func drop(_ blur: CGFloat, _ dy: CGFloat, _ a: CGFloat, _ s: CGFloat, _ color: NSColor = .black, _ body: () -> Void) {
    NSGraphicsContext.saveGraphicsState()
    let sh = NSShadow()
    sh.shadowColor = color.withAlphaComponent(a); sh.shadowBlurRadius = blur * s; sh.shadowOffset = NSSize(width: 0, height: -dy * s)
    sh.set(); body()
    NSGraphicsContext.restoreGraphicsState()
}
func fillGrad(_ p: NSBezierPath, _ a: NSColor, _ b: NSColor) { NSGradient(starting: a, ending: b)?.draw(in: p, angle: -90) }

let artA: (CGFloat, (CGFloat, CGFloat, CGFloat, CGFloat) -> NSRect, Bool) -> Void = { s, r, small in
    // a white tile with two opposite corners drawn out: this side's bubble tail and the other's, one face; a prompt's > on it
    func p(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: x * s, y: (1024 - y) * s) }
    let face = NSBezierPath()
    face.move(to: p(600, 270))
    face.appendArc(from: p(794, 270), to: p(794, 754), radius: 50 * s)
    face.appendArc(from: p(794, 754), to: p(230, 754), radius: 170 * s)
    face.appendArc(from: p(230, 754), to: p(230, 270), radius: 50 * s)
    face.appendArc(from: p(230, 270), to: p(794, 270), radius: 170 * s)
    face.close()
    NSGradient(starting: rgb(0xffffff), ending: rgb(0xe3ebff))?.draw(in: face, angle: -90)
    let gt = NSBezierPath(); gt.move(to: p(448, 414)); gt.line(to: p(582, 512)); gt.line(to: p(448, 610))
    gt.lineWidth = 84 * s; gt.lineCapStyle = .round; gt.lineJoinStyle = .round; rgb(0x2e5fd0).setStroke(); gt.stroke()
}

let fm = FileManager.default
let out = "AppIcon.iconset"
try? fm.removeItem(atPath: out)
try! fm.createDirectory(atPath: out, withIntermediateDirectories: true)

// the names and sizes iconutil expects
let sizes: [(Int, String)] = [
    (16, "icon_16x16"), (32, "icon_16x16@2x"),
    (32, "icon_32x32"), (64, "icon_32x32@2x"),
    (128, "icon_128x128"), (256, "icon_128x128@2x"),
    (256, "icon_256x256"), (512, "icon_256x256@2x"),
    (512, "icon_512x512"), (1024, "icon_512x512@2x"),
]
for (px, name) in sizes {
    guard let d = render(px, top: rgb(0x4a7cf0), bottom: rgb(0x2148b0), edge: rgb(0xffffff, 0.22), art: artA).representation(using: .png, properties: [:]) else { continue }
    try! d.write(to: URL(fileURLWithPath: "\(out)/\(name).png"))
}
// one drawing for every place the icon appears
if CommandLine.arguments.count > 1 {
    let root = CommandLine.arguments[1]
    for (px, path) in [(256, "docs/icon.png")] {
        guard let d = render(px, top: rgb(0x4a7cf0), bottom: rgb(0x2148b0), edge: rgb(0xffffff, 0.22), art: artA).representation(using: .png, properties: [:]) else { continue }
        try! d.write(to: URL(fileURLWithPath: "\(root)/\(path)"))
    }
}
FileHandle.standardError.write("wrote \(out) (\(sizes.count) sizes)\n".data(using: .utf8)!)
