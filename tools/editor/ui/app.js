// ブログエディタの画面側。フレームワークなし。

const $ = (id) => document.getElementById(id);

const el = {
	saveState: $('save-state'),
	gitState: $('git-state'),
	publish: $('btn-publish'),
	newPost: $('btn-new'),
	list: $('post-list'),
	editor: $('editor'),
	title: $('f-title'),
	description: $('f-description'),
	pubDate: $('f-pubDate'),
	updatedDate: $('f-updatedDate'),
	slug: $('f-slug'),
	draft: $('f-draft'),
	body: $('f-body'),
	toolbar: $('toolbar'),
	image: $('btn-image'),
	fileInput: $('file-input'),
	delete: $('btn-delete'),
	frame: $('preview-frame'),
	previewUrl: $('preview-url'),
	previewEmpty: $('preview-empty'),
	reload: $('btn-reload'),
	modal: $('modal'),
	modalTitle: $('modal-title'),
	modalLog: $('modal-log'),
	modalActions: $('modal-actions'),
	hint: $('toolbar-hint'),
};

const state = {
	posts: [],
	devOrigin: 'http://localhost:4321',
	postUrlPrefix: '/posts',
	current: null, // 開いている記事のスラッグ
	saveTimer: null,
	saving: false,
};

// ------------------------------------------------------------------- 通信

async function api(path, options = {}) {
	const res = await fetch(path, options);
	const text = await res.text();
	const data = text ? JSON.parse(text) : {};
	if (!res.ok) throw new Error(data.error || `通信に失敗しました (${res.status})`);
	return data;
}

async function refreshState() {
	const data = await api('/api/state');
	state.posts = data.posts;
	state.devOrigin = data.devOrigin;
	state.postUrlPrefix = data.postUrlPrefix ?? '/posts';
	state.today = data.today;
	// 一覧は中身が変わったときだけ描き直す。
	// 毎回作り直すと、クリックしようとしている要素が入れ替わってしまう。
	const signature = JSON.stringify([data.posts, state.current]);
	if (signature !== state.listSignature) {
		state.listSignature = signature;
		renderList();
	}
	renderGit(data.git, data.devUp);
	return data;
}

// ------------------------------------------------------------------- 表示

const escapeHtml = (s) =>
	String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function renderList() {
	el.list.innerHTML = state.posts
		.map(
			(p) => `
			<li data-slug="${escapeHtml(p.slug)}" class="${p.slug === state.current ? 'active' : ''}">
				<span class="pt">${escapeHtml(p.title)}${p.draft ? '<span class="badge">下書き</span>' : ''}</span>
				<span class="pd">${escapeHtml(p.pubDate)}${p.readOnly ? ' · .mdx' : ''}</span>
			</li>`,
		)
		.join('');
}

function renderGit(git, devUp) {
	if (!git) return;
	const bits = [];
	if (git.branch) bits.push(git.branch);
	bits.push(git.changed > 0 ? `未公開の変更 ${git.changed}` : '変更なし');
	if (!git.remote) bits.push('リモート未設定');
	el.gitState.textContent = bits.join(' · ');
	el.gitState.className = `pill ${git.changed > 0 ? 'warn' : 'ok'}`;
	el.publish.disabled = git.changed === 0;

	if (devUp === false) {
		el.previewEmpty.hidden = false;
		el.previewEmpty.textContent =
			'Astro の dev サーバー(4321)が動いていません。別のターミナルで npm run dev を実行してください。';
	}
}

function setSaveState(text, cls = '') {
	el.saveState.textContent = text;
	el.saveState.className = `pill ${cls}`;
}

// --------------------------------------------------------------- 記事の操作

function formValues() {
	return {
		title: el.title.value,
		description: el.description.value,
		pubDate: el.pubDate.value,
		updatedDate: el.updatedDate.value,
		draft: el.draft.checked,
		body: el.body.value,
	};
}

async function openPost(slug) {
	await flushSave();
	const post = await api(`/api/posts/${encodeURIComponent(slug)}`);
	state.current = slug;
	el.title.value = post.title;
	el.description.value = post.description;
	el.pubDate.value = post.pubDate;
	el.updatedDate.value = post.updatedDate;
	el.slug.value = post.slug;
	el.draft.checked = post.draft;
	el.body.value = post.body;
	el.editor.hidden = false;
	state.listSignature = JSON.stringify([state.posts, state.current]);
	renderList();
	setSaveState('保存済み', 'ok');
	updatePreview();
}

