// ブログ編集用のローカルサーバー（依存パッケージなし）
//
//   npm run editor  →  http://127.0.0.1:4322
//
// やること:
//   - src/content/blog/*.md の一覧・読み書き・削除
//   - 貼り付けた画像の保存
//   - 「公開」ボタンから git add / commit / push
//   - Astro の dev サーバー(4321)が止まっていれば一緒に起動する
//
// 127.0.0.1 にしかバインドしないので、このMacの外からは触れない。

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const POSTS_DIR = path.join(ROOT, 'src/content/blog');
const IMAGES_DIR = path.join(POSTS_DIR, 'images');
const PAGES_DIR = path.join(ROOT, 'src/content/pages');
const SITE_FILE = path.join(ROOT, 'src/site.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
// 生の HTML の中の <img> は Astro が面倒を見ないので、
// 記事からの相対パスだと 404 になる。public/ に置いて絶対パスで参照する。
const EMBED_DIR = path.join(PUBLIC_DIR, 'embeds');
// 固定ページの画像。Markdown の ./images/ は「その .md があるフォルダ」から
// 解決されるので、記事とページで置き場所を分ける必要がある。
const PAGE_IMAGES_DIR = path.join(PAGES_DIR, 'images');
const UI_DIR = path.join(HERE, 'ui');

const EDITOR_PORT = 4322;
const DEV_PORT = 4321;
const DEV_ORIGIN = `http://localhost:${DEV_PORT}`;

// 記事ページのルート名（src/pages/posts/ に対応）
const POSTS_ROUTE = 'posts';

/**
 * astro.config.mjs の base を読む。'/blog' のような値か、未設定なら ''。
 * ここをベタ書きすると base を変えたときにプレビューだけ壊れるため、設定から読む。
 */
async function readBase() {
	try {
		const conf = await fs.readFile(path.join(ROOT, 'astro.config.mjs'), 'utf8');
		const m = /^\s*base:\s*['"]([^'"]+)['"]/m.exec(conf);
		return m ? `/${m[1].replace(/^\/+|\/+$/g, '')}` : '';
	} catch {
		return '';
	}
}

/** astro.config.mjs の site。公開後のURLを画面に出すために使う */
async function readSiteUrl() {
	try {
		const conf = await fs.readFile(path.join(ROOT, 'astro.config.mjs'), 'utf8');
		const m = /^\s*site:\s*['"]([^'"]+)['"]/m.exec(conf);
		return m ? m[1].replace(/\/+$/, '') : '';
	} catch {
		return '';
	}
}

/** 記事ページのURLのうち、スラッグより前の部分。例: '/blog/posts' */
async function postUrlPrefix() {
	return `${await readBase()}/${POSTS_ROUTE}`;
}

// スラッグはそのままファイル名になるので、ここで厳しく絞る（../ などを防ぐ）
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);

class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

// ---------------------------------------------------------------- frontmatter

/** '[a, b]' を配列に分ける。引用符の中のカンマは区切りにしない。 */
function parseFlowSeq(raw) {
	const inner = raw.trim().slice(1, -1);
	const items = [];
	let buf = '';
	let quote = '';
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (quote) {
			// 引用符の中。'' と \" は文字そのものとして扱う
			if (ch === quote && inner[i + 1] === quote) {
				buf += ch;
				i++;
			} else if (ch === '\\' && quote === '"' && inner[i + 1] === '"') {
				buf += '"';
				i++;
			} else if (ch === quote) {
				quote = '';
			} else {
				buf += ch;
			}
		} else if (ch === "'" || ch === '"') {
			quote = ch;
		} else if (ch === ',') {
			items.push(buf.trim());
			buf = '';
		} else {
			buf += ch;
		}
	}
	items.push(buf.trim());
	return items.filter((v) => v !== '');
}

function parseScalar(raw) {
	const v = raw.trim();
	if (v === 'true') return true;
	if (v === 'false') return false;
	if (v.startsWith('[') && v.endsWith(']')) return parseFlowSeq(v);
	if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
		return v.slice(1, -1).replace(/''/g, "'");
	}
	if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
		return v.slice(1, -1).replace(/\\"/g, '"');
	}
	return v;
}

function parsePost(raw) {
	const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
	if (!m) return { data: {}, body: raw };
	const data = {};
	for (const line of m[1].split(/\r?\n/)) {
		const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
		if (kv) data[kv[1]] = parseScalar(kv[2]);
	}
	return { data, body: m[2] };
}

/** 画面から来た tags を整える。空文字と重複を落とし、順番は保つ。 */
function normalizeTags(value) {
	const list = Array.isArray(value) ? value : [];
	const seen = new Set();
	const out = [];
	for (const raw of list) {
		const tag = String(raw).trim();
		if (!tag || seen.has(tag)) continue;
		seen.add(tag);
		out.push(tag);
	}
	return out;
}

