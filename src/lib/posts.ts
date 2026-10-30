import { getCollection, type CollectionEntry } from 'astro:content';
import { url } from './url';

export type Post = CollectionEntry<'blog'>;

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

// ------------------------------------------------------------------ 日付

/** pubDate を site 全体で同じ扱いにするため、ローカル時間で分解する */
export function ymd(date: Date) {
	return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** '2026' / '2026/10' のような、アーカイブ URL に使うキー */
export function yearKey(date: Date) {
	return String(ymd(date).year);
}
export function monthKey(date: Date) {
	const { year, month } = ymd(date);
	return `${year}/${pad(month)}`;
}

export function archiveUrl(key: string) {
	return url(`/archive/${key}/`);
}

export type MonthGroup = { key: string; year: number; month: number; posts: Post[] };
export type YearGroup = { key: string; year: number; count: number; months: MonthGroup[] };

/**
 * 記事を年 → 月でまとめる。新しい年・新しい月が先。
 * サイドバーのアーカイブと /archive/ のページで共通して使う。
 */
export function groupByDate(posts: Post[]): YearGroup[] {
	const years = new Map<number, Map<string, MonthGroup>>();
	for (const post of posts) {
		const { year } = ymd(post.data.pubDate);
		const key = monthKey(post.data.pubDate);
		if (!years.has(year)) years.set(year, new Map());
		const months = years.get(year)!;
		if (!months.has(key)) {
			months.set(key, { key, year, month: ymd(post.data.pubDate).month, posts: [] });
		}
		months.get(key)!.posts.push(post);
	}
	return [...years.entries()]
		.sort((a, b) => b[0] - a[0])
		.map(([year, months]) => {
			const list = [...months.values()].sort((a, b) => b.month - a.month);
			return {
				key: String(year),
				year,
				count: list.reduce((n, m) => n + m.posts.length, 0),
				months: list,
			};
		});
}

/** 日付の新しい順に、同じ日の記事をまとめる */
export function groupByDay(posts: Post[]) {
	const days = new Map<string, Post[]>();
	for (const post of posts) {
		const { year, month, day } = ymd(post.data.pubDate);
		const key = `${year}-${pad(month)}-${pad(day)}`;
		if (!days.has(key)) days.set(key, []);
		days.get(key)!.push(post);
	}
	return [...days.entries()]
		.sort((a, b) => b[0].localeCompare(a[0]))
		.map(([key, posts]) => ({ key, date: posts[0].data.pubDate, posts }));
}

// -------------------------------------------------------------------- タグ

export type TagCount = { tag: string; count: number };

/** 使われているタグを、件数の多い順（同数なら名前順）で返す */
export function collectTags(posts: Post[]): TagCount[] {
	const counts = new Map<string, number>();
	for (const post of posts) {
		for (const tag of post.data.tags) {
			const name = tag.trim();
			if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ja'));
}

/**
 * タグのページの URL。
 * 日本語のタグをそのままパスに入れるので、リンク側では必ずエスケープする。
 */
export function tagUrl(tag: string) {
	return url(`/tags/${encodeURIComponent(tag)}/`);
}
