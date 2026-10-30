# jiodayo のブログ

https://jiodayo.github.io/blog/

Astro で作った静的サイト。`main` に push すると GitHub Actions が
ビルドして GitHub Pages に公開する。

ルートの `jiodayo.github.io` には別のサイト（合言葉つきの日記）が動いているため、
このブログは `blog` リポジトリに置き、URL に `/blog/` が挟まる形にしている。
そのため `astro.config.mjs` に `base: '/blog'` を設定してある。

## 日常の使い方

```bash
npm run dev      # http://localhost:4321 で確認しながら書く
npm run build    # dist/ に本番ビルド（公開前の確認用）
npm run preview  # ビルド結果をローカルで表示
```

## 記事を書く（エディタを使う）

`ブログを書く.command` を Finder からダブルクリックする。
エディタと Astro の dev サーバーが立ち上がり、ブラウザまで開く。
終了するときは、開いたターミナルのウィンドウで `Ctrl+C`。

よく使うなら、このファイルを Dock かデスクトップにエイリアスとして置いておくとよい。

ターミナルから起動してもよい。

```bash
npm run editor
```

どちらでも http://127.0.0.1:4322 が編集画面になる。

- 左が記事一覧、真ん中が編集、右が**実際のサイトの見た目**のプレビュー
- 入力は自動保存される（保存ボタンはない。⌘S で即保存）
- 画像はエディタに**貼り付け／ドラッグ&ドロップ**で入る。`src/content/blog/images/` に
  保存され、ビルド時に WebP へ自動変換される
- 横幅 1600px を超える画像は、保存する前に 1600px へ縮小される。
  本文の表示幅は 720px なので、スマホの写真（4000px 超）をそのまま入れると
  リポジトリが無駄に重くなるため。縮小したときはツールバーの下に結果が出る
- 下書きのまま「公開する」を押すと確認が出る。
  下書きはコミットされても公開サイトには出ないため
- 「下書き」にチェックを入れている間は公開サイトに出ない。プレビューには出る
- 「公開する」ボタンで `git add` → `commit` → `push` まで実行する

エディタはこのMacの中だけで動く（127.0.0.1 にしかバインドしない）。

### 記事を直接書く場合



`src/content/blog/` に `.md` ファイルを作る。ファイル名が URL になる。

```markdown
---
title: '記事のタイトル'
description: '一覧とSNSカードに出る短い説明'
pubDate: '2026-10-30'
---

本文。見出しは ## から使う。
```

`updatedDate: '2026-11-05'` を足すと「最終更新」が表示される。

書いたら push すれば1〜2分で公開される。

## どこを触ると何が変わるか

| ファイル | 役割 |
| --- | --- |
| `src/consts.ts` | サイト名・説明・名前・SNSリンク |
| `src/pages/index.astro` | トップページ |
| `src/pages/about.astro` | 自己紹介ページ |
| `src/components/Header.astro` | 上部のナビ |
| `src/components/Footer.astro` | 下部の表示 |
| `src/styles/global.css` | 全体の見た目（色・文字サイズ・余白） |
| `src/layouts/BlogPost.astro` | 記事ページの枠組み |
| `astro.config.mjs` | 公開URL（`site`）とサブパス（`base`） |
| `src/lib/url.ts` | サイト内リンクに `base` を付けるヘルパー |
| `tools/editor/` | 編集画面そのもの（`npm run editor`） |

色を変えるなら `global.css` 先頭の `--accent` から。

## 初回だけ必要な設定

すでに設定済み。作り直すときの手順として残しておく。

1. GitHub で `blog` という名前のリポジトリを作る。
2. push する。
3. リポジトリの **Settings → Pages → Build and deployment → Source** を
   **GitHub Actions** にする。これを忘れると公開されない。

### リポジトリ名を変えた場合

URL は `https://jiodayo.github.io/<リポジトリ名>/` になるので、
`astro.config.mjs` の `base` を同じ名前に書き換える。

サイト内のリンクはすべて `src/lib/url.ts` の `url()` を通しているので、
`base` を変えれば全部追従する。ベタ書きの `href="/..."` は足さないこと。

## 独自ドメインに移すとき

独自ドメインは無料アカウントでも使える（GitHub Pro は不要）。
ドメイン自体はレジストラで取得する。

1. `astro.config.mjs` の `site` を `'https://example.com'` に書き換え、
   **`base: '/blog'` の行を削除する**（独自ドメインならサブパスは不要）。
2. `public/CNAME` を作り、ドメイン名だけを1行書く（`https://` やスラッシュは付けない）。

   ```
   example.com
   ```

3. DNS を設定する。
   - サブドメイン（`www.example.com` など）の場合は
     CNAME レコードを `jiodayo.github.io` に向ける。
   - ルートドメイン（`example.com`）の場合は A レコードを4つ登録する。
     ```
     185.199.108.153
     185.199.109.153
     185.199.110.153
     185.199.111.153
     ```
     （最新の IP は GitHub のドキュメントで確認すること）
4. リポジトリの **Settings → Pages → Custom domain** にドメインを入れ、
   DNS が通ったら **Enforce HTTPS** にチェックを入れる。

DNS の反映には数分〜数時間かかることがある。