// YAML の単一引用符は '' でエスケープする
function yamlString(value) {
	return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function serializePost(data, body) {
	const lines = [
		`title: ${yamlString(data.title)}`,
		`description: ${yamlString(data.description)}`,
		`pubDate: ${yamlString(data.pubDate)}`,
	];
	if (data.updatedDate) lines.push(`updatedDate: ${yamlString(data.updatedDate)}`);
	if (data.heroImage) lines.push(`heroImage: ${yamlString(data.heroImage)}`);
	const tags = normalizeTags(data.tags);
	if (tags.length > 0) lines.push(`tags: [${tags.map(yamlString).join(', ')}]`);
	if (data.draft) lines.push('draft: true');
	return `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\s+|\s+$/g, '')}\n`;
}

// ---------------------------------------------------------------------- posts

function postPath(slug) {
	if (!SLUG_RE.test(slug)) {
		throw new HttpError(400, 'スラッグに使えるのは英小文字・数字・ハイフンだけです');
	}
	return path.join(POSTS_DIR, `${slug}.md`);
}

function today() {
	// ローカル時間の YYYY-MM-DD
	const d = new Date();
	const p = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function listPosts() {
	const names = await fs.readdir(POSTS_DIR);
	const posts = [];
	for (const name of names) {
		if (!/\.mdx?$/.test(name)) continue;
		const slug = name.replace(/\.mdx?$/, '');
		const raw = await fs.readFile(path.join(POSTS_DIR, name), 'utf8');
		const { data } = parsePost(raw);
		posts.push({
			slug,
			title: data.title || slug,
			description: data.description || '',
			pubDate: data.pubDate || '',
			tags: normalizeTags(data.tags),
			draft: data.draft === true,
			// .mdx は一覧には出すが、このエディタでは開かない
			readOnly: name.endsWith('.mdx'),
		});
	}
	posts.sort((a, b) => String(b.pubDate).localeCompare(String(a.pubDate)));
	return posts;
}

async function readPost(slug) {
	let raw;
	try {
		raw = await fs.readFile(postPath(slug), 'utf8');
	} catch {
		throw new HttpError(404, '記事が見つかりません');
	}
	const { data, body } = parsePost(raw);
	return {
		slug,
		title: data.title || '',
		description: data.description || '',
		pubDate: data.pubDate || today(),
		updatedDate: data.updatedDate || '',
		heroImage: data.heroImage || '',
		tags: normalizeTags(data.tags),
		draft: data.draft === true,
		body,
	};
}

async function writePost(slug, payload) {
	const file = postPath(slug);
	if (!payload.title?.trim()) throw new HttpError(400, 'タイトルは必須です');
	await fs.writeFile(file, serializePost(payload, payload.body || ''), 'utf8');
	return { ok: true, slug };
}

async function deletePost(slug) {
	await fs.unlink(postPath(slug)).catch(() => {
		throw new HttpError(404, '記事が見つかりません');
	});
	return { ok: true };
}

async function renamePost(from, to) {
	const fromFile = postPath(from);
	const toFile = postPath(to);
	try {
		await fs.access(toFile);
		throw new HttpError(409, `スラッグ "${to}" は既に使われています`);
	} catch (e) {
		if (e instanceof HttpError) throw e;
	}
	await fs.rename(fromFile, toFile);
	return { ok: true, slug: to };
}

// --------------------------------------------------------------------- images

// 本文の表示幅は 720px。Retina 表示を考えても 1600px あれば十分で、
// スマホで撮った写真（4000px 超）をそのまま入れると git が無駄に重くなる。
// Astro は形式変換はするが縮小はしないので、入る前にここで縮める。
const MAX_IMAGE_WIDTH = 1600;

/** sharp は Astro の依存として入っている。無くても動くように読み込みは任意扱い。 */
async function loadSharp() {
	try {
		return (await import('sharp')).default;
	} catch {
		return null;
	}
}

async function shrinkImage(buffer, ext) {
	// アニメーションGIFは縮小すると壊れることがあるので触らない
	if (ext === 'gif') return { buffer, resized: false };

	const sharp = await loadSharp();
	if (!sharp) return { buffer, resized: false };

	try {
		const image = sharp(buffer);
		const { width } = await image.metadata();
		if (!width || width <= MAX_IMAGE_WIDTH) return { buffer, resized: false, width };

		const out = await image
			.rotate() // Exif の向きを反映させてから縮小する
			.resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
			.toBuffer();
		return { buffer: out, resized: true, widthBefore: width, width: MAX_IMAGE_WIDTH };
	} catch {
		// 縮小に失敗しても、元の画像は保存できたほうがよい
		return { buffer, resized: false };
	}
}

async function saveImage(slug, ext, buffer, kind = 'post') {
	if (!IMAGE_EXT.has(ext)) throw new HttpError(400, `対応していない画像形式です: ${ext}`);
	const safeSlug = SLUG_RE.test(slug) ? slug : 'image';
	const name = `${safeSlug}-${Date.now()}.${ext}`;
	const dir = kind === 'page' ? PAGE_IMAGES_DIR : IMAGES_DIR;
	await fs.mkdir(dir, { recursive: true });

	const bytesBefore = buffer.length;
	const shrunk = await shrinkImage(buffer, ext);
	await fs.writeFile(path.join(dir, name), shrunk.buffer);

	// 記事からの相対パス。ここから先は Astro が WebP への変換を担当する
	return {
		markdownPath: `./images/${name}`,
		bytesBefore,
		bytesAfter: shrunk.buffer.length,
		resized: shrunk.resized,
		widthBefore: shrunk.widthBefore ?? null,
		width: shrunk.width ?? null,
	};
}

// ------------------------------------------------------------------- 埋め込み
//
// 貼った URL を、記事の中で見られる形に変える。
// 外部のスクリプトは一切読み込まない方針なので、
//   YouTube → 公式の埋め込み iframe（Cookie を置かない nocookie 版）
//   X       → 本文つきの引用（widgets.js は読み込まない）
//   その他   → OGP を読んでリンクカード。画像は手元に落として縮小する
// のいずれかの HTML をここで組み立てて返す。

const FETCH_TIMEOUT = 10000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_EMBED_IMAGE_BYTES = 8 * 1024 * 1024;
const UA = 'Mozilla/5.0 (compatible; blog-editor/1.0)';

const escapeHtml = (v) =>
	String(v ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);

/**
 * 外に出ていく URL だけを許す。
 * ここは画面から来た文字列をそのまま fetch する場所なので、
 * 手元のネットワークを覗きに行けないようにしておく。
 */
function assertFetchable(raw) {
	let url;
	try {
		url = new URL(raw);
	} catch {
		throw new HttpError(400, 'URL として読めません');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new HttpError(400, 'http / https の URL だけ埋め込めます');
	}
	const host = url.hostname.toLowerCase();
	const isPrivate =
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host === '[::1]' ||
		/^127\./.test(host) ||
		/^10\./.test(host) ||
		/^192\.168\./.test(host) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
		/^169\.254\./.test(host);
	if (isPrivate) throw new HttpError(400, '手元のネットワークの URL は埋め込めません');
	return url;
}

async function fetchLimited(url, maxBytes, accept) {
	const res = await fetch(url, {
		redirect: 'follow',
		headers: { 'user-agent': UA, accept },
		signal: AbortSignal.timeout(FETCH_TIMEOUT),
	});
	if (!res.ok) throw new HttpError(502, `取得できませんでした (${res.status})`);
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.length > maxBytes) throw new HttpError(502, 'ページが大きすぎます');
	return { buf, res };
}

/** <meta> から値をひとつ拾う */
function metaContent(html, keys) {
	for (const key of keys) {
		const re = new RegExp(
			`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|` +
				`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
			'i',
		);
		const m = re.exec(html);
		const value = m?.[1] ?? m?.[2];
		if (value) return decodeEntities(value.trim());
	}
	return '';
}

function decodeEntities(v) {
	return v
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&');
}

function youtubeId(url) {
	const host = url.hostname.replace(/^www\./, '');
	if (host === 'youtu.be') return url.pathname.slice(1).split('/')[0];
	if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
		if (url.pathname === '/watch') return url.searchParams.get('v') || '';
		const m = /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname);
		if (m) return m[1];
	}
	return '';
}

const isXStatus = (url) =>
	/^(www\.)?(x|twitter)\.com$/.test(url.hostname) && /\/status\/\d+/.test(url.pathname);

/**
 * 生の HTML から参照する画像を public/embeds/ に置く。
 * 返すのは base 込みの絶対パス（例: /blog/embeds/xxx.webp）。
 */
async function saveEmbedAsset(slug, ext, buffer) {
	if (!IMAGE_EXT.has(ext)) throw new HttpError(400, `対応していない画像形式です: ${ext}`);
	const safeSlug = SLUG_RE.test(slug) ? slug : 'embed';
	const name = `${safeSlug}-${Date.now()}.${ext}`;
	await fs.mkdir(EMBED_DIR, { recursive: true });
	const shrunk = await shrinkImage(buffer, ext);
	await fs.writeFile(path.join(EMBED_DIR, name), shrunk.buffer);
	return {
		name,
		url: `${await readBase()}/embeds/${name}`,
		resized: shrunk.resized,
		widthBefore: shrunk.widthBefore ?? null,
		width: shrunk.width ?? null,
		bytesBefore: buffer.length,
		bytesAfter: shrunk.buffer.length,
	};
}

/** OGP の画像を手元に落とす。落とせなければ画像なしで続ける。 */
async function saveEmbedImage(slug, imageUrl) {
	try {
		const url = assertFetchable(imageUrl);
		const { buf, res } = await fetchLimited(url, MAX_EMBED_IMAGE_BYTES, 'image/*');
		const type = (res.headers.get('content-type') || '').split(';')[0].trim();
		let ext = type.replace(/^image\//, '').toLowerCase();
		if (ext === 'jpg') ext = 'jpeg';
		if (!IMAGE_EXT.has(ext)) {
			const fromPath = path.extname(url.pathname).slice(1).toLowerCase();
			ext = fromPath === 'jpg' ? 'jpeg' : fromPath;
		}
		if (!IMAGE_EXT.has(ext)) return null;
		return await saveEmbedAsset(slug, ext, buf);
	} catch {
		return null;
	}
}

async function buildEmbed(slug, rawUrl) {
	const url = assertFetchable(rawUrl);
	const href = url.toString();

	// --- YouTube
	const videoId = youtubeId(url);
	if (videoId && /^[\w-]{6,20}$/.test(videoId)) {
		let title = 'YouTube の動画';
		try {
			const { buf } = await fetchLimited(
				`https://www.youtube.com/oembed?url=${encodeURIComponent(href)}&format=json`,
				MAX_HTML_BYTES,
				'application/json',
			);
			title = JSON.parse(buf.toString('utf8')).title || title;
		} catch {
			// タイトルが取れなくても埋め込みは作れる
		}
		const html =
			`<div class="embed-video">\n` +
			`\t<iframe src="https://www.youtube-nocookie.com/embed/${escapeHtml(videoId)}" ` +
			`title="${escapeHtml(title)}" loading="lazy" allowfullscreen ` +
			`allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>\n` +
			`</div>`;
		return { type: 'youtube', title, html };
	}

	// --- X（旧 Twitter）
	if (isXStatus(url)) {
		try {
			const { buf } = await fetchLimited(
				`https://publish.twitter.com/oembed?url=${encodeURIComponent(href)}&omit_script=1&dnt=true`,
				MAX_HTML_BYTES,
				'application/json',
			);
			const data = JSON.parse(buf.toString('utf8'));
			if (data.html) {
				return {
					type: 'x',
					title: `${data.author_name ?? ''} のポスト`.trim(),
					// widgets.js を読まないので、ただの引用として表示される。
					// 外部スクリプトを入れないための意図的な選択。
					html: `<figure class="embed-x">\n${data.html.trim()}\n</figure>`,
				};
			}
		} catch {
			// 取れなければ下のリンクカードに回す
		}
	}

	// --- その他はリンクカード
	const { buf } = await fetchLimited(href, MAX_HTML_BYTES, 'text/html,application/xhtml+xml');
	const html = buf.toString('utf8');
	const title =
		metaContent(html, ['og:title', 'twitter:title']) ||
		decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').trim()) ||
		url.hostname;
	const description = metaContent(html, ['og:description', 'twitter:description', 'description']);
	const siteName = metaContent(html, ['og:site_name']) || url.hostname.replace(/^www\./, '');
	const imageUrl = metaContent(html, ['og:image', 'twitter:image', 'twitter:image:src']);

	let image = null;
	if (imageUrl) {
		image = await saveEmbedImage(slug, new URL(imageUrl, href).toString());
	}

	const parts = [
		`<a class="embed-card" href="${escapeHtml(href)}" target="_blank" rel="noopener">`,
		image ? `\t<img src="${escapeHtml(image.url)}" alt="" loading="lazy" />` : '',
		`\t<span class="embed-card-body">`,
		`\t\t<span class="embed-card-title">${escapeHtml(title)}</span>`,
		description ? `\t\t<span class="embed-card-desc">${escapeHtml(description)}</span>` : '',
		`\t\t<span class="embed-card-site">${escapeHtml(siteName)}</span>`,
		`\t</span>`,
		`</a>`,
	].filter(Boolean);

	return { type: 'card', title, html: parts.join('\n') };
}

