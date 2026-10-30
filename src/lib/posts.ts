import { getCollection } from 'astro:content';

/**
 * 公開する記事を新しい順で返す。
 * draft: true の記事は本番ビルドでは除外し、dev サーバーでは表示する
 * （エディタのプレビューで下書きを確認できるようにするため）。
 */
export async function getPosts() {
	const posts = await getCollection('blog', ({ data }) =>
		import.meta.env.PROD ? !data.draft : true,
	);
	return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}
