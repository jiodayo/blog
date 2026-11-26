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
	tags: $('f-tags'),
	tagSuggest: $('tag-suggest'),
	tagSuggestRow: $('tag-suggest-row'),
	search: $('post-search'),
	pageList: $('page-list'),
	hero: $('btn-hero'),
	heroClear: $('btn-hero-clear'),
	heroThumb: $('hero-thumb'),
	heroName: $('hero-name'),
	heroInput: $('hero-input'),
	bannerInput: $('banner-input'),
	embed: $('btn-embed'),
	template: $('btn-template'),
	templateMenu: $('template-menu'),
	countChars: $('count-chars'),
	countLines: $('count-lines'),
	liveLink: $('live-link'),
	site: $('btn-site'),
	images: $('btn-images'),
	modalForm: $('modal-form'),
	deployState: $('deploy-state'),
	pubDate: $('f-pubDate'),
	updatedDate: $('f-updatedDate'),
	slug: $('f-slug'),
	draft: $('f-draft'),
	toc: $('f-toc'),
	imagebar: $('imagebar'),
	imgWidth: $('img-width'),
	imgWidthOut: $('img-width-out'),
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
	meta: $('meta'),
	metaToggle: $('btn-meta'),
	metaDigest: $('meta-digest'),
	zen: $('btn-zen'),
	help: $('btn-help'),
	sync: $('btn-sync'),
	articleOnly: $('btn-article-only'),
};

const state = {
	posts: [],
	devOrigin: 'http://localhost:4321',
	postUrlPrefix: '/posts',
	pages: [],
	site: {},
	current: null, // 開いている記事のスラッグ、またはページ名
	kind: 'post', // 'post' か 'page'
	heroImage: '',
	filter: '',
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
	state.pages = data.pages ?? [];
	state.site = data.site ?? {};
	state.devOrigin = data.devOrigin;
	state.liveOrigin = data.liveOrigin ?? '';
	state.postUrlPrefix = data.postUrlPrefix ?? '/posts';
	state.today = data.today;
	// 一覧は中身が変わったときだけ描き直す。
	// 毎回作り直すと、クリックしようとしている要素が入れ替わってしまう。
	const signature = JSON.stringify([data.posts, data.pages, state.current, state.filter]);
	if (signature !== state.listSignature) {
		state.listSignature = signature;
		renderList();
		if (state.current && state.kind === 'post') renderTagSuggestions();
	}
	renderGit(data.git, data.devUp);
	return data;
}

// ------------------------------------------------------------------- 表示

const escapeHtml = (s) =>
	String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function renderList() {
	const needle = state.filter.trim().toLowerCase();
	const posts = needle
		? state.posts.filter((p) =>
				[p.title, p.slug, p.description, ...(p.tags || [])]
					.join(' ')
					.toLowerCase()
					.includes(needle),
			)
		: state.posts;

	el.list.innerHTML = posts.length
		? posts
				.map(
					(p) => `
			<li data-slug="${escapeHtml(p.slug)}" class="${p.slug === state.current && state.kind === 'post' ? 'active' : ''}">
				<span class="pt">${escapeHtml(p.title)}${p.draft ? '<span class="badge">下書き</span>' : ''}</span>
				<span class="pd">${escapeHtml(p.pubDate)}${p.readOnly ? ' · .mdx' : ''}</span>
			</li>`,
				)
				.join('')
		: `<li class="empty">${needle ? '見つかりませんでした' : 'まだ記事がありません'}</li>`;

	el.pageList.innerHTML = state.pages
		.map(
			(pg) => `
			<li data-page="${escapeHtml(pg.name)}" class="${pg.name === state.current && state.kind === 'page' ? 'active' : ''}">
				<span class="pt">${escapeHtml(pg.title)}</span>
				<span class="pd">/${escapeHtml(pg.name)}</span>
			</li>`,
		)
		.join('');
}

/** 記事だけにある項目を、ページを開いているときは隠す */
function applyKindVisibility() {
	const isPost = state.kind === 'post';
	for (const node of [el.tags, el.pubDate, el.updatedDate, el.slug, el.draft, el.toc]) {
		node.closest('.field')?.toggleAttribute('hidden', !isPost);
	}
	el.tagSuggestRow.hidden = !isPost || el.tagSuggest.children.length === 0;
	el.hero.closest('.field')?.toggleAttribute('hidden', !isPost);
	el.delete.hidden = !isPost;
	renderMetaDigest();
}

