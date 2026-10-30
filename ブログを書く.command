#!/bin/bash
#
# ブログエディタを起動して、ブラウザで開く。
# Finder からダブルクリックで実行できる。
# 終了するときは、開いたターミナルのウィンドウで Ctrl+C。
#

# .command はどこから実行されても $0 に自分のパスが入るので、
# それを頼りにプロジェクトのフォルダへ移動する。
cd "$(dirname "$0")" || exit 1

# ダブルクリック時のシェルは ~/.zprofile などを読まないため、
# node を入れた場所が PATH に無いことがある。よくある場所を足しておく。
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

URL="http://127.0.0.1:4322"

if ! command -v npm > /dev/null 2>&1; then
	echo "npm が見つかりません。Node.js がインストールされているか確認してください。"
	echo "何かキーを押すと閉じます。"
	read -r -n 1
	exit 1
fi

# 既に起動しているなら、ブラウザを開くだけでよい
if curl -s -o /dev/null --max-time 2 "$URL" 2>/dev/null; then
	echo "エディタは既に起動しています。ブラウザを開きます。"
	open "$URL"
	exit 0
fi

# フォルダをコピーしてきた直後など、依存が無い場合は入れる
if [ ! -d node_modules ]; then
	echo "初回のみ: 必要なものをインストールします（数分かかります）..."
	npm install || {
		echo "インストールに失敗しました。何かキーを押すと閉じます。"
		read -r -n 1
		exit 1
	}
fi

echo "エディタを起動しています..."

# 起動を待ってからブラウザを開く（裏で待たせて、npm は前面で動かす。
# こうしておくと Ctrl+C がそのまま効く）
(
	for _ in $(seq 1 60); do
		if curl -s -o /dev/null --max-time 2 "$URL" 2>/dev/null; then
			open "$URL"
			exit 0
		fi
		sleep 1
	done
	echo "起動を確認できませんでした。上のログを見てください。"
) &

echo "（終了するには、このウィンドウで Ctrl+C）"
echo ""
npm run editor
