// このブログ専用の VS Code 拡張。
//
// Web のエディタ（tools/editor）が持っていた機能のうち、VS Code に無いものだけを足す。
//   - 新しい記事（スラッグと frontmatter の雛形）
//   - 公開する（git add → commit → push、下書きの確認つき）
//   - 画像の貼り付けを横取りして 1600px に縮小してから保存
//   - 実際のサイトのプレビュー（Simple Browser）
//   - tags: 行でのタグ補完
//
// frontmatter の読み書きは tools/editor/server.mjs にも同じものがある。
// 拡張はフォルダごとコピーしても動く必要があるため、あえて共有していない。
// 書式を変えるときは両方直すこと。

const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const POSTS_DIR = path.join('src', 'content', 'blog');
const IMAGES_DIR = path.join(POSTS_DIR, 'images');
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

// ------------------------------------------------------------------ 小道具

const pad = (n) => String(n).padStart(2, '0');

function today() {
	const d = new Date();
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timestampSlug() {
	const d = new Date();
	return `post-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function exists(p) {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

/** ブログのルート（src/content/blog を持つワークスペースフォルダ）を探す */
async function findRoot() {
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		if (await exists(path.join(folder.uri.fsPath, POSTS_DIR))) return folder.uri.fsPath;
	}
	return null;
}

/** いま開いているファイルが記事なら、そのパスとスラッグを返す */
function activePost(root) {
	const doc = vscode.window.activeTextEditor?.document;
	if (!doc || doc.uri.scheme !== 'file') return null;
	const file = doc.uri.fsPath;
	const dir = path.join(root, POSTS_DIR);
	if (path.dirname(file) !== dir || !/\.mdx?$/.test(file)) return null;
	return { doc, file, slug: path.basename(file).replace(/\.mdx?$/, '') };
}

// ------------------------------------------------------------- frontmatter

function parseScalar(raw) {
	const v = raw.trim();
	if (v === 'true') return true;
	if (v === 'false') return false;
	if (v.startsWith('[') && v.endsWith(']')) {
		return v
			.slice(1, -1)
			.split(',')
			.map((s) => s.trim().replace(/^['"]|['"]$/g, "").replace(/''/g, "'"))
			.filter(Boolean);
	}
	if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
	if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\"/g, '"');
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

const yamlString = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;

// ------------------------------------------------------------------- git

async function git(root, args) {
	const { stdout } = await execFileAsync('git', args, { cwd: root, maxBuffer: 8 * 1024 * 1024 });
	return stdout.trim();
}

async function changedCount(root) {
	try {
		const out = await git(root, ['status', '--porcelain']);
		return out ? out.split('\n').length : 0;
	} catch {
		return 0;
	}
}

// ---------------------------------------------------------------- 画像

/** sips は macOS 標準。拡張に native モジュールを抱えないためにこれを使う。 */
async function imageWidth(file) {
	try {
		const { stdout } = await execFileAsync('sips', ['-g', 'pixelWidth', file]);
		const m = /pixelWidth:\s*(\d+)/.exec(stdout);
		return m ? Number(m[1]) : 0;
	} catch {
		return 0;
	}
}

/**
 * 画像を src/content/blog/images/ に保存する。幅が大きすぎるものはその場で縮める。
 * 本文の表示幅は 720px なので、スマホの写真をそのまま入れるとリポジトリが重くなるだけ。
 */
async function saveImage(root, slug, ext, bytes) {
	if (!IMAGE_EXT.has(ext)) throw new Error(`対応していない画像形式です: ${ext}`);
	const safeSlug = SLUG_RE.test(slug) ? slug : 'image';
	const name = `${safeSlug}-${Date.now()}.${ext}`;
	const dir = path.join(root, IMAGES_DIR);
	await fs.mkdir(dir, { recursive: true });
	const file = path.join(dir, name);
	await fs.writeFile(file, bytes);

	const max = vscode.workspace.getConfiguration('blog').get('maxImageWidth', 1600);
	let resized = null;
	// アニメーション GIF は sips を通すと壊れるので触らない
	if (max > 0 && ext !== 'gif') {
		const before = await imageWidth(file);
		if (before > max) {
			try {
				await execFileAsync('sips', ['--resampleWidth', String(max), file]);
				resized = { before, after: max };
			} catch {
				// 縮小できなくても、元のサイズのまま進める
			}
		}
	}
	return { name, markdownPath: `./images/${name}`, resized };
}

function extFromMime(mime, fallbackName = '') {
	const fromName = path.extname(fallbackName).slice(1).toLowerCase();
	if (IMAGE_EXT.has(fromName)) return fromName;
	const m = /^image\/([a-z0-9.+-]+)$/.exec(mime || '');
	if (!m) return '';
	return IMAGE_EXT.has(m[1]) ? m[1] : '';
}

// ------------------------------------------------------------- コマンド

async function newPost(root) {
	const title = await vscode.window.showInputBox({
		prompt: '記事のタイトル',
		value: '無題の記事',
		valueSelection: [0, 5],
	});
	if (title === undefined) return;

	const slug = timestampSlug();
	const file = path.join(root, POSTS_DIR, `${slug}.md`);
	if (await exists(file)) {
		vscode.window.showErrorMessage(`${slug}.md はすでにあります。1分おいてからもう一度。`);
		return;
	}
	const text =
		['---', `title: ${yamlString(title || '無題の記事')}`, "description: ''", `pubDate: ${yamlString(today())}`, 'draft: true', '---', '', ''].join('\n');
	await fs.writeFile(file, text, 'utf8');

	const doc = await vscode.workspace.openTextDocument(file);
	const editor = await vscode.window.showTextDocument(doc);
	const end = doc.lineAt(doc.lineCount - 1).range.end;
	editor.selection = new vscode.Selection(end, end);
}

async function toggleDraft(root, { silent = false } = {}) {
	const post = activePost(root);
	if (!post) {
		if (!silent) vscode.window.showWarningMessage('記事を開いてから実行してください。');
		return null;
	}
	const { data } = parsePost(post.doc.getText());
	const isDraft = data.draft === true;
	const edit = new vscode.WorkspaceEdit();

	if (isDraft) {
		// draft: true の行ごと消す
		for (let i = 0; i < post.doc.lineCount; i++) {
			const line = post.doc.lineAt(i);
			if (/^draft:\s*true\s*$/.test(line.text)) {
				edit.delete(post.doc.uri, line.rangeIncludingLineBreak);
				break;
			}
		}
	} else {
		// 閉じの --- の直前に入れる
		let close = -1;
		for (let i = 1; i < post.doc.lineCount; i++) {
			if (post.doc.lineAt(i).text.trim() === '---') {
				close = i;
				break;
			}
		}
		if (close === -1) {
			vscode.window.showErrorMessage('frontmatter が見つかりません。');
			return null;
		}
		edit.insert(post.doc.uri, new vscode.Position(close, 0), 'draft: true\n');
	}

	await vscode.workspace.applyEdit(edit);
	await post.doc.save();
	if (!silent) {
		vscode.window.showInformationMessage(isDraft ? '下書きを解除しました。' : '下書きに戻しました。');
	}
	return !isDraft;
}

async function publish(root) {
	// 開いている記事が下書きなら、送る前に聞く。
	// 下書きはコミットされても公開サイトには出ないため、黙って進むと「公開したのに出ない」になる。
	const post = activePost(root);
	if (post) {
		const { data } = parsePost(post.doc.getText());
		if (data.draft === true) {
			const choice = await vscode.window.showWarningMessage(
				`「${data.title || post.slug}」は下書きです。`,
				{
					modal: true,
					detail:
						'このまま進めると変更は GitHub に送られますが、公開サイトには表示されません。\n' +
						'サイトに出すには下書きを解除する必要があります。',
				},
				'下書きを解除して公開',
				'下書きのまま送る',
			);
			if (!choice) return;
			if (choice === '下書きを解除して公開') await toggleDraft(root, { silent: true });
		}
	}

	await vscode.workspace.saveAll(false);

	try {
		await git(root, ['remote', 'get-url', 'origin']);
	} catch {
		vscode.window.showErrorMessage(
			'GitHub のリポジトリが繋がっていません。git remote add origin ... を先に実行してください。',
		);
		return;
	}

	const title = post ? parsePost(post.doc.getText()).data.title : '';
	const message = await vscode.window.showInputBox({
		prompt: 'コミットメッセージ',
		value: title ? `記事を更新: ${title}` : '記事を更新',
	});
	if (message === undefined) return;

	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: '公開しています' },
		async (progress) => {
			try {
				progress.report({ message: '変更をまとめています' });
				await git(root, ['add', '-A']);
				const staged = await git(root, ['diff', '--cached', '--name-only']);
				if (!staged) {
					vscode.window.showInformationMessage('変更はありませんでした。');
					return;
				}

				progress.report({ message: 'コミットしています' });
				await git(root, ['commit', '-m', message || '記事を更新']);

				progress.report({ message: 'push しています' });
				const branch = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
				await git(root, ['push', '-u', 'origin', branch]);

				const files = staged.split('\n').length;
				vscode.window.showInformationMessage(
					`公開しました（${files}ファイル）。1〜2分でサイトに反映されます。`,
				);
			} catch (e) {
				vscode.window.showErrorMessage(`公開できませんでした: ${e.message}`);
			}
		},
	);
}

async function insertImage(root) {
	const editor = vscode.window.activeTextEditor;
	const post = activePost(root);
	if (!editor || !post) {
		vscode.window.showWarningMessage('記事を開いてから実行してください。');
		return;
	}
	const picked = await vscode.window.showOpenDialog({
		canSelectMany: false,
		openLabel: '挿入',
		filters: { 画像: [...IMAGE_EXT] },
	});
	if (!picked?.length) return;

	const src = picked[0].fsPath;
	const ext = path.extname(src).slice(1).toLowerCase();
	const saved = await saveImage(root, post.slug, ext, await fs.readFile(src));
	await editor.edit((b) => b.replace(editor.selection, `![](${saved.markdownPath})`));
	if (saved.resized) {
		vscode.window.showInformationMessage(
			`画像を ${saved.resized.before}px から ${saved.resized.after}px に縮小しました。`,
		);
	}
}

/** dev サーバーが応答するか */
async function devServerUp(url) {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(1200) });
		return res.ok || res.status < 500;
	} catch {
		return false;
	}
}

/** astro.config.mjs の base を読む。URL に /blog/ が挟まるため。 */
async function readBase(root) {
	try {
		const conf = await fs.readFile(path.join(root, 'astro.config.mjs'), 'utf8');
		const m = /^\s*base:\s*['"]([^'"]+)['"]/m.exec(conf);
		return m ? `/${m[1].replace(/^\/+|\/+$/g, '')}` : '';
	} catch {
		return '';
	}
}

async function preview(root) {
	const origin = vscode.workspace.getConfiguration('blog').get('devServerUrl', 'http://localhost:4321');

	if (!(await devServerUp(origin))) {
		const start = await vscode.window.showInformationMessage(
			'Astro の dev サーバーが動いていません。起動しますか？',
			'起動する',
		);
		if (start !== '起動する') return;

		const term =
			vscode.window.terminals.find((t) => t.name === 'astro dev') ??
			vscode.window.createTerminal({ name: 'astro dev', cwd: root });
		term.sendText('npm run dev');

		const ok = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'dev サーバーの起動を待っています' },
			async () => {
				for (let i = 0; i < 30; i++) {
					if (await devServerUp(origin)) return true;
					await new Promise((r) => setTimeout(r, 1000));
				}
				return false;
			},
		);
		if (!ok) {
			term.show();
			vscode.window.showErrorMessage('起動を確認できませんでした。ターミナルのログを見てください。');
			return;
		}
	}

	const post = activePost(root);
	const base = await readBase(root);
	const url = post ? `${origin}${base}/posts/${post.slug}/` : `${origin}${base}/`;
	await vscode.commands.executeCommand('simpleBrowser.show', url);
}

// --------------------------------- 貼り付け / ドロップした画像の横取り

const IMAGE_KIND_PARTS = ['markdown', 'link', 'image'];
const IMAGE_MIME_TYPES = ['image/*', 'files'];

/**
 * 受け取った画像を images/ に保存して、挿入する Markdown を返す。
 * 記事のフォルダ以外、画像以外のときは null。
 */
async function imageFromDataTransfer(root, document, dataTransfer, token) {
	if (!root) return null;
	if (path.dirname(document.uri.fsPath) !== path.join(root, POSTS_DIR)) return null;

	for (const [mime, item] of dataTransfer) {
		const file = item.asFile();
		if (!file) continue;
		const ext = extFromMime(mime, file.name);
		if (!ext) continue;

		const bytes = await file.data();
		if (token.isCancellationRequested) return null;

		const slug = path.basename(document.uri.fsPath).replace(/\.mdx?$/, '');
		const saved = await saveImage(root, slug, ext, Buffer.from(bytes));
		if (saved.resized) {
			vscode.window.setStatusBarMessage(
				`画像を ${saved.resized.before}px → ${saved.resized.after}px に縮小しました`,
				4000,
			);
		}
		return `![](${saved.markdownPath})`;
	}
	return null;
}

function makePasteProvider(getRoot) {
	return {
		async provideDocumentPasteEdits(document, _ranges, dataTransfer, _context, token) {
			const md = await imageFromDataTransfer(await getRoot(), document, dataTransfer, token);
			if (!md) return;
			return [
				new vscode.DocumentPasteEdit(
					md,
					'画像を保存して挿入',
					vscode.DocumentDropOrPasteEditKind.Empty.append(...IMAGE_KIND_PARTS),
				),
			];
		},
	};
}

function makeDropProvider(getRoot) {
	return {
		async provideDocumentDropEdits(document, _position, dataTransfer, token) {
			const md = await imageFromDataTransfer(await getRoot(), document, dataTransfer, token);
			if (!md) return;
			return new vscode.DocumentDropEdit(
				md,
				'画像を保存して挿入',
				vscode.DocumentDropOrPasteEditKind.Empty.append(...IMAGE_KIND_PARTS),
			);
		},
	};
}

// ------------------------------------------------------------- タグ補完

function makeTagProvider(getRoot) {
	return {
		async provideCompletionItems(document, position) {
			const root = await getRoot();
			if (!root) return;
			const line = document.lineAt(position.line).text;
			if (!/^tags:/.test(line)) return;

			const dir = path.join(root, POSTS_DIR);
			const names = (await fs.readdir(dir)).filter((n) => /\.mdx?$/.test(n));
			const counts = new Map();
			for (const name of names) {
				const { data } = parsePost(await fs.readFile(path.join(dir, name), 'utf8'));
				for (const tag of Array.isArray(data.tags) ? data.tags : []) {
					counts.set(tag, (counts.get(tag) ?? 0) + 1);
				}
			}
			return [...counts.entries()]
				.sort((a, b) => b[1] - a[1])
				.map(([tag, count]) => {
					const item = new vscode.CompletionItem(tag, vscode.CompletionItemKind.Keyword);
					item.detail = `${count}件の記事`;
					item.insertText = `'${tag.replace(/'/g, "''")}'`;
					return item;
				});
		},
	};
}

