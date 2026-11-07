#!/bin/bash
# 拡張をパッケージして VS Code に入れ直す。
set -e
cd "$(dirname "$0")"

CODE="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
if [ ! -x "$CODE" ]; then
	echo "VS Code が見つかりません: $CODE"
	exit 1
fi

VERSION=$(node -p "require('./package.json').version")
VSIX="jiodayo-blog-$VERSION.vsix"

echo "パッケージを作っています…"
npx --yes @vscode/vsce package --allow-missing-repository --skip-license --no-dependencies --out "$VSIX"

echo "VS Code に入れています…"
"$CODE" --install-extension "$VSIX" --force

rm -f "$VSIX"
echo
echo "完了しました。VS Code で ⇧⌘P → 'Developer: Reload Window' を実行してください。"
