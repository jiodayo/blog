// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';

// ============================================================
//  site: このサイトの公開URL。RSS・sitemap・OG画像の絶対URLに使われる。
//
//  独自ドメインに移すときは、ここを書き換えるだけ（末尾スラッシュなし）。
//    例) site: 'https://example.com'
//  あわせて public/CNAME にドメイン名を1行だけ書くこと。
// ============================================================
export default defineConfig({
	site: 'https://jiodayo.github.io',
	// リポジトリ名が jiodayo.github.io ではないため、URL に /blog/ が挟まる。
	// 独自ドメインに移すときは base を消して site だけ書き換える。
	base: '/blog',
	integrations: [mdx(), sitemap()],
	markdown: {
		// 脚注（[^1]）まわりの文言を日本語にする。
		// 既定では "Footnotes" と "Back to reference 1" が入る。
		// 見出しは読み上げ用に隠されているので、global.css の .footnotes で表に出している。
		processor: satteri({
			features: {
				gfm: {
					footnotes: {
						label: '脚注',
						backLabel: '本文に戻る（{reference}）',
					},
				},
			},
		}),
	},
});
