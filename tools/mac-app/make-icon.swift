//
//  アプリのアイコンを描いて .iconset に書き出す。
//  画像ファイルを持ち回らずに済むよう、絵も含めてコードにしてある。
//
//  使い方: swiftc -O -o make-icon make-icon.swift && ./make-icon <出力先の .iconset>
//  （swift で直に走らせると引数に swift 自身のものが混ざる。build.sh を参照）
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

// MARK: - 色

func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> NSColor {
	NSColor(calibratedRed: r, green: g, blue: b, alpha: a)
}

let inkTop = rgb(0.40, 0.45, 0.99)  // 下地の上側
let inkMid = rgb(0.30, 0.31, 0.88)
let inkBottom = rgb(0.16, 0.15, 0.56)  // 下地の下側
let accent = rgb(0.29, 0.34, 0.96)  // 見出しの線
let bodyLine = rgb(0.52, 0.56, 0.70)  // 本文の線
let pencilBody = rgb(0.98, 0.76, 0.33)  // 鉛筆の軸
let pencilDark = rgb(0.90, 0.60, 0.18)
let pencilWood = rgb(0.99, 0.90, 0.74)  // 削った木の部分
let pencilLead = rgb(0.22, 0.24, 0.33)

// MARK: - 形

/// macOS のアイコンの角丸は、ただの円弧ではなく曲率がなめらかに変わる形
/// （squircle）。超楕円を細かく刻んで近づける。
func squircle(in rect: NSRect) -> NSBezierPath {
	let path = NSBezierPath()
	let a = rect.width / 2
	let b = rect.height / 2
	let n: CGFloat = 5
	let steps = 512
	for i in 0...steps {
		let t = CGFloat(i) / CGFloat(steps) * 2 * CGFloat.pi
		let ct = cos(t)
		let st = sin(t)
		let x = rect.midX + a * (ct < 0 ? -1 : 1) * pow(abs(ct), 2 / n)
		let y = rect.midY + b * (st < 0 ? -1 : 1) * pow(abs(st), 2 / n)
		if i == 0 { path.move(to: NSPoint(x: x, y: y)) } else { path.line(to: NSPoint(x: x, y: y)) }
	}
	path.close()
	return path
}

func withShadow(_ color: NSColor, blur: CGFloat, dy: CGFloat, _ draw: () -> Void) {
	NSGraphicsContext.saveGraphicsState()
	let shadow = NSShadow()
	shadow.shadowColor = color
	shadow.shadowBlurRadius = blur
	shadow.shadowOffset = NSSize(width: 0, height: dy)
	shadow.set()
	draw()
	NSGraphicsContext.restoreGraphicsState()
}

/// 鉛筆を一本。原点が芯の先で、上に向かって伸びる形で描いてから回す。
func drawPencil(length: CGFloat, width w: CGFloat, at point: NSPoint, degrees: CGFloat) {
	NSGraphicsContext.saveGraphicsState()
	let xf = NSAffineTransform()
	xf.translateX(by: point.x, yBy: point.y)
	xf.rotate(byDegrees: degrees)
	xf.concat()

	let leadLen = w * 0.55
	let woodLen = w * 1.15

	// 軸。先端側だけ角を落とさず、後ろは丸める
	let body = NSBezierPath(
		roundedRect: NSRect(x: -w / 2, y: woodLen, width: w, height: length - woodLen),
		xRadius: w * 0.42, yRadius: w * 0.42)
	pencilBody.setFill()
	body.fill()

	// 軸の片側に影を入れて丸みを出す
	let shade = NSBezierPath(
		roundedRect: NSRect(
			x: w * 0.06, y: woodLen, width: w * 0.44, height: length - woodLen),
		xRadius: w * 0.22, yRadius: w * 0.22)
	pencilDark.setFill()
	shade.fill()

	// 削った木の部分
	let wood = NSBezierPath()
	wood.move(to: NSPoint(x: 0, y: 0))
	wood.line(to: NSPoint(x: -w / 2, y: woodLen))
	wood.line(to: NSPoint(x: w / 2, y: woodLen))
	wood.close()
	pencilWood.setFill()
	wood.fill()

	// 芯
	let lead = NSBezierPath()
	lead.move(to: NSPoint(x: 0, y: 0))
	lead.line(to: NSPoint(x: -w * 0.28, y: leadLen))
	lead.line(to: NSPoint(x: w * 0.28, y: leadLen))
	lead.close()
	pencilLead.setFill()
	lead.fill()

	NSGraphicsContext.restoreGraphicsState()
}

// MARK: - アイコン本体