// ------------------------------------------------------------- 固定ページ

// About のような固定ページ。記事と違って日付も下書きも無く、本文だけ。
const PAGE_RE = /^[a-z][a-z0-9-]{0,40}$/;

function pageFile(name) {
	if (!PAGE_RE.test(name)) throw new HttpError(400, 'ページ名に使えるのは英小文字・数字・ハイフンだけです');
	return path.join(PAGES_DIR, `${name}.md`);
}

async function listPages() {
	let names = [];
	try {
		names = await fs.readdir(PAGES_DIR);
	} catch {
		return [];
	}
	const pages = [];
	for (const file of names) {
		if (!file.endsWith('.md')) continue;
		const name = file.replace(/\.md$/, '');
		const { data } = parsePost(await fs.readFile(path.join(PAGES_DIR, file), 'utf8'));
		pages.push({ name, title: data.title || name });
	}
	return pages.sort((a, b) => a.name.localeCompare(b.name));
}

async function readPage(name) {
	let raw;
	try {
		raw = await fs.readFile(pageFile(name), 'utf8');
	} catch {
		throw new HttpError(404, 'ページが見つかりません');
	}
	const { data, body } = parsePost(raw);
	return { name, title: data.title || '', description: data.description || '', body };
}

async function writePage(name, payload) {
	if (!payload.title?.trim()) throw new HttpError(400, 'タイトルは必須です');
	const text =
		`---\n` +
		`title: ${yamlString(payload.title)}\n` +
		`description: ${yamlString(payload.description || '')}\n` +
		`---\n\n${(payload.body || '').replace(/^\s+|\s+$/g, '')}\n`;
	await fs.mkdir(PAGES_DIR, { recursive: true });
	await fs.writeFile(pageFile(name), text, 'utf8');
	return { ok: true, name };
}