function scheduleSave() {
	setSaveState('編集中…');
	clearTimeout(state.saveTimer);
	state.saveTimer = setTimeout(() => {
		state.saveTimer = null;
		save();
	}, 700);
}

/**
 * 保留中の変更があるときだけ保存する。
 * 無条件に保存すると、記事を切り替えたりページを離れたりするたびに
 * 書き戻しが起きて、消したはずのファイルが復活してしまう。
 */
async function flushSave() {
	if (!state.saveTimer) return;
	clearTimeout(state.saveTimer);
	state.saveTimer = null;
	await save();
}

async function save() {
	if (!state.current || state.saving) return;
	state.saving = true;
	try {
		setSaveState('保存中…');
		await api(`/api/posts/${encodeURIComponent(state.current)}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(formValues()),
		});
		setSaveState('保存済み', 'ok');
		await refreshState();
		reloadPreview();
	} catch (e) {
		setSaveState(`保存できません: ${e.message}`, 'warn');
	} finally {
		state.saving = false;
	}
}

async function applySlugChange() {
	const next = el.slug.value.trim();
	if (!next || next === state.current) return;
	try {
		await flushSave();
		await api('/api/rename', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ from: state.current, to: next }),
		});
		state.current = next;
		await refreshState();
		updatePreview();
		setSaveState('保存済み', 'ok');
	} catch (e) {
		alert(e.message);
		el.slug.value = state.current;
	}
}

async function createPost() {
	await flushSave();
	const now = new Date();
	const p = (n) => String(n).padStart(2, '0');
	const slug = `post-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
	await api(`/api/posts/${slug}`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			title: '無題の記事',
			description: '',
			pubDate: state.today,
			draft: true,
			body: '',
		}),
	});
	await refreshState();
	await openPost(slug);
	el.title.select();
}

async function deletePost() {
	if (!state.current) return;
	if (!confirm(`「${el.title.value}」を削除します。元に戻せません。よろしいですか？`)) return;
	clearTimeout(state.saveTimer);
	await api(`/api/posts/${encodeURIComponent(state.current)}`, { method: 'DELETE' });
	state.current = null;
	el.editor.hidden = true;
	el.previewEmpty.hidden = false;
	await refreshState();
}

// --------------------------------------------------------------- プレビュー

let previewToken = 0;

/**
 * dev サーバーがそのページを返せる状態になってから iframe に読み込む。
 * 新規作成の直後は Astro がルートを用意するまで数秒かかることがあるので、
 * 決め打ちで待たずにサーバーに確認する。
 */
async function updatePreview({ wait = true } = {}) {
	if (!state.current) return;
	const slug = state.current;
	const token = ++previewToken;
	// 表示用のラベルは本物の dev サーバーのURL、iframe は同一オリジンの中継経由
	const postPath = `${state.postUrlPrefix}/${slug}/`;
	el.previewUrl.textContent = `${state.devOrigin}${postPath}`;

	if (wait) {
		for (let i = 0; i < 20; i++) {
			const { ready } = await api(
				`/api/preview-ready?slug=${encodeURIComponent(slug)}`,
			).catch(() => ({ ready: false }));
			if (token !== previewToken) return; // 別の記事に切り替わった
			if (ready) break;
			await new Promise((r) => setTimeout(r, 400));
		}
	}
	if (token !== previewToken) return;
	swapFrame(`${postPath}?t=${Date.now()}`);
	el.previewEmpty.hidden = true;
}

/**
 * iframe は src を貼り替えると白いままになることがあるので、
 * 要素ごと新しく作って差し替える。
 */
function swapFrame(url) {
	const next = document.createElement('iframe');
	next.id = 'preview-frame';
	next.title = 'プレビュー';
	next.src = url;
	el.frame.replaceWith(next);
	el.frame = next;
}

let reloadTimer = null;
function reloadPreview() {
	clearTimeout(reloadTimer);
	// Astro がファイルの変更を拾うまで少し待つ
	reloadTimer = setTimeout(() => updatePreview({ wait: false }), 600);
}

// ----------------------------------------------------------- Markdown 補助

function surround(before, after = before) {
	const ta = el.body;
	const { selectionStart: s, selectionEnd: e, value } = ta;
	const sel = value.slice(s, e);
	ta.value = value.slice(0, s) + before + sel + after + value.slice(e);
	ta.selectionStart = s + before.length;
	ta.selectionEnd = s + before.length + sel.length;
	ta.focus();
	scheduleSave();
}