/// 小さく表示されるときは、線も鉛筆も潰れて汚くなるだけなので省く。
/// Finder のリスト表示（16px）とアイコン表示（512px）で別の絵にしている。
func drawIcon(size: CGFloat) -> NSBitmapImageRep {
	let px = Int(size)
	let rep = NSBitmapImageRep(
		bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px,
		bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
		colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
	NSGraphicsContext.saveGraphicsState()
	NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
	NSGraphicsContext.current?.imageInterpolation = .high

	let s = size
	let detailed = size >= 64

	// 下地。macOS の作法にならって、縁いっぱいには広げず影の余地を残す
	let inset = s * 0.098
	let rect = NSRect(x: inset, y: inset * 1.18, width: s - inset * 2, height: s - inset * 2)
	let L = rect.width
	let shape = squircle(in: rect)

	withShadow(NSColor.black.withAlphaComponent(0.26), blur: s * 0.035, dy: -s * 0.018) {
		NSColor.black.setFill()
		shape.fill()
	}

	let gradient = NSGradient(
		colors: [inkTop, inkMid, inkBottom],
		atLocations: [0, 0.52, 1],
		colorSpace: .deviceRGB)!
	gradient.draw(in: shape, angle: -90)

	// 上からの光。下地の中だけに乗せる
	NSGraphicsContext.saveGraphicsState()
	shape.addClip()
	let sheen = NSGradient(
		colors: [
			NSColor.white.withAlphaComponent(0.26),
			NSColor.white.withAlphaComponent(0.0),
		])!
	sheen.draw(
		in: NSRect(x: rect.minX, y: rect.midY, width: L, height: rect.height / 2), angle: -90)
	NSGraphicsContext.restoreGraphicsState()

	// 縁のふち取り。輪郭をはっきりさせる
	NSColor.white.withAlphaComponent(0.22).setStroke()
	shape.lineWidth = max(1, s * 0.005)
	shape.stroke()

	// 紙
	let paperW = L * (detailed ? 0.50 : 0.46)
	let paperH = paperW * (detailed ? 1.26 : 1.20)
	let paper = NSRect(
		x: rect.minX + L * (detailed ? 0.21 : 0.27),
		y: rect.midY - paperH / 2 + L * (detailed ? 0.03 : 0),
		width: paperW, height: paperH)
	let paperPath = NSBezierPath(
		roundedRect: paper, xRadius: L * 0.035, yRadius: L * 0.035)
	withShadow(NSColor.black.withAlphaComponent(0.30), blur: L * 0.05, dy: -L * 0.015) {
		NSColor.white.setFill()
		paperPath.fill()
	}
	// 紙にもわずかに陰をつけて、まっ白に見えないようにする
	NSGraphicsContext.saveGraphicsState()
	paperPath.addClip()
	NSGradient(colors: [NSColor.white, rgb(0.93, 0.94, 0.97)])!.draw(in: paper, angle: -70)
	NSGraphicsContext.restoreGraphicsState()

	// 書かれた行
	let left = paper.minX + paperW * 0.15
	let usable = paperW * 0.70
	if detailed {
		// 見出しを一本、本文を三本
		let headH = paperH * 0.072
		accent.setFill()
		NSBezierPath(
			roundedRect: NSRect(
				x: left, y: paper.maxY - paperH * 0.20 - headH,
				width: usable * 0.72, height: headH),
			xRadius: headH / 2, yRadius: headH / 2
		).fill()

		let lineH = paperH * 0.050
		bodyLine.withAlphaComponent(0.60).setFill()
		for (i, w) in [CGFloat(1.0), 1.0, 0.62].enumerated() {
			let y = paper.maxY - paperH * (0.38 + CGFloat(i) * 0.15) - lineH
			NSBezierPath(
				roundedRect: NSRect(x: left, y: y, width: usable * w, height: lineH),
				xRadius: lineH / 2, yRadius: lineH / 2
			).fill()
		}
	} else {
		// 16px / 32px。太い線を二本だけ
		let lineH = paperH * 0.105
		accent.setFill()
		NSBezierPath(
			roundedRect: NSRect(
				x: left, y: paper.maxY - paperH * 0.24 - lineH,
				width: usable, height: lineH),
			xRadius: lineH / 2, yRadius: lineH / 2
		).fill()
		bodyLine.withAlphaComponent(0.70).setFill()
		NSBezierPath(
			roundedRect: NSRect(
				x: left, y: paper.maxY - paperH * 0.52 - lineH,
				width: usable * 0.60, height: lineH),
			xRadius: lineH / 2, yRadius: lineH / 2
		).fill()
	}

	// 鉛筆。紙の右下に重ねて、書いている最中に見えるように
	if detailed {
		withShadow(NSColor.black.withAlphaComponent(0.28), blur: L * 0.04, dy: -L * 0.012) {
			drawPencil(
				length: L * 0.52, width: L * 0.105,
				at: NSPoint(x: rect.minX + L * 0.56, y: rect.minY + L * 0.17),
				degrees: -28)
		}
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
