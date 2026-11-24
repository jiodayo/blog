#!/bin/bash
#
# ブログ.app を組み立てる。
#
#   bash tools/mac-app/build.sh
#
# 出来上がった ブログ.app はブログのフォルダの直下に置かれる。
# 必要なのは Xcode Command Line Tools だけ（swiftc / iconutil）。
# ダウンロードするものは何も無い。
#
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
APP="$ROOT/ブログ.app"
NAME="ブログ"

if ! command -v swiftc > /dev/null 2>&1; then
	echo "swiftc が見つかりません。"
	echo "ターミナルで xcode-select --install を実行してから、もう一度お試しください。"
	exit 1
fi

echo "== 組み立て先を用意 =="
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "== アイコンを描く =="
# swift で直に走らせると、スクリプトが受け取る引数に swift 自身のものが
# 混ざる（この toolchain の挙動）。先にコンパイルしてから実行する。
WORK="$(mktemp -d)"
ICONSET="$WORK/Blog.iconset"
swiftc -O -o "$WORK/make-icon" "$HERE/make-icon.swift"
"$WORK/make-icon" "$ICONSET" > /dev/null
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$WORK"

echo "== Info.plist を書く =="
# BlogProjectPath は、アプリを別の場所へ移したときの手がかり。
# ふだんは .app の隣のフォルダを見にいくので使われない。
cat > "$APP/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>${NAME}</string>
	<key>CFBundleDisplayName</key>
	<string>${NAME}</string>
	<key>CFBundleExecutable</key>
	<string>${NAME}</string>
	<key>CFBundleIdentifier</key>
	<string>jiodayo.blog.editor</string>
	<key>CFBundleIconFile</key>
	<string>AppIcon</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>LSMinimumSystemVersion</key>
	<string>11.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSSupportsAutomaticTermination</key>
	<false/>
	<key>BlogProjectPath</key>
	<string>${ROOT}</string>
</dict>
</plist>
PLIST

echo "== ビルド =="
swiftc -O \
	-target "$(uname -m)-apple-macosx11.0" \
	-o "$APP/Contents/MacOS/${NAME}" \
	"$HERE/main.swift"

# Finder にアイコンの差し替えを気づかせる
touch "$APP"

echo ""
echo "できました: $APP"
echo "Finder からダブルクリックで開けます。Dock に入れておくと楽です。"