// ------------------------------------------------------------- サイト設定

const SITE_DEFAULTS = {
	title: '',
	description: '',
	author: '',
	tagline: '',
	bannerImage: '',
	socials: [],
};

async function readSite() {
	try {
		return { ...SITE_DEFAULTS, ...JSON.parse(await fs.readFile(SITE_FILE, 'utf8')) };
	} catch {
		return { ...SITE_DEFAULTS };
	}
}

async function writeSite(payload) {
	const current = await readSite();
	const next = {
		...current,
		title: String(payload.title ?? current.title).trim(),
		description: String(payload.description ?? current.description).trim(),
		author: String(payload.author ?? current.author).trim(),
		tagline: String(payload.tagline ?? current.tagline).trim(),
		bannerImage: String(payload.bannerImage ?? current.bannerImage).trim(),
		socials: (Array.isArray(payload.socials) ? payload.socials : current.socials)
			.map((s) => ({ label: String(s?.label ?? '').trim(), href: String(s?.href ?? '').trim() }))
			.filter((s) => s.label && s.href),
	};
	if (!next.title) throw new HttpError(400, 'サイト名は必須です');
	await fs.writeFile(SITE_FILE, `${JSON.stringify(next, null, '\t')}\n`, 'utf8');
	return next;
}

/** トップの見出し画像は public/ に置く。Astro を通さずそのまま配信される。 */
async function saveBanner(ext, buffer) {
	if (!IMAGE_EXT.has(ext)) throw new HttpError(400, `対応していない画像形式です: ${ext}`);
	await fs.mkdir(PUBLIC_DIR, { recursive: true });
	// 古い拡張子のものが残らないよう、いったん全部消す
	for (const e of IMAGE_EXT) {
		await fs.rm(path.join(PUBLIC_DIR, `banner.${e}`), { force: true });
	}
	const shrunk = await shrinkImage(buffer, ext);
	await fs.writeFile(path.join(PUBLIC_DIR, `banner.${ext}`), shrunk.buffer);
	const site = await writeSite({ ...(await readSite()), bannerImage: `/banner.${ext}` });
	return { bannerImage: site.bannerImage, resized: shrunk.resized };
}

