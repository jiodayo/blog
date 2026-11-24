//
//  ブログ.app — エディタを独立したアプリとして開く
//
//  中身は tools/editor のエディタそのもので、表示先がブラウザのタブから
//  アプリのウィンドウに変わるだけ。アプリが node のサーバーを起動して、
//  終了するときに一緒に止める。
//
//  ビルド: tools/mac-app/build.sh
//

import AppKit
import WebKit

// ------------------------------------------------------------------ 設定

let EDITOR_PORT = 4322
let EDITOR_URL = URL(string: "http://127.0.0.1:\(EDITOR_PORT)")!

/// node を探す場所。アプリから起動すると PATH に ~/.zprofile などが
/// 反映されないので、よくある場所を自前で見にいく。
let NODE_CANDIDATES = [
	"/usr/local/bin/node",
	"/opt/homebrew/bin/node",
	"/usr/bin/node",
]

// -------------------------------------------------------------- 置き場所

/// ブログのフォルダ（tools/editor/server.mjs があるところ）を探す。
func findProjectRoot() -> String? {
	let fm = FileManager.default
	let looksRight = { (dir: String) -> Bool in
		fm.fileExists(atPath: dir + "/tools/editor/server.mjs")
	}

	// 1. ふつうは .app がブログのフォルダに置いてある
	let beside = (Bundle.main.bundlePath as NSString).deletingLastPathComponent
	if looksRight(beside) { return beside }

	// 2. アプリを別の場所へ移したとき用に、ビルドしたときのパスを控えてある
	if let saved = Bundle.main.object(forInfoDictionaryKey: "BlogProjectPath") as? String,
		looksRight(saved)
	{
		return saved
	}
	return nil
}

func findNode() -> String? {
	let fm = FileManager.default
	for path in NODE_CANDIDATES where fm.isExecutableFile(atPath: path) {
		return path
	}
	// それでも見つからなければ、ログインシェルに聞く
	let p = Process()
	p.executableURL = URL(fileURLWithPath: "/bin/zsh")
	p.arguments = ["-lc", "command -v node"]
	let pipe = Pipe()
	p.standardOutput = pipe
	p.standardError = FileHandle.nullDevice
	guard (try? p.run()) != nil else { return nil }
	let data = pipe.fileHandleForReading.readDataToEndOfFile()
	p.waitUntilExit()
	let found = String(data: data, encoding: .utf8)?
		.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
	return found.isEmpty ? nil : found
}

// -------------------------------------------------------------- サーバー

/// エディタの node プロセスを抱える。
/// すでに誰か（`ブログを書く.command` など）が動かしているときは、
/// 二重に起動せずそちらへつなぐ。
final class EditorServer {
	private var process: Process?
	private var log = ""
	private let logLock = NSLock()

	var output: String {
		logLock.lock()
		defer { logLock.unlock() }
		return log
	}

	/// 起動する。すでに誰かが使っていれば何もしない。
	/// 立ち上げられなかったときは理由を返す。
	func start(root: String) -> String? {
		if isPortOpen() { return nil } // 先に誰かが動かしている

		guard let node = findNode() else {
			return """
				Node.js が見つかりませんでした。

				https://nodejs.org からインストールしたあと、
				もう一度このアプリを開いてください。
				"""
		}

		let p = Process()
		p.executableURL = URL(fileURLWithPath: node)
		p.arguments = [root + "/tools/editor/server.mjs"]
		p.currentDirectoryURL = URL(fileURLWithPath: root)

		var env = ProcessInfo.processInfo.environment
		let extra = "/usr/local/bin:/opt/homebrew/bin"
		env["PATH"] = extra + ":" + (env["PATH"] ?? "/usr/bin:/bin")
		// アプリが強制終了されると stop() が走らない。そのときのために、
		// サーバー側からもこちらの生死を見てもらう。
		env["BLOG_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
		p.environment = env

		// 起動に失敗したときに理由を出せるよう、出力を控えておく
		let pipe = Pipe()
		p.standardOutput = pipe
		p.standardError = pipe
		pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
			let data = handle.availableData
			guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
			self?.logLock.lock()
			self?.log += text
			self?.logLock.unlock()
		}

		do {
			try p.run()
		} catch {
			return "エディタを起動できませんでした: \(error.localizedDescription)"
		}
		process = p
		return nil
	}