function prefixLines(prefix) {
	const ta = el.body;
	const { selectionStart: s, selectionEnd: e, value } = ta;
	const start = value.lastIndexOf('\n', s - 1) + 1;
	const end = value.indexOf('\n', e) === -1 ? value.length : value.indexOf('\n', e);
	const block = value.slice(start, end);
	const numbered = prefix === '1. ';
	const next = block
		.split('\n')
		.map((line, i) => (numbered ? `${i + 1}. ` : prefix) + line.replace(/^([#>-]+ |\d+\. )/, ''))
		.join('\n');
	ta.value = value.slice(0, start) + next + value.slice(end);
	ta.selectionStart = start;
	ta.selectionEnd = start + next.length;
	ta.focus();
	scheduleSave();
}

function insertAtCursor(text) {
	const ta = el.body;
	const { selectionStart: s, selectionEnd: e, value } = ta;
	ta.value = value.slice(0, s) + text + value.slice(e);
	ta.selectionStart = ta.selectionEnd = s + text.length;
	ta.focus();
	scheduleSave();
}

const MD_ACTIONS = {
	h2: () => prefixLines('## '),
	h3: () => prefixLines('### '),
	bold: () => surround('**'),
	italic: () => surround('*'),
	code: () => surround('\n```\n', '\n```\n'),
	quote: () => prefixLines('> '),
	ul: () => prefixLines('- '),
	ol: () => prefixLines('1. '),
	link: () => {
		const url = prompt('リンク先のURL', 'https://');
		if (!url) return;
		const ta = el.body;
		const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd) || 'リンクのテキスト';
		insertAtCursor(`[${sel}](${url})`);
	},
};

// ------------------------------------------------------------------- 画像

const HINT_DEFAULT = '画像はエディタに貼り付け／ドロップでも入ります';
let hintTimer = null;

/** ツールバーの注記欄に一時的なメッセージを出す */
function flashHint(text) {
	el.hint.textContent = text;
	clearTimeout(hintTimer);
	hintTimer = setTimeout(() => {
		el.hint.textContent = HINT_DEFAULT;
	}, 8000);
}

const fmtBytes = (n) =>
	n >= 1024 * 1024 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;

async function uploadImage(file) {
	const ext = (file.name.split('.').pop() || 'png').toLowerCase();
	setSaveState('画像を保存中…');
	const r = await api(
		`/api/images?slug=${encodeURIComponent(state.current || 'image')}&ext=${encodeURIComponent(ext)}`,
		{ method: 'POST', body: file },
	);
	insertAtCursor(`\n![](${r.markdownPath})\n`);
	if (r.resized) {
		flashHint(
			`画像を縮小しました: ${r.widthBefore}px → ${r.width}px` +
				`（${fmtBytes(r.bytesBefore)} → ${fmtBytes(r.bytesAfter)}）`,
		);
	}
}

async function handleFiles(files) {
	for (const file of files) {
		if (file.type.startsWith('image/')) {
			try {
				await uploadImage(file);
			} catch (e) {
				alert(`画像を保存できませんでした: ${e.message}`);
			}
		}
	}
}

// ------------------------------------------------------------------- 公開

async function publish() {
	await flushSave();

	// 下書きのまま公開すると、コミットと push はされるのにサイトには何も出ない。
	// 成功したように見えて何も起きないので、ここで必ず確認する。
	if (state.current && el.draft.checked) {
		const choice = await showChoice(
			'この記事は下書きです',
			'このまま進めると、変更は GitHub に送られますが、公開サイトには表示されません。\n' +
				'サイトに出すには下書きを解除する必要があります。',
			[
				{ value: 'publish', label: '下書きを解除して公開', primary: true },
				{ value: 'keep', label: '下書きのまま送る' },
				{ value: 'cancel', label: 'やめる' },
			],
		);
		if (choice === null || choice === 'cancel') return;
		if (choice === 'publish') {
			el.draft.checked = false;
			scheduleSave();
			await flushSave();
		}
	}

	const title = el.title.value || '記事';
	const message = prompt('コミットメッセージ', `記事を更新: ${title}`);
	if (message === null) return;

	el.publish.disabled = true;
	showModal('公開中…', 'git add / commit / push を実行しています…');
	try {
		const result = await api('/api/publish', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ message }),
		});
		if (result.nothingToDo) {
			showModal('公開', '変更がありませんでした。');
		} else {
			showModal(
				'公開しました',
				`${result.log.filter(Boolean).join('\n\n')}\n\n` +
					'GitHub Actions のビルドが終わると1〜2分でサイトに反映されます。',
			);
		}
	} catch (e) {
		showModal('公開できませんでした', e.message);
	} finally {
		await refreshState();
	}
}

