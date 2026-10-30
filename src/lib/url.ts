const BASE = import.meta.env.BASE_URL;

/**
 * サイト内パスに base を付ける。
 *
 *   url('/')           → '/blog/'
 *   url('/about')      → '/blog/about'
 *   url('/posts/x/')   → '/blog/posts/x/'
 *
 * astro.config.mjs の base を変えてもリンクが壊れないよう、
 * サイト内リンクは必ずこれを通すこと。
 */
export function url(path: string): string {
	return `${BASE}/${path}`.replace(/\/{2,}/g, '/');
}
