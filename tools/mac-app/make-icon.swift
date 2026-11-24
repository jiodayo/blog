//
//  アプリのアイコンを描いて .iconset に書き出す。
//  画像ファイルを持ち回らずに済むよう、絵も含めてコードにしてある。
//
//  使い方: swift make-icon.swift <出力先の .iconset フォルダ>
//

import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count >= 2 else {
	FileHandle.standardError.write("出力先を指定してください\n".data(using: .utf8)!)
	exit(1)
}
let outDir = args[1]
try? FileManager.default.createDirectory(
	atPath: outDir, withIntermediateDirectories: true, attributes: nil)

/// 角丸の下地に、紙に書かれた行を three 本。小さくしても形が潰れないよう、
/// 線は太めで本数を絞っている。
func drawIcon(size: CGFloat) -> NSBitmapImageRep {
	let rep = NSBitmapImageRep(
		bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
		bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
		colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
	NSGraphicsContext.saveGraphicsState()
	NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

	let s = size
	let inset = s * 0.06
	let rect = NSRect(x: inset, y: inset, width: s - inset * 2, height: s - inset * 2)

	// 下地。少し紫寄りの紺にして、上から下へ明るさを落とす
	let bg = NSBezierPath(roundedRect: rect, xRadius: s * 0.22, yRadius: s * 0.22)
	let gradient = NSGradient(
		colors: [
			NSColor(calibratedRed: 0.22, green: 0.26, blue: 0.95, alpha: 1),
			NSColor(calibratedRed: 0.11, green: 0.13, blue: 0.55, alpha: 1),
		])!
	gradient.draw(in: bg, angle: -90)

	// 紙
	let paperW = rect.width * 0.52
	let paperH = rect.height * 0.62
	let paper = NSRect(
		x: rect.midX - paperW / 2,
		y: rect.midY - paperH / 2 - rect.height * 0.02,
		width: paperW, height: paperH)
	NSColor.white.setFill()
	NSBezierPath(roundedRect: paper, xRadius: s * 0.03, yRadius: s * 0.03).fill()

	// 書かれた行。上から順に少しずつ短くする
	let lineColor = NSColor(calibratedRed: 0.22, green: 0.26, blue: 0.95, alpha: 1)
	lineColor.setFill()
	let lineH = paperH * 0.085
	let widths: [CGFloat] = [0.70, 0.70, 0.45]
	for (i, w) in widths.enumerated() {
		let y = paper.maxY - paperH * (0.24 + CGFloat(i) * 0.22) - lineH
		let r = NSRect(
			x: paper.minX + paperW * 0.15, y: y, width: paperW * w, height: lineH)
		NSBezierPath(roundedRect: r, xRadius: lineH / 2, yRadius: lineH / 2).fill()
	}

	NSGraphicsContext.restoreGraphicsState()
	return rep
}

/// .iconset に要る名前と大きさの組
let wanted: [(String, CGFloat)] = [
	("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
	("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
	("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
	("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
	("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
]

for (name, size) in wanted {
	let rep = drawIcon(size: size)
	guard let data = rep.representation(using: .png, properties: [:]) else { continue }
	try? data.write(to: URL(fileURLWithPath: outDir + "/" + name))
}
print("アイコンを書き出しました: \(outDir)")
