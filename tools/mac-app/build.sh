#!/bin/bash
#
# ブログ.app を組み立てて、アプリケーションフォルダに入れる。
#
#   bash tools/mac-app/build.sh              → /Applications へ
#   bash tools/mac-app/build.sh ~/Applications  → 置き場所を指定する
#
# アプリケーションフォルダに入れておくと、Launchpad や Spotlight、
# Finder の「アプリケーション」に出てくる。ブログのフォルダの中に置くと
# どこにあるか分からなくなるので、既定ではそちらには残さない。
#
# 必要なのは Xcode Command Line Tools だけ（swiftc / iconutil）。
# ダウンロードするものは何も無い。
#
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
NAME="ブログ"

if ! command -v swiftc > /dev/null 2>&1; then
	echo "swiftc が見つかりません。"
	echo "ターミナルで xcode-select --install を実行してから、もう一度お試しください。"
	exit 1
fi

# 置き場所を決める。書けないときは自分のホームのほうへ。
DEST="${1:-/Applications}"
DEST="$(cd "$DEST" 2> /dev/null && pwd || echo "$DEST")"
if [ ! -d "$DEST" ] || [ ! -w "$DEST" ]; then
	echo "$DEST には置けないので、~/Applications にします。"
	DEST="$HOME/Applications"
	mkdir -p "$DEST"
fi
APP="$DEST/${NAME}.app"

# 起動したままだと、中身を入れ替えた拍子にアプリが落ちる
if pgrep -x "$NAME" > /dev/null 2>&1; then
	echo "${NAME} が起動しています。終了してから、もう一度お試しください。"
	exit 1
fi

echo "== 組み立て先を用意 =="
# 出来上がってから一気に入れ替える。途中で失敗しても、いまのアプリは無事。
STAGE="$(mktemp -d)"
BUILD="$STAGE/${NAME}.app"
mkdir -p "$BUILD/Contents/MacOS" "$BUILD/Contents/Resources"

echo "== アイコンを描く =="
# swift で直に走らせると、スクリプトが受け取る引数に swift 自身のものが
# 混ざる（この toolchain の挙動）。先にコンパイルしてから実行する。
ICONSET="$STAGE/Blog.iconset"
swiftc -O -o "$STAGE/make-icon" "$HERE/make-icon.swift"
"$STAGE/make-icon" "$ICONSET" > /dev/null
iconutil -c icns "$ICONSET" -o "$BUILD/Contents/Resources/AppIcon.icns"

echo "== Info.plist を書く =="
# BlogProjectPath で、アプリからブログのフォルダの場所が分かる。
# アプリケーションフォルダに置くと .app の隣には何も無いので、これを見る。
cat > "$BUILD/Contents/Info.plist" << PLIST
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
	-o "$BUILD/Contents/MacOS/${NAME}" \
	"$HERE/main.swift"

echo "== 置き換え =="
# 消すのは「ブログ.app」という名前のものだけ、と念のため確かめる
case "$APP" in
	*/"${NAME}.app") ;;
	*)
		echo "思っていない場所を消そうとしています: $APP"
		exit 1
		;;
esac
[ -e "$APP" ] && rm -rf "$APP"
mv "$BUILD" "$APP"
rm -rf "$STAGE"

# 前にブログのフォルダへ直接置いていた分があれば、紛らわしいので片付ける
OLD="$ROOT/${NAME}.app"
if [ -d "$OLD" ] && [ "$OLD" != "$APP" ]; then
	rm -rf "$OLD"
	echo "ブログのフォルダにあった古い ${NAME}.app は片付けました。"
fi

# Finder にアイコンの差し替えを気づかせる
touch "$APP"

echo ""
echo "できました: $APP"
echo "Launchpad や Spotlight から開けます。Dock に入れておくと楽です。"
