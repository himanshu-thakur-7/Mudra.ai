import Foundation
import PDFKit
import AppKit

let path = CommandLine.arguments[1]
let outDir = CommandLine.arguments[2]
guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else {
    print("ERROR: could not open PDF"); exit(1)
}
for i in 0..<doc.pageCount {
    guard let page = doc.page(at: i) else { continue }
    let bounds = page.bounds(for: .mediaBox)
    print("page \(i+1): \(bounds.width) x \(bounds.height)")
    let scale: CGFloat = 2.0
    let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
    let img = NSImage(size: size)
    img.lockFocus()
    NSColor.white.setFill()
    NSRect(origin: .zero, size: size).fill()
    let ctx = NSGraphicsContext.current!.cgContext
    ctx.saveGState()
    ctx.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: ctx)
    ctx.restoreGState()
    img.unlockFocus()
    guard let tiff = img.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { continue }
    try! png.write(to: URL(fileURLWithPath: "\(outDir)/page\(i+1).png"))
}
print("done")