	func stop() {
		guard let p = process, p.isRunning else { return }
		p.terminate()
		// 落ちきるのを少しだけ待つ。待たずに終わると node が残ることがある。
		let deadline = Date().addingTimeInterval(2)
		while p.isRunning && Date() < deadline {
			usleep(50_000)
		}
		if p.isRunning { kill(p.processIdentifier, SIGKILL) }
		process = nil
	}

	/// ポートが開いているか。HTTP を投げずに済むので待ち合わせに向く。
	private func isPortOpen() -> Bool {
		let sock = socket(AF_INET, SOCK_STREAM, 0)
		if sock < 0 { return false }
		defer { close(sock) }
		var addr = sockaddr_in()
		addr.sin_family = sa_family_t(AF_INET)
		addr.sin_port = in_port_t(UInt16(EDITOR_PORT).bigEndian)
		addr.sin_addr.s_addr = inet_addr("127.0.0.1")
		let ok = withUnsafePointer(to: &addr) {
			$0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
				connect(sock, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
			}
		}
		return ok
	}

	/// 応答が返るまで待つ。戻るのはメインスレッド。
	func waitUntilReady(timeout: TimeInterval, done: @escaping (Bool) -> Void) {
		DispatchQueue.global().async {
			let deadline = Date().addingTimeInterval(timeout)
			while Date() < deadline {
				if self.isPortOpen() {
					DispatchQueue.main.async { done(true) }
					return
				}
				usleep(200_000)
			}
			DispatchQueue.main.async { done(false) }
		}
	}
}

// ------------------------------------------------------------ 読み込み中

/// サーバーが立ち上がるまでの表示。失敗したときは理由をここに出す。
final class StatusView: NSView {
	private let label = NSTextField(labelWithString: "エディタを起動しています…")
	private let detail = NSTextView()
	private let spinner = NSProgressIndicator()
	private let scroll = NSScrollView()

	override init(frame: NSRect) {
		super.init(frame: frame)
		wantsLayer = true

		label.font = .systemFont(ofSize: 15, weight: .medium)
		label.alignment = .center
		label.translatesAutoresizingMaskIntoConstraints = false
		addSubview(label)

		spinner.style = .spinning
		spinner.controlSize = .small
		spinner.translatesAutoresizingMaskIntoConstraints = false
		spinner.startAnimation(nil)
		addSubview(spinner)

		detail.isEditable = false
		detail.drawsBackground = false
		detail.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
		detail.textContainerInset = NSSize(width: 8, height: 8)
		scroll.documentView = detail
		scroll.hasVerticalScroller = true
		scroll.drawsBackground = false
		scroll.isHidden = true
		scroll.translatesAutoresizingMaskIntoConstraints = false
		addSubview(scroll)

		NSLayoutConstraint.activate([
			label.centerXAnchor.constraint(equalTo: centerXAnchor),
			label.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -40),
			spinner.centerXAnchor.constraint(equalTo: centerXAnchor),
			spinner.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 14),
			scroll.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 18),
			scroll.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 40),
			scroll.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -40),
			scroll.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -40),
		])
	}

	required init?(coder: NSCoder) { fatalError() }

	func showError(_ message: String, log: String) {
		spinner.stopAnimation(nil)
		spinner.isHidden = true
		label.stringValue = message.components(separatedBy: "\n").first ?? message
		let rest = message.components(separatedBy: "\n").dropFirst().joined(separator: "\n")
		let body = [rest, log].filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
			.joined(separator: "\n")
		detail.string = body
		scroll.isHidden = body.isEmpty
	}
}

