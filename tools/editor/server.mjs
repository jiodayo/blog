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

function parseScalar(raw) {
	const v = raw.trim();
	if (v === 'true') return true;
	if (v === 'false') return false;
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

async function saveImage(slug, ext, buffer) {
	if (!IMAGE_EXT.has(ext)) throw new HttpError(400, `対応していない画像形式です: ${ext}`);
	const safeSlug = SLUG_RE.test(slug) ? slug : 'image';
	const name = `${safeSlug}-${Date.now()}.${ext}`;
	await fs.mkdir(IMAGES_DIR, { recursive: true });
	await fs.writeFile(path.join(IMAGES_DIR, name), buffer);
	// 記事からの相対パス。Astro が最適化してくれる
	return { markdownPath: `./images/${name}` };
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
			git: await gitStatus(),
			devOrigin: DEV_ORIGIN,
			postUrlPrefix: await postUrlPrefix(),
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
		return sendJson(res, 200, await saveImage(slug, ext, await readBody(req)));
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