function showModal(title, log) {
	return showChoice(title, log, [{ value: null, label: '閉じる', primary: true }]);
}

/**
 * ボタン付きのモーダルを出し、押された value で解決する Promise を返す。
 * 背景クリックと Esc は null（＝やめる）扱い。
 */
function showChoice(title, log, choices) {
	el.modalTitle.textContent = title;
	el.modalLog.textContent = log;
	el.modalActions.innerHTML = '';
	el.modal.hidden = false;

	return new Promise((resolve) => {
		const done = (value) => {
			el.modal.hidden = true;
			el.modal.removeEventListener('click', onBackdrop);
			document.removeEventListener('keydown', onKey);
			resolve(value);
		};
		const onBackdrop = (e) => {
			if (e.target === el.modal) done(null);
		};
		const onKey = (e) => {
			if (e.key === 'Escape') done(null);
		};

		for (const c of choices) {
			const b = document.createElement('button');
			b.className = `btn${c.primary ? ' btn-primary' : ''}`;
			b.textContent = c.label;
			b.addEventListener('click', () => done(c.value));
			el.modalActions.append(b);
		}
		// フォーカスは「やめる」側（最後のボタン）に当てる。
		// 最初のボタンに当てると、Enter を押しただけで公開まで走ってしまう。
		// 見た目の強調（btn-primary）と、キーボードの既定動作は別にする。
		const buttons = el.modalActions.querySelectorAll('button');
		buttons[buttons.length - 1]?.focus();
		el.modal.addEventListener('click', onBackdrop);
		document.addEventListener('keydown', onKey);
	});
}

// ------------------------------------------------------------- イベント登録

el.list.addEventListener('click', (e) => {
	const li = e.target.closest('li[data-slug]');
	if (li) openPost(li.dataset.slug).catch((err) => alert(err.message));
});

for (const node of [el.title, el.description, el.pubDate, el.updatedDate, el.draft, el.body]) {
	node.addEventListener('input', scheduleSave);
	node.addEventListener('change', scheduleSave);
}
el.slug.addEventListener('change', applySlugChange);

el.newPost.addEventListener('click', () => createPost().catch((e) => alert(e.message)));
el.delete.addEventListener('click', () => deletePost().catch((e) => alert(e.message)));
el.publish.addEventListener('click', () => publish());
el.reload.addEventListener('click', () => updatePreview());

el.toolbar.addEventListener('click', (e) => {
	const action = e.target.closest('button[data-md]')?.dataset.md;
	if (action && MD_ACTIONS[action]) MD_ACTIONS[action]();
});

el.image.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => {
	handleFiles(el.fileInput.files);
	el.fileInput.value = '';
});

el.body.addEventListener('paste', (e) => {
	const files = [...(e.clipboardData?.files || [])];
	if (files.length) {
		e.preventDefault();
		handleFiles(files);
	}
});
el.body.addEventListener('dragover', (e) => e.preventDefault());
el.body.addEventListener('drop', (e) => {
	if (e.dataTransfer?.files?.length) {
		e.preventDefault();
		handleFiles(e.dataTransfer.files);
	}
});

// Tab でインデント、⌘S で保存、⌘B/⌘I/⌘K
el.body.addEventListener('keydown', (e) => {
	if (e.key === 'Tab') {
		e.preventDefault();
		insertAtCursor('\t');
	}
});
document.addEventListener('keydown', (e) => {
	if (!(e.metaKey || e.ctrlKey)) return;
	const key = e.key.toLowerCase();
	if (key === 's') {
		e.preventDefault();
		flushSave();
	} else if (key === 'b' && document.activeElement === el.body) {
		e.preventDefault();
		MD_ACTIONS.bold();
	} else if (key === 'i' && document.activeElement === el.body) {
		e.preventDefault();
		MD_ACTIONS.italic();
	} else if (key === 'k' && document.activeElement === el.body) {
		e.preventDefault();
		MD_ACTIONS.link();
	}
});

window.addEventListener('beforeunload', () => {
	if (state.saveTimer) flushSave();
});

// ------------------------------------------------------------------- 起動

refreshState()
	.then((data) => {
		const first = data.posts.find((p) => !p.readOnly);
		if (first) return openPost(first.slug);
		el.previewEmpty.hidden = false;
	})
	.catch((e) => {
		document.body.innerHTML = `<p style="padding:2rem">エディタを起動できませんでした: ${escapeHtml(e.message)}</p>`;
	});

// git の状態をときどき見直す
setInterval(() => refreshState().catch(() => {}), 8000);