// ------------------------------------------------------------------ 本体

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
	private var window: NSWindow!
	private var webView: WKWebView!
	private var status: StatusView!
	private let server = EditorServer()

	func applicationDidFinishLaunching(_ note: Notification) {
		buildMenu()
		buildWindow()

		guard let root = findProjectRoot() else {
			status.showError(
				"""
				ブログのフォルダが見つかりませんでした。

				このアプリは「ブログ関係」フォルダの中に置いて使ってください。
				別の場所から使いたいときは tools/mac-app/build.sh で作り直すと、
				そのときのフォルダを覚えます。
				""", log: "")
			return
		}

		if let problem = server.start(root: root) {
			status.showError(problem, log: server.output)
			return
		}

		server.waitUntilReady(timeout: 30) { [weak self] ok in
			guard let self = self else { return }
			if ok {
				self.webView.isHidden = false
				self.status.isHidden = true
				self.webView.load(URLRequest(url: EDITOR_URL))
			} else {
				self.status.showError(
					"エディタが応答しませんでした。\n下のログを見てください。",
					log: self.server.output)
			}
		}
	}

	func applicationWillTerminate(_ note: Notification) {
		server.stop()
	}

	/// ウィンドウを閉じたらアプリも終わる。書くためだけのアプリなので、
	/// 閉じたのに Dock に残り続けるほうが戸惑う。
	func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool {
		return true
	}

	// ------------------------------------------------------------ 画面

	private func buildWindow() {
		let frame = NSRect(x: 0, y: 0, width: 1280, height: 820)
		window = NSWindow(
			contentRect: frame,
			styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
			backing: .buffered, defer: false)
		window.title = "ブログ"
		window.titlebarAppearsTransparent = false
		window.minSize = NSSize(width: 900, height: 560)
		window.setFrameAutosaveName("BlogEditorWindow")
		window.center()

		let container = NSView(frame: frame)

		status = StatusView(frame: frame)
		status.autoresizingMask = [.width, .height]
		container.addSubview(status)

		let config = WKWebViewConfiguration()
		// エディタはこの Mac の中だけで動くので、保存したものを消す必要はない。
		// localStorage に「設定をたたんでいるか」などを覚えさせている。
		config.websiteDataStore = .default()
		webView = WKWebView(frame: frame, configuration: config)
		webView.autoresizingMask = [.width, .height]
		webView.navigationDelegate = self
		webView.uiDelegate = self
		webView.isHidden = true
		if webView.responds(to: Selector(("setAllowsBackForwardNavigationGestures:"))) {
			webView.allowsBackForwardNavigationGestures = false
		}
		container.addSubview(webView)

		window.contentView = container
		window.makeKeyAndOrderFront(nil)
		NSApp.activate(ignoringOtherApps: true)
	}

	// --------------------------------------------------------- リンク

	/// 記事から外のサイトへのリンクは、アプリの中ではなく既定のブラウザで開く。
	/// アプリの中で開くと、戻る手段がないまま迷子になる。
	func webView(
		_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
		decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
	) {
		guard let url = action.request.url else {
			decisionHandler(.allow)
			return
		}
		let isLocal = url.host == "127.0.0.1" || url.host == "localhost"
		if isLocal {
			decisionHandler(.allow)
			return
		}
		// 画像をウィンドウに落としたときに file:// へ飛ぶのも止める
		if url.isFileURL {
			decisionHandler(.cancel)
			return
		}
		NSWorkspace.shared.open(url)
		decisionHandler(.cancel)
	}

	/// target="_blank"（「公開中のページを開く」など）も外のブラウザへ回す
	func webView(
		_ webView: WKWebView, createWebViewWith config: WKWebViewConfiguration,
		for action: WKNavigationAction, windowFeatures: WKWindowFeatures
	) -> WKWebView? {
		if let url = action.request.url { NSWorkspace.shared.open(url) }
		return nil
	}

	/// エディタは alert / confirm を使う（削除の確認など）ので、
	/// それをアプリのダイアログとして出す。これが無いと黙って無視される。
	func webView(
		_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
		initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void
	) {
		let alert = NSAlert()
		alert.messageText = message
		alert.addButton(withTitle: "OK")
		alert.beginSheetModal(for: window) { _ in completionHandler() }
	}

	func webView(
		_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
		initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void
	) {
		let alert = NSAlert()
		alert.messageText = message
		alert.addButton(withTitle: "OK")
		alert.addButton(withTitle: "キャンセル")
		alert.beginSheetModal(for: window) { r in
			completionHandler(r == .alertFirstButtonReturn)
		}
	}

	func webView(
		_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
		defaultText: String?, initiatedByFrame frame: WKFrameInfo,
		completionHandler: @escaping (String?) -> Void
	) {
		let alert = NSAlert()
		alert.messageText = prompt
		let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
		field.stringValue = defaultText ?? ""
		alert.accessoryView = field
		alert.addButton(withTitle: "OK")
		alert.addButton(withTitle: "キャンセル")
		alert.beginSheetModal(for: window) { r in
			completionHandler(r == .alertFirstButtonReturn ? field.stringValue : nil)
		}
		field.becomeFirstResponder()
	}

	/// 「画像を選ぶ」のファイル選択
	func webView(
		_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
		initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void
	) {
		let panel = NSOpenPanel()
		panel.canChooseFiles = true
		panel.canChooseDirectories = false
		panel.allowsMultipleSelection = parameters.allowsMultipleSelection
		panel.beginSheetModal(for: window) { r in
			completionHandler(r == .OK ? panel.urls : nil)
		}
	}

	// ----------------------------------------------------------- メニュー

	/// ⌘Z / ⌘C / ⌘V は、メニューに項目があって初めて効く。
	/// WKWebView まかせでは取り消しが動かないので、自分で組む。
	private func buildMenu() {
		let main = NSMenu()

		let appItem = NSMenuItem()
		let appMenu = NSMenu()
		appMenu.addItem(
			withTitle: "ブログについて", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
			keyEquivalent: "")
		appMenu.addItem(.separator())
		appMenu.addItem(
			withTitle: "ブログを隠す", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
		appMenu.addItem(
			withTitle: "ブログを終了", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
		appItem.submenu = appMenu
		main.addItem(appItem)

		let editItem = NSMenuItem()
		let edit = NSMenu(title: "編集")
		edit.addItem(withTitle: "取り消す", action: Selector(("undo:")), keyEquivalent: "z")
		let redo = NSMenuItem(
			title: "やり直す", action: Selector(("redo:")), keyEquivalent: "Z")
		redo.keyEquivalentModifierMask = [.command, .shift]
		edit.addItem(redo)
		edit.addItem(.separator())
		edit.addItem(withTitle: "カット", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
		edit.addItem(withTitle: "コピー", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
		edit.addItem(withTitle: "ペースト", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
		edit.addItem(
			withTitle: "すべてを選択", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
		editItem.submenu = edit
		main.addItem(editItem)

		let viewItem = NSMenuItem()
		let view = NSMenu(title: "表示")
		view.addItem(withTitle: "再読み込み", action: #selector(reloadEditor), keyEquivalent: "r")
		let zoomIn = NSMenuItem(title: "文字を大きく", action: #selector(zoomIn), keyEquivalent: "+")
		let zoomOut = NSMenuItem(title: "文字を小さく", action: #selector(zoomOut), keyEquivalent: "-")
		let zoomReset = NSMenuItem(title: "文字の大きさを戻す", action: #selector(zoomReset), keyEquivalent: "0")
		for item in [zoomIn, zoomOut, zoomReset] {
			item.target = self
			view.addItem(item)
		}
		view.addItem(.separator())
		view.addItem(
			withTitle: "フルスクリーン", action: #selector(NSWindow.toggleFullScreen(_:)),
			keyEquivalent: "f"
		).keyEquivalentModifierMask = [.command, .control]
		viewItem.submenu = view
		main.addItem(viewItem)

		let windowItem = NSMenuItem()
		let windowMenu = NSMenu(title: "ウィンドウ")
		windowMenu.addItem(
			withTitle: "しまう", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
		windowMenu.addItem(
			withTitle: "閉じる", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
		windowItem.submenu = windowMenu
		main.addItem(windowItem)

		NSApp.mainMenu = main
		NSApp.windowsMenu = windowMenu
		// 再読み込みは自分で受ける
		view.items.first?.target = self
	}

	@objc private func reloadEditor() {
		webView.reload()
	}

	private var zoom: CGFloat = 1.0
	private func applyZoom() {
		webView.evaluateJavaScript(
			"document.documentElement.style.zoom='\(zoom)'", completionHandler: nil)
	}
	@objc private func zoomIn() {
		zoom = min(zoom + 0.1, 2.0)
		applyZoom()
	}
	@objc private func zoomOut() {
		zoom = max(zoom - 0.1, 0.6)
		applyZoom()
	}
	@objc private func zoomReset() {
		zoom = 1.0
		applyZoom()
	}
}

// ------------------------------------------------------------------ 起動

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
