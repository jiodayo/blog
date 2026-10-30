// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// ============================================================
//  site: このサイトの公開URL。RSS・sitemap・OG画像の絶対URLに使われる。
//
//  独自ドメインに移すときは、ここを書き換えるだけ（末尾スラッシュなし）。
//    例) site: 'https://example.com'
//  あわせて public/CNAME にドメイン名を1行だけ書くこと。
// ============================================================
export default defineConfig({
	site: 'https://jiodayo.github.io',
	integrations: [mdx(), sitemap()],
});
