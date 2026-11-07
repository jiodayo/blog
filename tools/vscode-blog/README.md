# ブログ（VS Code 拡張）

このブログを VS Code だけで書いて公開するための拡張。
`tools/editor` の Web エディタのうち、VS Code に無い機能だけを足している。

## できること

| コマンド | 内容 |
| --- | --- |
| ブログ: 新しい記事 | スラッグと frontmatter の雛形を作って開く |
| ブログ: 公開する | 保存 → `git add -A` → commit → push。下書きなら確認が出る |
| ブログ: 画像を挿入 | ファイルを選んで `images/` に保存し、リンクを挿入 |
| ブログ: プレビューを開く | dev サーバーを起動して、いま開いている記事を横に表示 |
| ブログ: 下書きを切り替える | `draft: true` の付け外し |

ほかに、

- 画像を**貼り付ける**と、1600px に縮小して `src/content/blog/images/` に保存し、
  Markdown のリンクに差し替える（縮小には macOS 標準の `sips` を使う）
- `tags:` の行でタグを補完する。既にある記事から集めるので綴りが揺れない
- 右下に未公開の変更の件数が出る。クリックで公開

## 入れ方・更新のしかた

```bash
tools/vscode-blog/install.sh
```

パッケージを作って VS Code に入れ直す。実行後は VS Code を再読み込みすること
（`⇧⌘P` → `Developer: Reload Window`）。

## 設定

| 設定 | 既定値 | 内容 |
| --- | --- | --- |
| `blog.maxImageWidth` | 1600 | 貼り付けた画像を縮める幅。0 で縮小しない |
| `blog.devServerUrl` | `http://localhost:4321` | プレビューに使う dev サーバー |

## 注意

Web のエディタ（`npm run editor`）と同時に同じ記事を開かないこと。
あちらは自動保存するので、VS Code で書いた内容を上書きすることがある。

frontmatter の読み書きは `tools/editor/server.mjs` にも同じものがある。
この拡張はフォルダ単位で完結させたいので共有していない。書式を変えるときは両方直すこと。
