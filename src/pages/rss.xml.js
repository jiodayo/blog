import { getPosts } from '../lib/posts';
import { url } from '../lib/url';
import rss from '@astrojs/rss';
import { SITE_DESCRIPTION, SITE_TITLE } from '../consts';

export async function GET(context) {
	const posts = await getPosts();
	return rss({
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		// チャンネルのURLは base を含めた「このブログのトップ」。
		// 各記事の link はオリジン基準で解決されるので、base 付きの絶対パスで渡す。
		site: new URL(import.meta.env.BASE_URL, context.site),
		customData: '<language>ja</language>',
		items: posts.map((post) => ({
			...post.data,
			link: url(`/posts/${post.id}/`),
		})),
	});
}