function renderCounts() {
	const text = el.body.value;
	el.countChars.textContent = `${text.replace(/\s/g, '').length} 文字`;
	el.countLines.textContent = `${text ? text.split('\n').length : 0} 行`;
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

/** 入力欄の文字列をタグの配列にする。カンマは半角・全角・読点のどれでもよい。 */
function parseTags(value) {
	const seen = new Set();
	const out = [];
	for (const raw of String(value).split(/[,、，]/)) {
		const tag = raw.trim();
		if (!tag || seen.has(tag)) continue;
		seen.add(tag);
		out.push(tag);
	}
	return out;
}

/** いま入力欄に入っているタグ */
function currentTags() {
	return parseTags(el.tags.value);
}

function setTags(list) {
	el.tags.value = list.join(', ');
}

/**
 * 他の記事で使ったタグを下に並べる。綴りが揺れると別タグになってしまうので、
 * 打ち直さずに選べるようにしておく。
 */
function renderTagSuggestions() {
	const all = new Set();
	for (const post of state.posts) for (const tag of post.tags || []) all.add(tag);
	const active = new Set(currentTags());
	const list = [...all].sort((a, b) => a.localeCompare(b, 'ja'));
	el.tagSuggestRow.hidden = list.length === 0;
	el.tagSuggest.innerHTML = list
		.map(
			(tag) =>
				`<button type="button" class="tag-chip${active.has(tag) ? ' on' : ''}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`,
		)
		.join('');
}

function toggleTag(tag) {
	const list = currentTags();
	const i = list.indexOf(tag);
	if (i === -1) list.push(tag);
	else list.splice(i, 1);
	setTags(list);
	renderTagSuggestions();
	scheduleSave();
}

function formValues() {
	if (state.kind === 'page') {
		return {
			title: el.title.value,
			description: el.description.value,
			body: el.body.value,
		};
	}
	return {
		title: el.title.value,
		description: el.description.value,
		tags: currentTags(),
		pubDate: el.pubDate.value,
		updatedDate: el.updatedDate.value,
		heroImage: state.heroImage,
		draft: el.draft.checked,
		toc: el.toc.checked,
		body: el.body.value,
	};
}

function setHero(pathValue) {
	state.heroImage = pathValue || '';
	const has = Boolean(state.heroImage);
	el.heroClear.hidden = !has;
	el.heroThumb.hidden = !has;
	el.heroName.textContent = has ? state.heroImage.replace('./images/', '') : '選んでいません';
	if (has) {
		// 画像は記事フォルダの中なので、プレビュー用に中継サーバー経由のパスにする
		el.heroThumb.src = `/api/image-file?name=${encodeURIComponent(
			state.heroImage.replace('./images/', ''),
		)}`;
	}
}

async function openPage(name) {
	await flushSave();
	const page = await api(`/api/pages/${encodeURIComponent(name)}`);
	state.current = name;
	state.kind = 'page';
	state.heroImage = '';
	el.title.value = page.title;
	el.description.value = page.description;
	el.body.value = page.body;
	// value を入れ直すとカーソルが末尾に飛ぶ。開いた直後は先頭を見たい。
	el.body.setSelectionRange(0, 0);
	el.editor.hidden = false;
	applyKindVisibility();
	renderImageBar();
	renderCounts();
	state.listSignature = null;
	renderList();
	setSaveState('保存済み', 'ok');
	lastHeading = -1;
	updatePreview();
}

async function openPost(slug) {
	await flushSave();
	const post = await api(`/api/posts/${encodeURIComponent(slug)}`);
	state.current = slug;
	state.kind = 'post';
	el.title.value = post.title;
	el.description.value = post.description;
	setTags(post.tags || []);
	el.pubDate.value = post.pubDate;
	el.updatedDate.value = post.updatedDate;
	el.slug.value = post.slug;
	el.draft.checked = post.draft;
	el.toc.checked = post.toc === true;
	el.body.value = post.body;
	el.body.setSelectionRange(0, 0);
	el.editor.hidden = false;
	setHero(post.heroImage);
	renderTagSuggestions();
	applyKindVisibility();
	renderImageBar();
	renderCounts();
	state.listSignature = null;
	renderList();
	setSaveState('保存済み', 'ok');
	lastHeading = -1;
	updatePreview();
}

function scheduleSave() {
	renderMetaDigest();
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
		const endpoint = state.kind === 'page' ? 'pages' : 'posts';
		await api(`/api/${endpoint}/${encodeURIComponent(state.current)}`, {
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
			tags: [],
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
	const base = state.postUrlPrefix.replace(/\/posts$/, '');
	const postPath =
		state.kind === 'page' ? `${base}/${slug}/` : `${state.postUrlPrefix}/${slug}/`;
	el.previewUrl.textContent = `${state.devOrigin}${postPath}`;
	renderLiveLink();

	if (wait && state.kind === 'post') {
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

// 裏で読み込み中のプレビュー。次の差し替えが来たら捨てる。
let pendingFrame = null;

function dropPendingFrame() {
	if (!pendingFrame) return;
	clearTimeout(pendingFrame.timer);
	pendingFrame.frame.remove();
	pendingFrame = null;
}

/**
 * プレビューを新しい内容に差し替える。
 *
 * 同じ iframe の src を貼り替えると、読み込みの間だけ白い画面になる。
 * 一文字打つたびにそれが起きるので、画面がちらついて書きにくい。
 *
 * そこで、古い画面を出したまま新しい iframe を裏で読み込み、出来上がって
 * から入れ替える。白い時間がなくなるので、内容だけが静かに変わる。
 */
function swapFrame(url) {
	dropPendingFrame();
	const old = el.frame;
	const next = document.createElement('iframe');
	next.title = 'プレビュー';
	next.className = 'loading'; // 出来上がるまで見せない
	next.src = url;

	const show = () => {
		if (pendingFrame?.frame !== next) return;
		clearTimeout(pendingFrame.timer);
		pendingFrame = null;
		el.frame = next;
		const carried = carryScroll(old, next);
		// 「記事だけ」は見せる前に効かせる。あとからだと、隠すはずの
		// ヘッダが一瞬だけ見えてしまう。
		applyArticleOnly();
		next.classList.remove('loading');
		old.remove();
		// id は古いほうを外してから。重なっている間に同じ id が2つできない。
		next.id = 'preview-frame';
		// 位置を引き継げたときは、そのまま見ていた場所に留める。
		if (!carried) {
			lastHeading = -1;
			maybeSync();
		}
	};

	next.addEventListener('load', show);
	// 読み込みが終わらないときでも、古い画面を出し続けない
	pendingFrame = { frame: next, timer: setTimeout(show, 5000) };
	old.after(next);
}

/**
 * 新しいプレビューを、いま見ている位置のまま出す。
 * 引き継げたら true。
 */
function carryScroll(from, to) {
	try {
		const a = from.contentWindow;
		const b = to.contentWindow;
		if (!a || !b) return false;
		if (a.scrollX === 0 && a.scrollY === 0) return false;
		b.scrollTo(a.scrollX, a.scrollY);
		return true;
	} catch {
		return false; // 読み込み前などは諦める
	}
}

let reloadTimer = null;
function reloadPreview() {
	clearTimeout(reloadTimer);
	// Astro がファイルの変更を拾うまで少し待つ
	reloadTimer = setTimeout(() => updatePreview({ wait: false }), 600);
}

// ----------------------------------------------------------- Markdown 補助

/**
 * 本文の一部を書き換える。
 *
 * ta.value に直接代入するとブラウザが持っている取り消し履歴が消えてしまい、
 * ツールバーを一度でも使うと ⌘Z が効かなくなる。execCommand は非推奨だが、
 * 「人が打ったのと同じ扱いで差し替える」手段は今のところこれしかない。
 */
function replaceRange(start, end, text) {
	const ta = el.body;
	ta.focus();
	ta.setSelectionRange(start, end);
	let ok = false;
	try {
		ok = document.execCommand('insertText', false, text);
	} catch {
		ok = false;
	}
	if (!ok) {
		// 使えない環境向けの保険。この経路だけは ⌘Z が効かない。
		ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
		ta.selectionStart = ta.selectionEnd = start + text.length;
	}
	scheduleSave();
}

function surround(before, after = before) {
	const ta = el.body;
	const { selectionStart: s, selectionEnd: e, value } = ta;
	const sel = value.slice(s, e);
	replaceRange(s, e, before + sel + after);
	ta.setSelectionRange(s + before.length, s + before.length + sel.length);
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
	replaceRange(start, end, next);
	ta.setSelectionRange(start, start + next.length);
}

function insertAtCursor(text) {
	const ta = el.body;
	replaceRange(ta.selectionStart, ta.selectionEnd, text);
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

/** 画像を保存するだけ。本文に入れるかどうかは呼ぶ側が決める。 */
async function uploadImage(file) {
	const ext = (file.name.split('.').pop() || 'png').toLowerCase();
	setSaveState('画像を保存中…');
	const r = await api(
		`/api/images?slug=${encodeURIComponent(state.current || 'image')}` +
			`&ext=${encodeURIComponent(ext)}&kind=${state.kind}`,
		{ method: 'POST', body: file },
	);
	if (r.resized) {
		flashHint(
			`画像を縮小しました: ${r.widthBefore}px → ${r.width}px` +
				`（${fmtBytes(r.bytesBefore)} → ${fmtBytes(r.bytesAfter)}）`,
		);
	} else {
		setSaveState('保存済み', 'ok');
	}
	return r;
}

async function insertImage(file) {
	const r = await uploadImage(file);
	// alt は空のままにせず、あとで書けるよう中にカーソルを置く
	const text = `\n![](${r.markdownPath})\n`;
	const at = el.body.selectionStart;
	insertAtCursor(text);
	const altAt = at + 3; // '\n![' の次
	el.body.setSelectionRange(altAt, altAt);
}

async function handleFiles(files) {
	for (const file of files) {
		if (file.type.startsWith('image/')) {
			try {
				await insertImage(file);
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
	if (state.current && state.kind === 'post' && el.draft.checked) {
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

	// 何が送られるのかを先に見せる。記事以外の変更が混ざることがあるため。
	const { files } = await api('/api/changes').catch(() => ({ files: [] }));
	if (files.length === 0) {
		await showModal('公開', '変更がありませんでした。');
		return;
	}
	const list = files
		.map((f) => `<li><span class="label">${escapeHtml(f.label)}</span>${escapeHtml(f.file)}</li>`)
		.join('');
	const go = await showForm(
		'これを公開します',
		`<ul class="change-list">${list}</ul>
		 <p class="hint">${files.length} 件の変更を GitHub に送ります。</p>`,
		[
			{ value: 'go', label: '公開する' },
			{ value: null, label: 'やめる', primary: true },
		],
	);
	if (go !== 'go') return;

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
			watchDeploy();
			showModal(
				'公開しました',
				`${result.log.filter(Boolean).join('\n\n')}\n\n` +
					'GitHub でのビルドを見ています。終わったら右上に出ます。',
			);
		}
	} catch (e) {
		showModal('公開できませんでした', e.message);
	} finally {
		await refreshState();
	}
}

/**
 * 公開したあと、GitHub 側のビルドが終わるまで様子を見る。
 * 「push した」と「サイトに出た」は別なので、そこを埋める。
 */
let deployTimer = null;
async function watchDeploy() {
	clearInterval(deployTimer);
	const started = Date.now();
	setDeployState('ビルド中…', 'warn');

	deployTimer = setInterval(async () => {
		const run = await api('/api/deploy').catch(() => ({ available: false }));
		if (!run.available) {
			setDeployState('', '');
			clearInterval(deployTimer);
			return;
		}
		if (run.status === 'completed') {
			clearInterval(deployTimer);
			const ok = run.conclusion === 'success';
			setDeployState(ok ? 'サイトに反映されました' : 'ビルドに失敗しました', ok ? 'ok' : 'warn');
			if (!ok && run.url) {
				showModal('ビルドに失敗しました', `GitHub の実行結果:\n${run.url}`);
			}
			setTimeout(() => setDeployState('', ''), 20000);
			return;
		}
		// 10分見ても終わらなければ諦める
		if (Date.now() - started > 600000) {
			clearInterval(deployTimer);
			setDeployState('', '');
		}
	}, 10000);
}

function setDeployState(text, cls) {
	el.deployState.textContent = text;
	el.deployState.className = `pill ${cls}`;
	el.deployState.hidden = !text;
}

function showModal(title, log) {
	return showChoice(title, log, [{ value: null, label: '閉じる', primary: true }]);
}

/**
 * ボタン付きのモーダルを出し、押された value で解決する Promise を返す。
 * 背景クリックと Esc は null（＝やめる）扱い。
 */
function showChoice(title, log, choices) {
	return openModal(title, { log }, choices);
}

/**
 * フォームを入れたモーダル。中身は HTML 文字列で渡す。
 * setup は要素が入ったあとに呼ばれるので、そこでイベントを足す。
 */
function showForm(title, html, choices, setup) {
	return openModal(title, { html, setup }, choices);
}

function openModal(title, content, choices) {
	el.modalTitle.textContent = title;
	const useForm = content.html !== undefined;
	el.modalLog.hidden = useForm;
	el.modalForm.hidden = !useForm;
	if (useForm) {
		el.modalForm.innerHTML = content.html;
		el.modalForm.removeAttribute('data-banner-cleared');
		content.setup?.(el.modalForm);
	} else {
		el.modalLog.textContent = content.log;
	}
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

// ------------------------------------------------------- 記事の設定の開閉

/**
 * タイトル以外の項目（説明・タグ・日付・スラッグ・下書き・ヘッダ画像）は
 * 一度決めたらあまり触らないので、普段はたたんでおく。
 * 本文に使える高さがそのぶん増える。開いているかは次に開いたときも覚えている。
 */
const META_KEY = 'editor.meta.open';

function metaIsOpen() {
	try {
		return localStorage.getItem(META_KEY) !== '0';
	} catch {
		return true;
	}
}

function setMetaOpen(open) {
	el.meta.hidden = !open;
	el.metaDigest.hidden = open;
	el.metaToggle.setAttribute('aria-expanded', String(open));
	try {
		localStorage.setItem(META_KEY, open ? '1' : '0');
	} catch {
		/* プライベートウィンドウなどで保存できなくても動きは変えない */
	}
	renderMetaDigest();
}

/** たたんでいるときに、中身を一行で見せる */
function renderMetaDigest() {
	if (el.metaDigest.hidden) return;
	const parts = [];
	if (state.kind === 'post') {
		if (el.draft.checked) parts.push('<span class="is-draft">下書き</span>');
		const tags = currentTags();
		parts.push(tags.length ? escapeHtml(tags.join('、')) : 'タグなし');
		if (el.pubDate.value) parts.push(escapeHtml(el.pubDate.value.replaceAll('-', '/')));
		if (state.heroImage) parts.push('ヘッダ画像あり');
		if (el.toc.checked) parts.push('目次あり');
		if (el.slug.value) parts.push(`/${escapeHtml(el.slug.value)}`);
	} else {
		parts.push(el.description.value ? escapeHtml(el.description.value) : '説明なし');
	}
	el.metaDigest.innerHTML = parts.join('<span class="sep">·</span>');
}

// --------------------------------------------------------- 画像の大きさ

/**
 * 本文の中の画像ひとつ。幅は Markdown の「タイトル」の場所を借りて
 * "w=50" のように書く（src/lib/image-width.ts が HTML にするときに拾う）。
 */
const IMAGE_RE = /!\[([^\]]*)\]\(\s*([^()\s]+)(?:\s+"([^"]*)")?\s*\)/;
const WIDTH_RE = /^w=(\d{1,3})$/;

/** カーソルのある行の画像を返す。無ければ null。 */
function imageAtCursor() {
	const v = el.body.value;
	const pos = el.body.selectionStart;
	const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
	const nl = v.indexOf('\n', pos);
	const lineEnd = nl === -1 ? v.length : nl;
	const m = IMAGE_RE.exec(v.slice(lineStart, lineEnd));
	if (!m) return null;

	const title = m[3] ?? '';
	// 幅以外のタイトルが書いてあるときは触らない。手で書いたものを
	// 幅の指定で上書きしてしまわないように。
	if (title && !WIDTH_RE.test(title)) return null;

	return {
		start: lineStart + m.index,
		end: lineStart + m.index + m[0].length,
		alt: m[1],
		path: m[2],
		width: title ? Number(WIDTH_RE.exec(title)[1]) : 100,
	};
}

/** 画像の行にいるときだけ、幅の列を出す */
function renderImageBar() {
	const img = state.current ? imageAtCursor() : null;
	el.imagebar.hidden = !img;
	if (!img) return;
	el.imgWidth.value = String(img.width);
	el.imgWidthOut.textContent = `${img.width}%`;
}

/** カーソルのある画像の幅を書き換える */
function setImageWidth(pct) {
	const img = imageAtCursor();
	if (!img) return;
	const width = Math.min(100, Math.max(10, Math.round(pct)));
	// 原寸のときは指定そのものを消す。本文を余計な記号で汚さない。
	const next =
		width >= 100
			? `![${img.alt}](${img.path})`
			: `![${img.alt}](${img.path} "w=${width}")`;
	const caret = el.body.selectionStart;
	// replaceRange 経由なので ⌘Z で元に戻せる
	replaceRange(img.start, img.end, next);
	const limit = img.start + next.length;
	const at = Math.min(caret, limit);
	el.body.setSelectionRange(at, at);
	renderImageBar();
}

// ----------------------------------------------------------- 集中モード

function setZen(on) {
	document.body.classList.toggle('zen', on);
	el.zen.setAttribute('aria-pressed', String(on));
	if (on) el.body.focus();
}

// --------------------------------------------------- プレビューの見え方

/**
 * プレビューは iframe だが、dev サーバーへはエディタ自身が中継しているので
 * エディタと同じオリジンになる。そのおかげで中の DOM を触れる。
 */
const PREF_KEY = 'editor.preview';
const prefs = { sync: true, articleOnly: false };
try {
	Object.assign(prefs, JSON.parse(localStorage.getItem(PREF_KEY) || '{}'));
} catch {
	/* 壊れていたら既定のまま */
}

function savePrefs() {
	try {
		localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
	} catch {
		/* 保存できなくても動きは変えない */
	}
}

function previewDoc() {
	try {
		const doc = el.frame.contentDocument;
		return doc?.body ? doc : null;
	} catch {
		return null; // 読み込み中など
	}
}

const ONLY_STYLE_ID = '__editor-article-only';

/** ヘッダ・サイドバー・フッタを隠して、記事だけを広く見せる */
function applyArticleOnly() {
	const doc = previewDoc();
	if (!doc) return;
	const existing = doc.getElementById(ONLY_STYLE_ID);
	if (!prefs.articleOnly) {
		existing?.remove();
		return;
	}
	const tag = existing ?? doc.createElement('style');
	tag.id = ONLY_STYLE_ID;
	// body 直下の header / footer だけを狙う。記事のタイトルも header なので、
	// 子孫セレクタにするとタイトルまで消えてしまう。
	tag.textContent = `
		body > header,
		body > footer,
		aside.sidebar { display: none !important; }
		.layout { display: block !important; }
		main { max-width: 46rem; margin: 0 auto; }
	`;
	if (!existing) doc.head.append(tag);
}

/**
 * カーソルより前にある見出しの数を数える。
 * コードブロックの中の # は見出しではないので飛ばす。
 */
function headingIndexAtCursor() {
	const before = el.body.value.slice(0, el.body.selectionStart);
	let inFence = false;
	let count = 0;
	for (const line of before.split('\n')) {
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		if (/^#{1,6}\s/.test(line)) count++;
	}
	return count;
}

/** 書いている見出しの位置までプレビューを動かす */
function syncPreviewToCursor() {
	const doc = previewDoc();
	const prose = doc?.querySelector('.prose');
	if (!prose) return;
	const index = headingIndexAtCursor();
	if (index === 0) {
		doc.defaultView?.scrollTo({ top: 0, behavior: 'smooth' });
		return;
	}
	const heads = prose.querySelectorAll('h1, h2, h3, h4, h5, h6');
	heads[index - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 同じ見出しの中で打っている間は動かさない。
// 一文字ごとに飛ぶと、書いている最中に視界がうるさくなる。
let lastHeading = -1;
let syncTimer = null;
function maybeSync() {
	if (!prefs.sync) return;
	clearTimeout(syncTimer);
	syncTimer = setTimeout(() => {
		const index = headingIndexAtCursor();
		if (index === lastHeading) return;
		lastHeading = index;
		syncPreviewToCursor();
	}, 250);
}

function onPreviewLoad() {
	applyArticleOnly();
	lastHeading = -1;
	maybeSync();
}

function setSync(on) {
	prefs.sync = on;
	el.sync.setAttribute('aria-pressed', String(on));
	savePrefs();
	if (on) {
		lastHeading = -1;
		maybeSync();
	}
}

function setArticleOnly(on) {
	prefs.articleOnly = on;
	el.articleOnly.setAttribute('aria-pressed', String(on));
	savePrefs();
	applyArticleOnly();
}

// ------------------------------------------------------- 箇条書きの継続

// 「- 」「* 」「1. 」「- [ ] 」と引用「> 」を Enter で続ける。
const LIST_RE = /^(\s*)(?:([-*+])|(\d+)([.)]))([ \t]+)(\[[ xX]\][ \t]+)?(.*)$/;
const QUOTE_RE = /^(\s*)>[ \t]?(.*)$/;

/**
 * 箇条書きの行で Enter を押したら、次の行にも同じ印をつける。
 * 中身が空の項目で押したときは、印を消して抜ける（リストの終わり）。
 * 書き換えは replaceRange 経由なので ⌘Z はそのまま効く。
 */
function continueList(event) {
	const ta = el.body;
	if (ta.selectionStart !== ta.selectionEnd) return false;
	const at = ta.selectionStart;
	const lineStart = ta.value.lastIndexOf('\n', at - 1) + 1;
	const line = ta.value.slice(lineStart, at);

	const list = LIST_RE.exec(line);
	if (list) {
		const [, indent, bullet, num, delim, space, task, rest] = list;
		event.preventDefault();
		if (!rest.trim()) {
			replaceRange(lineStart, at, ''); // 空の項目 → リストを抜ける
			return true;
		}
		const marker = bullet ? bullet + space : `${Number(num) + 1}${delim}${space}`;
		replaceRange(at, at, `\n${indent}${marker}${task ? '[ ] ' : ''}`);
		return true;
	}

	const quote = QUOTE_RE.exec(line);
	if (quote) {
		event.preventDefault();
		if (!quote[2].trim()) {
			replaceRange(lineStart, at, '');
			return true;
		}
		replaceRange(at, at, `\n${quote[1]}> `);
		return true;
	}
	return false;
}

// --------------------------------------------------- ショートカット一覧

const SHORTCUTS = [
	['書く', ''],
	['⌘B', '太字'],
	['⌘I', '斜体'],
	['⌘K', 'リンク'],
	['⌘⇧K', 'URL を埋め込む'],
	['Tab', 'インデント'],
	['Enter', '改行する（段落は変わらない）。箇条書き・引用は続く'],
	['⇧Enter', '箇条書き・引用を続けずに改行する'],
	['Enter 2回', '1行あいて、段落が変わる'],
	['⌘Z / ⌘⇧Z', '取り消し・やり直し'],
	['画面', ''],
	['⌘⇧F', '集中モード（本文だけにする）'],
	['Esc', '集中モードをやめる'],
	['⌘/', 'この一覧'],
	['保存と公開', ''],
	['⌘S', 'すぐ保存する（ふだんは自動で保存される）'],
	['貼り付け', '画像はそのまま貼り付け・ドロップで入る'],
];

function showShortcuts() {
	const rows = SHORTCUTS.map(([key, desc]) =>
		desc === ''
			? `<div class="grp">${escapeHtml(key)}</div>`
			: `<kbd>${escapeHtml(key)}</kbd><span>${escapeHtml(desc)}</span>`,
	).join('');
	return showForm('ショートカット', `<div class="keys">${rows}</div>`, [
		{ value: null, label: '閉じる', primary: true },
	]);
}

// --------------------------------------------------------------- 埋め込み

const URL_RE = /^https?:\/\/\S+$/;

/**
 * URL を記事の中で見える形に変える。
 * YouTube は埋め込み、X は引用、それ以外はリンクカードになる。
 * 変換はサーバー側でやる（OGP の取得と画像の保存が要るため）。
 */
async function embedUrl(rawUrl) {
	const target = (rawUrl ?? '').trim();
	if (!URL_RE.test(target)) {
		alert('http(s) で始まる URL を入れてください。');
		return;
	}
	const slug = state.kind === 'post' ? state.current : 'embed';
	flashHint('URL を読んでいます…');
	try {
		const result = await api(
			`/api/embed?slug=${encodeURIComponent(slug)}&url=${encodeURIComponent(target)}`,
		);
		const before = el.body.selectionStart;
		const text = `\n${result.html}\n`;
		replaceRange(before, el.body.selectionEnd, text);
		const label = { youtube: '動画', x: 'ポスト', card: 'リンクカード' }[result.type] ?? '埋め込み';
		flashHint(`${label}を入れました: ${result.title}`);
	} catch (e) {
		flashHint('');
		alert(`埋め込めませんでした: ${e.message}`);
	}
}

/** 貼られた URL を埋め込みに変えるボタンを、ツールバーのヒント欄に少しだけ出す */
let offerTimer = null;
function offerEmbed(target) {
	clearTimeout(offerTimer);
	el.hint.innerHTML = '';
	const label = document.createElement('span');
	label.textContent = 'URL を貼りました ';
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'btn btn-small';
	button.textContent = '埋め込みにする';
	button.addEventListener('click', () => {
		// 貼られた文字列はもう本文に入っているので、その分を消してから入れ直す
		const at = el.body.value.indexOf(target);
		if (at !== -1) replaceRange(at, at + target.length, '');
		el.hint.textContent = HINT_DEFAULT;
		embedUrl(target);
	});
	el.hint.append(label, button);
	offerTimer = setTimeout(() => {
		if (el.hint.contains(button)) el.hint.textContent = HINT_DEFAULT;
	}, 12000);
}

async function promptEmbed() {
	const fromSelection = el.body.value.slice(el.body.selectionStart, el.body.selectionEnd).trim();
	const target = prompt(
		'埋め込みたい URL\n\nYouTube は動画、X は引用、そのほかはリンクカードになります。',
		URL_RE.test(fromSelection) ? fromSelection : 'https://',
	);
	if (target) await embedUrl(target);
}

// ------------------------------------------------------------- テンプレート

/** 本文で使われている脚注番号の次を返す */
function nextFootnoteNumber() {
	const used = [...el.body.value.matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1]));
	return used.length ? Math.max(...used) + 1 : 1;
}

const TEMPLATES = [
	{
		label: '脚注',
		hint: '本文に番号を置き、末尾に中身を足す',
		run() {
			const n = nextFootnoteNumber();
			const at = el.body.selectionStart;
			// 本文の位置に番号を入れる
			replaceRange(at, el.body.selectionEnd, `[^${n}]`);
			// 末尾に定義を足して、そこにカーソルを置く
			const body = el.body.value;
			const tail = body.endsWith('\n') ? '' : '\n';
			const definition = `${tail}\n[^${n}]: `;
			const end = body.length;
			replaceRange(end, end, definition);
			el.body.setSelectionRange(el.body.value.length, el.body.value.length);
		},
	},
	{
		label: '折りたたみ',
		hint: 'クリックで開く節',
		snippet: '\n<details>\n<summary>見出し</summary>\n\n中身\n\n</details>\n',
	},
	{
		label: '補足のボックス',
		hint: '左に線が入る囲み',
		snippet: '\n<div class="note-box">\n\n補足したいこと。\n\n</div>\n',
	},
	{
		label: '図と説明文',
		hint: '画像を選んで、下に説明を付ける',
		run() {
			// 生の HTML の中の画像は Astro が解決しないので、
			// public/ に置いて絶対パスで参照する必要がある。専用の口を使う。
			figureInput.click();
		},
	},
	{ label: '表', hint: '2列の表', snippet: '\n| 見出し | 見出し |\n| --- | --- |\n| 内容 | 内容 |\n' },
	{ label: '引用と出典', hint: '引用のあとに出典', snippet: '\n> 引用する文。\n>\n> — 出典\n' },
	{ label: '区切り線', hint: '話題の切れ目', snippet: '\n---\n' },
];

const figureInput = document.createElement('input');
figureInput.type = 'file';
figureInput.accept = 'image/*';
figureInput.addEventListener('change', async () => {
	const file = figureInput.files?.[0];
	figureInput.value = '';
	if (!file) return;
	try {
		const ext = (file.name.split('.').pop() || 'png').toLowerCase();
		const saved = await api(
			`/api/public-image?slug=${encodeURIComponent(state.current || 'embed')}&ext=${encodeURIComponent(ext)}`,
			{ method: 'POST', body: file },
		);
		replaceRange(
			el.body.selectionStart,
			el.body.selectionEnd,
			`\n<figure>\n\t<img src="${saved.url}" alt="" />\n\t<figcaption>説明</figcaption>\n</figure>\n`,
		);
		if (saved.resized) {
			flashHint(`画像を縮小しました: ${saved.widthBefore}px → ${saved.width}px`);
		}
	} catch (e) {
		alert(`画像を保存できませんでした: ${e.message}`);
	}
});

function renderTemplateMenu() {
	el.templateMenu.innerHTML = TEMPLATES.map(
		(t, i) =>
			`<button type="button" data-template="${i}">${escapeHtml(t.label)}<small>${escapeHtml(t.hint)}</small></button>`,
	).join('');
}

function applyTemplate(index) {
	const tpl = TEMPLATES[index];
	if (!tpl) return;
	if (tpl.run) tpl.run();
	else replaceRange(el.body.selectionStart, el.body.selectionEnd, tpl.snippet);
	el.templateMenu.hidden = true;
}

// ----------------------------------------------------------- 公開中のリンク

function renderLiveLink() {
	// site は GitHub Pages の URL。astro.config.mjs の site + base と同じ形にする
	const base = state.postUrlPrefix.replace(/\/posts$/, '');
	const path =
		state.kind === 'page' ? `${base}/${state.current}/` : `${state.postUrlPrefix}/${state.current}/`;
	const isDraft = state.kind === 'post' && el.draft.checked;
	el.liveLink.hidden = !state.current || isDraft || !state.liveOrigin;
	if (!el.liveLink.hidden) el.liveLink.href = `${state.liveOrigin}${path}`;
}

// ------------------------------------------------------------- サイト設定

async function openSiteSettings() {
	const site = await api('/api/site');
	const socials = site.socials.length ? site.socials : [{ label: '', href: '' }];
	const rows = socials
		.map(
			(s, i) => `
		<div class="social-row">
			<input type="text" data-social-label="${i}" value="${escapeHtml(s.label)}" placeholder="GitHub" />
			<input type="url" data-social-href="${i}" value="${escapeHtml(s.href)}" placeholder="https://github.com/..." />
		</div>`,
		)
		.join('');

	const html = `
		<label>サイト名<small>ヘッダーとタブに出る</small>
			<input type="text" id="s-title" value="${escapeHtml(site.title)}" />
		</label>
		<label>説明<small>検索結果やSNSカードに出る</small>
			<input type="text" id="s-description" value="${escapeHtml(site.description)}" />
		</label>
		<label>トップの一行<small>空ならサイトの説明が出る</small>
			<input type="text" id="s-tagline" value="${escapeHtml(site.tagline)}" />
		</label>
		<label>著作権表示の名前
			<input type="text" id="s-author" value="${escapeHtml(site.author)}" />
		</label>
		<label>トップの見出し画像
			<div class="row">
				<button type="button" class="btn btn-small" id="s-banner-pick">画像を選ぶ</button>
				<button type="button" class="btn btn-small" id="s-banner-clear">外す</button>
				<span class="hint" id="s-banner-name">${escapeHtml(site.bannerImage || '設定なし')}</span>
			</div>
		</label>
		<label>リンク<small>空のままなら何も出ない</small>
			<div id="s-socials">${rows}</div>
		</label>
		<p class="hint">ヘッダーの右上にはリンクを出していません。ここに入れたものは About に並びます。</p>
	`;

	const choice = await showForm('サイト設定', html, [
		{ value: 'save', label: '保存', primary: true },
		{ value: null, label: 'やめる' },
	], (box) => {
		box.querySelector('#s-banner-pick').addEventListener('click', () => el.bannerInput.click());
		box.querySelector('#s-banner-clear').addEventListener('click', () => {
			box.querySelector('#s-banner-name').textContent = '設定なし';
			box.dataset.bannerCleared = '1';
		});
	});
	if (choice !== 'save') return;

	const box = el.modalForm;
	const socialInputs = [...box.querySelectorAll('[data-social-label]')];
	const payload = {
		title: box.querySelector('#s-title').value,
		description: box.querySelector('#s-description').value,
		tagline: box.querySelector('#s-tagline').value,
		author: box.querySelector('#s-author').value,
		socials: socialInputs.map((input) => ({
			label: input.value,
			href: box.querySelector(`[data-social-href="${input.dataset.socialLabel}"]`).value,
		})),
	};
	if (box.dataset.bannerCleared === '1') payload.bannerImage = '';
	try {
		await api('/api/site', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload),
		});
		await refreshState();
		reloadPreview();
		flashHint('サイト設定を保存しました');
	} catch (e) {
		alert(e.message);
	}
}

// --------------------------------------------------------------- 画像の整理

async function openImages() {
	const { images } = await api('/api/images');
	if (images.length === 0) {
		await showModal('画像', 'まだ画像がありません。');
		return;
	}
	const unused = images.filter((i) => i.usedBy.length === 0);
	const kb = (n) => `${Math.round(n / 1024)} KB`;
	const html = `
		<table class="image-table">
			<tr><th></th><th>ファイル</th><th>大きさ</th><th>使っている記事</th></tr>
			${images
				.map(
					(i) => `<tr>
						<td><img src="/api/image-file?name=${encodeURIComponent(i.name)}" alt="" /></td>
						<td>${escapeHtml(i.name)}<br /><small>${i.where === 'embeds' ? 'public/embeds' : '記事フォルダ'}</small></td>
						<td>${kb(i.bytes)}</td>
						<td class="${i.usedBy.length ? '' : 'unused'}">${
							i.usedBy.length ? escapeHtml(i.usedBy.join(', ')) : 'どこからも使われていない'
						}</td>
					</tr>`,
				)
				.join('')}
		</table>
		<p class="hint">${
			unused.length
				? `使われていない画像が ${unused.length} 枚（${kb(
						unused.reduce((n, i) => n + i.bytes, 0),
					)}）あります。`
				: 'すべて記事から使われています。'
		}</p>
	`;
	const actions = unused.length
		? [
				{ value: 'delete', label: `使っていない ${unused.length} 枚を消す` },
				{ value: null, label: '閉じる', primary: true },
			]
		: [{ value: null, label: '閉じる', primary: true }];

	if ((await showForm('画像', html, actions)) !== 'delete') return;
	const ok = await showChoice(
		'使っていない画像を消します',
		`${unused.map((i) => i.name).join('\n')}\n\n元に戻せません。`,
		[
			{ value: 'yes', label: '消す' },
			{ value: null, label: 'やめる', primary: true },
		],
	);
	if (ok !== 'yes') return;
	const result = await api('/api/images/unused', { method: 'DELETE' });
	await showModal('画像', `${result.deleted.length} 枚消しました（${kb(result.bytes)}）。`);
}

// ------------------------------------------------------------- イベント登録

el.list.addEventListener('click', (e) => {
	const li = e.target.closest('li[data-slug]');
	if (li) openPost(li.dataset.slug).catch((err) => alert(err.message));
});

for (const node of [
	el.title,
	el.description,
	el.tags,
	el.pubDate,
	el.updatedDate,
	el.draft,
	el.toc,
	el.body,
]) {
	node.addEventListener('input', scheduleSave);
	node.addEventListener('change', scheduleSave);
}
el.slug.addEventListener('change', applySlugChange);

// 記事の絞り込み
el.search.addEventListener('input', () => {
	state.filter = el.search.value;
	renderList();
});

// ページ（About など）を開く
el.pageList.addEventListener('click', (e) => {
	const li = e.target.closest('li[data-page]');
	if (li) openPage(li.dataset.page).catch((err) => alert(err.message));
});

// 文字数
el.body.addEventListener('input', renderCounts);

// ヘッダ画像
el.hero.addEventListener('click', () => el.heroInput.click());
el.heroClear.addEventListener('click', () => {
	setHero('');
	scheduleSave();
});
el.heroInput.addEventListener('change', async () => {
	const file = el.heroInput.files?.[0];
	el.heroInput.value = '';
	if (!file || !state.current) return;
	try {
		const saved = await uploadImage(file);
		setHero(saved.markdownPath);
		scheduleSave();
	} catch (e) {
		alert(`画像を保存できませんでした: ${e.message}`);
	}
});

// トップの見出し画像
el.bannerInput.addEventListener('change', async () => {
	const file = el.bannerInput.files?.[0];
	el.bannerInput.value = '';
	if (!file) return;
	const ext = (file.name.split('.').pop() || '').toLowerCase();
	try {
		const result = await api(`/api/banner?ext=${encodeURIComponent(ext)}`, {
			method: 'POST',
			headers: { 'content-type': 'application/octet-stream' },
			body: await file.arrayBuffer(),
		});
		const label = el.modalForm.querySelector('#s-banner-name');
		if (label) label.textContent = result.bannerImage;
		el.modalForm.removeAttribute('data-banner-cleared');
	} catch (e) {
		alert(`画像を保存できませんでした: ${e.message}`);
	}
});

// 埋め込みとテンプレート
el.embed.addEventListener('click', () => promptEmbed());
el.template.addEventListener('click', (e) => {
	e.stopPropagation();
	renderTemplateMenu();
	el.templateMenu.hidden = !el.templateMenu.hidden;
});
el.templateMenu.addEventListener('click', (e) => {
	const btn = e.target.closest('button[data-template]');
	if (btn) applyTemplate(Number(btn.dataset.template));
});
document.addEventListener('click', (e) => {
	if (!el.templateMenu.hidden && !e.target.closest('.menu-wrap')) el.templateMenu.hidden = true;
});

// サイト設定・画像
el.site.addEventListener('click', () => openSiteSettings().catch((e) => alert(e.message)));
el.images.addEventListener('click', () => openImages().catch((e) => alert(e.message)));

// 下書きの切り替えで、公開中リンクの出し分けも変わる
el.draft.addEventListener('change', renderLiveLink);
el.tags.addEventListener('input', renderTagSuggestions);
el.tagSuggest.addEventListener('click', (e) => {
	const btn = e.target.closest('button[data-tag]');
	if (btn) toggleTag(btn.dataset.tag);
});

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
		return;
	}
	// URL をそのまま貼ったときは、埋め込みに変えられることを知らせる。
	// 勝手に変換すると、ただのリンクとして貼りたいときに困るので押させる。
	const text = (e.clipboardData?.getData('text') || '').trim();
	if (URL_RE.test(text) && !text.includes('\n')) {
		offerEmbed(text);
	}
});
el.body.addEventListener('dragover', (e) => e.preventDefault());
el.body.addEventListener('drop', (e) => {
	if (e.dataTransfer?.files?.length) {
		e.preventDefault();
		handleFiles(e.dataTransfer.files);
	}
});

// Tab でインデント、Enter で箇条書きを続ける、⌘S で保存、⌘B/⌘I/⌘K
el.body.addEventListener('keydown', (e) => {
	if (e.key === 'Tab') {
		e.preventDefault();
		insertAtCursor('\t');
		return;
	}
	if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
		continueList(e);
	}
});

// カーソルが別の見出しの下に移ったら、プレビューもそこへ動かす
el.body.addEventListener('keyup', maybeSync);
el.body.addEventListener('click', maybeSync);

// 画像の幅の列
for (const ev of ['keyup', 'click', 'input', 'focus']) {
	el.body.addEventListener(ev, renderImageBar);
}
// つまみを動かしている間は数字だけ動かす。離した時点で本文に書く。
// 一目盛りごとに書き換えると、⌘Z が何十回分にもなってしまう。
el.imgWidth.addEventListener('input', () => {
	el.imgWidthOut.textContent = `${el.imgWidth.value}%`;
});
el.imgWidth.addEventListener('change', () => setImageWidth(Number(el.imgWidth.value)));
el.imagebar.addEventListener('click', (e) => {
	const btn = e.target.closest('[data-width]');
	if (btn) setImageWidth(Number(btn.dataset.width));
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
		if (e.shiftKey) promptEmbed();
		else MD_ACTIONS.link();
	} else if (key === 'f' && e.shiftKey) {
		e.preventDefault();
		setZen(!document.body.classList.contains('zen'));
	} else if (key === '/') {
		e.preventDefault();
		showShortcuts();
	}
});

// Esc で集中モードを抜ける（モーダルが開いているときはモーダル優先）
document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape' && el.modal.hidden && document.body.classList.contains('zen')) {
		setZen(false);
	}
});

// 記事の設定の開閉
el.metaToggle.addEventListener('click', () => setMetaOpen(el.meta.hidden));
el.metaDigest.addEventListener('click', () => setMetaOpen(true));

// 集中モード・ショートカット一覧
el.zen.addEventListener('click', () => setZen(!document.body.classList.contains('zen')));
el.help.addEventListener('click', () => showShortcuts());

// プレビューの追従と「記事だけ」表示
el.sync.addEventListener('click', () => setSync(!prefs.sync));
el.articleOnly.addEventListener('click', () => setArticleOnly(!prefs.articleOnly));

window.addEventListener('beforeunload', () => {
	if (state.saveTimer) flushSave();
});

// ------------------------------------------------------------------- 起動

setMetaOpen(metaIsOpen());
setSync(prefs.sync);
setArticleOnly(prefs.articleOnly);
el.frame.addEventListener('load', onPreviewLoad);

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