// --------------------------------------------------------------- 画像の棚卸し

/**
 * images/ の中身と、どの記事から参照されているかを返す。
 * 記事を消しても画像は残るので、たまに掃除できるようにしておく。
 */
async function imageInventory() {
	const dirs = [
		{ dir: IMAGES_DIR, where: 'posts' },
		{ dir: PAGE_IMAGES_DIR, where: 'pages' },
		{ dir: EMBED_DIR, where: 'embeds' },
	];
	const entries = [];
	for (const { dir, where } of dirs) {
		try {
			for (const name of await fs.readdir(dir)) {
				if (IMAGE_EXT.has(path.extname(name).slice(1).toLowerCase())) {
					entries.push({ name, dir, where });
				}
			}
		} catch {
			// そのフォルダがまだ無いだけ
		}
	}
	if (entries.length === 0) return { images: [] };

	const sources = [];
	for (const dir of [POSTS_DIR, PAGES_DIR]) {
		let files = [];
		try {
			files = await fs.readdir(dir);
		} catch {
			continue;
		}
		for (const file of files) {
			if (!/\.mdx?$/.test(file)) continue;
			sources.push({
				slug: file.replace(/\.mdx?$/, ''),
				text: await fs.readFile(path.join(dir, file), 'utf8'),
			});
		}
	}

	const images = [];
	for (const { name, dir, where } of entries) {
		const usedBy = sources.filter((s) => s.text.includes(name)).map((s) => s.slug);
		const stat = await fs.stat(path.join(dir, name));
		images.push({ name, where, bytes: stat.size, usedBy });
	}
	images.sort((a, b) => a.name.localeCompare(b.name));
	return { images };
}

