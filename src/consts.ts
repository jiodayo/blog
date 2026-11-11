// サイト全体で使う設定値。
//
// 実際の値は src/site.json にある。エディタの「サイト設定」から書き換えるため、
// TypeScript ではなく JSON に置いている。手で直してもよい。
import site from './site.json';

export const SITE_TITLE: string = site.title;
export const SITE_DESCRIPTION: string = site.description;

/** フッターの著作権表示に使う名前 */
export const AUTHOR: string = site.author;

/** トップのサイト名の下に出る一行。空なら出ない */
export const TAGLINE: string = site.tagline ?? '';

/** トップの見出し画像。src/site.json に public/ からのパスを書く。空なら出ない */
export const BANNER_IMAGE: string = site.bannerImage ?? '';

/** ヘッダー・About に並べるリンク。空配列なら何も出ない */
export const SOCIALS: { label: string; href: string }[] = site.socials ?? [];
