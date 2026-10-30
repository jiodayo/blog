import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
	// src/content/blog/ の Markdown / MDX を読み込む
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	// frontmatter の型チェック
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			// 文字列を Date に変換する
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			heroImage: z.optional(image()),
			// true の記事は本番ビルドから除外される（dev では見える）
			draft: z.boolean().default(false),
			// 記事につけるタグ。書かなければ空配列になる
			tags: z.array(z.string()).default([]),
		}),
});

export const collections = { blog };