async function deleteUnusedImages() {
	const { images } = await imageInventory();
	const unused = images.filter((i) => i.usedBy.length === 0);
	for (const image of unused) {
		const dir =
			image.where === 'embeds' ? EMBED_DIR : image.where === 'pages' ? PAGE_IMAGES_DIR : IMAGES_DIR;
		await fs.rm(path.join(dir, image.name), { force: true });
	}
	return { deleted: unused.map((i) => i.name), bytes: unused.reduce((n, i) => n + i.bytes, 0) };
}

// ------------------------------------------------------ 未公開の変更とビルド

/** 公開ボタンを押す前に、何が送られるのかを見せるための一覧 */
async function pendingChanges() {
	// git() は trim するが、--porcelain は先頭2桁が状態なので、ここでは生のまま使う
	let out = '';
	try {
		({ stdout: out } = await execFileAsync('git', ['status', '--porcelain'], { cwd: ROOT }));
	} catch {
		return { files: [] };
	}
	const lines = out.split('\n').filter(Boolean);
	if (lines.length === 0) return { files: [] };
	const files = lines.map((line) => {
		const code = line.slice(0, 2).trim();
		const file = line.slice(3).trim();
		const label =
			code === '??' ? '新規' : code.startsWith('D') ? '削除' : code.startsWith('A') ? '追加' : '変更';
		return { file, label };
	});
	return { files };
}

/**
 * 公開したあと、GitHub 側のビルドが終わったかを見る。
 * gh コマンドが無い環境では状態を返さない（公開自体は成功している）。
 */
async function deployStatus() {
	try {
		const { stdout } = await execFileAsync(
			'gh',
			['run', 'list', '--limit', '1', '--json', 'status,conclusion,displayTitle,url'],
			{ cwd: ROOT, timeout: 15000 },
		);
		const run = JSON.parse(stdout)[0];
		if (!run) return { available: true, status: 'none' };
		return {
			available: true,
			status: run.status,
			conclusion: run.conclusion,
			title: run.displayTitle,
			url: run.url,
		};
	} catch {
		return { available: false };
	}
}

// ------------------------------------------------------------------------ git

async function git(args) {
	const { stdout, stderr } = await execFileAsync('git', args, {
		cwd: ROOT,
		maxBuffer: 10 * 1024 * 1024,
	});
	return `${stdout}${stderr}`.trim();
}

async function gitStatus() {
	const status = { branch: null, remote: null, changed: 0, hasCommits: false, error: null };
	try {
		status.branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
	} catch {
		status.branch = 'main';
	}
	try {
		await git(['rev-parse', 'HEAD']);
		status.hasCommits = true;
	} catch {
		status.hasCommits = false;
	}
	try {
		status.remote = await git(['remote', 'get-url', 'origin']);
	} catch {
		status.remote = null;
	}
	try {
		const out = await git(['status', '--porcelain']);
		status.changed = out ? out.split('\n').filter(Boolean).length : 0;
	} catch (e) {
		status.error = e.message;
	}
	return status;
}

async function gitPublish(message) {
	const log = [];
	const status = await gitStatus();
	if (!status.remote) {
		throw new HttpError(
			400,
			'GitHub のリポジトリがまだ繋がっていません。\n' +
				'先に GitHub でリポジトリを作り、次を実行してください:\n' +
				'  git remote add origin https://github.com/<ユーザー名>/<リポジトリ名>.git',
		);
	}

	log.push(await git(['add', '-A']) || 'git add -A');

	const staged = await git(['diff', '--cached', '--name-only']);
	if (!staged) {
		return { ok: true, nothingToDo: true, log: ['変更はありませんでした'] };
	}
	log.push(`変更されたファイル:\n${staged}`);
	log.push(await git(['commit', '-m', message || '記事を更新']));

	try {
		log.push(await git(['push', '-u', 'origin', status.branch]));
	} catch (e) {
		throw new HttpError(500, `push に失敗しました:\n${e.message}`);
	}

	return { ok: true, log };
}

