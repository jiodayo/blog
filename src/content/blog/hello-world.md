---
title: 'このブログの作り方メモ'
description: 'Astro と GitHub Pages で個人サイトを立てた。記事の書き方も兼ねたメモ。'
pubDate: '2026-10-30'
---

個人サイトを作った。構成は Astro + GitHub Pages で、`main` に push すると
GitHub Actions がビルドして自動で公開される。

## 記事の書き方

`src/content/blog/` に Markdown ファイルを置くだけ。ファイル名がそのまま URL になる。
たとえば `hello-world.md` なら `/blog/hello-world/` で読める。

ファイルの先頭にある `---` で囲まれた部分を frontmatter と呼ぶ。ここは必須。

```yaml
---
title: '記事のタイトル'
description: '一覧ページとSNSカードに出る短い説明'
pubDate: '2026-10-30'
---
```

`updatedDate` を足すと「最終更新」が記事に表示される。省略してよい。

## 書けるもの

見出しは `##` から使う。`#` は記事タイトルが使っているので本文では使わない。

**太字**、*斜体*、`インラインコード`、[リンク](https://example.com)、それと引用。

> 引用はこう書く。

箇条書きと番号付きリスト。

- りんご
- みかん

1. 準備する
2. 書く
3. push する

コードブロックは言語名を書くと色が付く。

```js
const greet = (name) => `こんにちは、${name}`;
console.log(greet('世界'));
```

画像は `src/content/blog/` の隣に置いて相対パスで参照できる。

## 公開の流れ

```bash
git add .
git commit -m "記事を追加"
git push
```

push から1〜2分で反映される。進行状況はリポジトリの Actions タブで見られる。