// ------------------------------------------------------------------ 起動

async function activate(context) {
	let root = await findRoot();
	if (!root) return;
	const getRoot = async () => root ?? (root = await findRoot());

	await vscode.commands.executeCommand('setContext', 'blog.isBlogWorkspace', true);

	const run = (fn) => async () => {
		try {
			await fn(await getRoot());
		} catch (e) {
			vscode.window.showErrorMessage(e.message);
		}
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('blog.newPost', run(newPost)),
		vscode.commands.registerCommand('blog.publish', run(publish)),
		vscode.commands.registerCommand('blog.insertImage', run(insertImage)),
		vscode.commands.registerCommand('blog.preview', run(preview)),
		vscode.commands.registerCommand('blog.toggleDraft', run(toggleDraft)),
	);

	context.subscriptions.push(
		vscode.languages.registerDocumentPasteEditProvider(
			{ language: 'markdown', scheme: 'file' },
			makePasteProvider(getRoot),
			{
				providedPasteEditKinds: [
					vscode.DocumentDropOrPasteEditKind.Empty.append(...IMAGE_KIND_PARTS),
				],
				pasteMimeTypes: IMAGE_MIME_TYPES,
			},
		),
		vscode.languages.registerDocumentDropEditProvider(
			{ language: 'markdown', scheme: 'file' },
			makeDropProvider(getRoot),
			{
				providedDropEditKinds: [
					vscode.DocumentDropOrPasteEditKind.Empty.append(...IMAGE_KIND_PARTS),
				],
				dropMimeTypes: IMAGE_MIME_TYPES,
			},
		),
		vscode.languages.registerCompletionItemProvider(
			{ language: 'markdown', scheme: 'file' },
			makeTagProvider(getRoot),
			' ',
			"'",
			',',
		),
	);

	// 未公開の変更をステータスバーに出す。Web のエディタにあった表示の代わり。
	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	status.command = 'blog.publish';
	context.subscriptions.push(status);

	const refresh = async () => {
		const n = await changedCount(root);
		status.text = n > 0 ? `$(cloud-upload) 公開 ${n}` : '$(check) 公開済み';
		status.tooltip = n > 0 ? `未公開の変更が ${n} 件あります` : '未公開の変更はありません';
		status.show();
	};
	await refresh();
	const timer = setInterval(refresh, 15000);
	context.subscriptions.push(
		{ dispose: () => clearInterval(timer) },
		vscode.workspace.onDidSaveTextDocument(refresh),
	);
}

function deactivate() {}

module.exports = { activate, deactivate };