// -------------------------------------------------------------- dev サーバー

async function isDevServerUp() {
	try {
		const res = await fetch(DEV_ORIGIN, { signal: AbortSignal.timeout(1200) });
		return res.ok || res.status < 500;
	} catch {
		return false;
	}
}

async function ensureDevServer() {
	if (await isDevServerUp()) {
		console.log(`  Astro dev サーバー: 既に起動しています (${DEV_ORIGIN})`);
		return;
	}
	console.log('  Astro dev サーバーを起動します...');
	const child = spawn('npm', ['run', 'dev'], {
		cwd: ROOT,
		stdio: 'ignore',
		detached: false,
	});
	child.on('error', (e) => console.error('  dev サーバーの起動に失敗:', e.message));
	process.on('exit', () => child.kill());

	for (let i = 0; i < 40; i++) {
		await new Promise((r) => setTimeout(r, 500));
		if (await isDevServerUp()) {
			console.log(`  Astro dev サーバー: 起動しました (${DEV_ORIGIN})`);
			return;
		}
	}
	console.warn('  dev サーバーが応答しません。プレビューは表示されないかもしれません。');
}

// ------------------------------------------------------------------- HTTP

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.svg': 'image/svg+xml',
};

function sendJson(res, status, data) {
	const body = JSON.stringify(data);
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
	});
	res.end(body);
}

async function readBody(req, limit = 32 * 1024 * 1024) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > limit) throw new HttpError(413, 'ファイルが大きすぎます（上限 32MB）');
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

async function serveUi(res, pathname) {
	const rel = pathname === '/' ? 'index.html' : pathname.replace('/__editor/', '');
	const file = path.resolve(UI_DIR, rel);
	if (!file.startsWith(UI_DIR + path.sep)) {
		return sendJson(res, 403, { error: 'forbidden' });
	}
	try {
		const data = await fs.readFile(file);
		res.writeHead(200, {
			'content-type': MIME[path.extname(file)] || 'application/octet-stream',
			'cache-control': 'no-store',
		});
		res.end(data);
	} catch {
		res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
		res.end('not found');
	}
}

// Astro の dev サーバーへ中継する。
// プレビューをエディタと同じオリジンにするための仕組み。別オリジンの iframe は
// 読み込み直すと中身が白いままになることがあるため、ここを通して同一オリジンにする。
async function proxyToDev(req, res, url) {
	const target = `${DEV_ORIGIN}${url.pathname}${url.search}`;
	let upstream;
	try {
		upstream = await fetch(target, {
			method: req.method,
			headers: { accept: req.headers.accept || '*/*' },
			redirect: 'manual',
		});
	} catch {
		res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
		res.end(
			'<p style="font-family:system-ui;padding:2rem;color:#666">' +
				'Astro の dev サーバー(4321)に繋がりません。' +
				'</p>',
		);
		return;
	}

	const skip = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection']);
	const headers = {};
	for (const [k, v] of upstream.headers) {
		if (!skip.has(k.toLowerCase())) headers[k] = v;
	}
	headers['cache-control'] = 'no-store';
	res.writeHead(upstream.status, headers);
	res.end(Buffer.from(await upstream.arrayBuffer()));
}

async function handleApi(req, res, url) {
	const { pathname, searchParams } = url;
	const method = req.method;

	if (pathname === '/api/state' && method === 'GET') {
		return sendJson(res, 200, {
			posts: await listPosts(),
			pages: await listPages(),
			site: await readSite(),
			git: await gitStatus(),
			devOrigin: DEV_ORIGIN,
			postUrlPrefix: await postUrlPrefix(),
			liveOrigin: await readSiteUrl(),
			devUp: await isDevServerUp(),
			today: today(),
		});
	}

	// dev サーバーがその記事のページを返せる状態か確認する。
	// 新規作成直後は Astro がルートを作るまで少し遅れるので、画面側はこれを見て待つ。
	if (pathname === '/api/preview-ready' && method === 'GET') {
		const slug = searchParams.get('slug') || '';
		if (!SLUG_RE.test(slug)) return sendJson(res, 200, { ready: false });
		try {
			const r = await fetch(`${DEV_ORIGIN}${await postUrlPrefix()}/${slug}/`, {
				signal: AbortSignal.timeout(2000),
			});
			return sendJson(res, 200, { ready: r.ok });
		} catch {
			return sendJson(res, 200, { ready: false });
		}
	}

	const postMatch = /^\/api\/posts\/([^/]+)$/.exec(pathname);
	if (postMatch) {
		const slug = decodeURIComponent(postMatch[1]);
		if (method === 'GET') return sendJson(res, 200, await readPost(slug));
		if (method === 'PUT') {
			const payload = JSON.parse((await readBody(req)).toString('utf8'));
			return sendJson(res, 200, await writePost(slug, payload));
		}
		if (method === 'DELETE') return sendJson(res, 200, await deletePost(slug));
	}

	if (pathname === '/api/rename' && method === 'POST') {
		const { from, to } = JSON.parse((await readBody(req)).toString('utf8'));
		return sendJson(res, 200, await renamePost(from, to));
	}

	if (pathname === '/api/images' && method === 'POST') {
		const slug = searchParams.get('slug') || 'image';
		const ext = (searchParams.get('ext') || '').toLowerCase();
		const kind = searchParams.get('kind') === 'page' ? 'page' : 'post';
		return sendJson(res, 200, await saveImage(slug, ext, await readBody(req), kind));
	}

	const pageMatch = /^\/api\/pages\/([^/]+)$/.exec(pathname);
	if (pageMatch) {
		const name = decodeURIComponent(pageMatch[1]);
		if (method === 'GET') return sendJson(res, 200, await readPage(name));
		if (method === 'PUT') {
			const payload = JSON.parse((await readBody(req)).toString('utf8'));
			return sendJson(res, 200, await writePage(name, payload));
		}
	}

	if (pathname === '/api/site') {
		if (method === 'GET') return sendJson(res, 200, await readSite());
		if (method === 'PUT') {
			const payload = JSON.parse((await readBody(req)).toString('utf8'));
			return sendJson(res, 200, await writeSite(payload));
		}
	}

	if (pathname === '/api/banner' && method === 'POST') {
		const ext = (searchParams.get('ext') || '').toLowerCase();
		return sendJson(res, 200, await saveBanner(ext, await readBody(req)));
	}

	// エディタの画面で画像を小さく見せるためだけの口
	if (pathname === '/api/image-file' && method === 'GET') {
		const name = path.basename(searchParams.get('name') || '');
		const ext = path.extname(name).slice(1).toLowerCase();
		if (!IMAGE_EXT.has(ext)) throw new HttpError(400, '画像ではありません');
		let buf = null;
		for (const dir of [IMAGES_DIR, PAGE_IMAGES_DIR, EMBED_DIR]) {
			buf = await fs.readFile(path.join(dir, name)).catch(() => null);
			if (buf) break;
		}
		if (!buf) throw new HttpError(404, '画像が見つかりません');
		res.writeHead(200, { 'content-type': `image/${ext}`, 'cache-control': 'no-store' });
		return res.end(buf);
	}

	// テンプレートの <figure> など、生の HTML から参照する画像用
	if (pathname === '/api/public-image' && method === 'POST') {
		const slug = searchParams.get('slug') || 'embed';
		const ext = (searchParams.get('ext') || '').toLowerCase();
		return sendJson(res, 200, await saveEmbedAsset(slug, ext, await readBody(req)));
	}

	if (pathname === '/api/images' && method === 'GET') {
		return sendJson(res, 200, await imageInventory());
	}

	if (pathname === '/api/images/unused' && method === 'DELETE') {
		return sendJson(res, 200, await deleteUnusedImages());
	}

	if (pathname === '/api/changes' && method === 'GET') {
		return sendJson(res, 200, await pendingChanges());
	}

	if (pathname === '/api/deploy' && method === 'GET') {
		return sendJson(res, 200, await deployStatus());
	}

	if (pathname === '/api/embed' && method === 'GET') {
		const slug = searchParams.get('slug') || 'embed';
		const target = searchParams.get('url') || '';
		return sendJson(res, 200, await buildEmbed(slug, target));
	}

	if (pathname === '/api/publish' && method === 'POST') {
		const { message } = JSON.parse((await readBody(req)).toString('utf8'));
		return sendJson(res, 200, await gitPublish(message));
	}

	throw new HttpError(404, 'そのAPIはありません');
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url, `http://127.0.0.1:${EDITOR_PORT}`);
	try {
		if (url.pathname.startsWith('/api/')) {
			await handleApi(req, res, url);
		} else if (url.pathname === '/' || url.pathname.startsWith('/__editor/')) {
			await serveUi(res, url.pathname);
		} else {
			await proxyToDev(req, res, url);
		}
	} catch (err) {
		const status = err instanceof HttpError ? err.status : 500;
		if (status === 500) console.error(err);
		sendJson(res, status, { error: err.message });
	}
});

server.listen(EDITOR_PORT, '127.0.0.1', async () => {
	console.log('');
	console.log('  ブログエディタ');
	console.log(`  → http://127.0.0.1:${EDITOR_PORT}`);
	console.log('');
	await ensureDevServer();
	console.log('');
	console.log('  終了するには Ctrl+C');
});
