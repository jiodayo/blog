/**
 * 改行をそのまま改行として出す。
 *
 * Markdown の決まりでは、1行だけの改行は「空白」として扱われ、文は
 * つながってしまう。行を分けるには1行あけるしかないが、それだと段落が
 * 変わってしまい、間隔もあく。
 *
 * 「同じ段落のまま、行だけ変えたい」ほうが普段は多いので、ここで
 * 改行をそのまま <br> にしている。note や Qiita と同じ動き。
 *
 *   1回改行  → 同じ段落のまま次の行へ
 *   1行あける → 段落が変わる
 *
 * mdast（HTML になる前の段階）で入れているのは、この段階なら改行が
 * 入っているのが必ず文章の中だと分かるため。HTML になったあとだと、
 * 箇条書きのタグの間などにも改行が混ざっていて、見分けがつかない。
 * コードブロックは text ではなく code という別の種類なので、ここには
 * 来ない。中の改行はそのまま残る。
 */
import type { MdastPluginDefinition } from 'satteri';

export const softBreak: MdastPluginDefinition = {
	name: 'soft-break',
	text(node, ctx) {
		if (!node.value.includes('\n')) return;

		const lines = node.value.split('\n');
		const parts = [];
		for (let i = 0; i < lines.length; i++) {
			if (i > 0) parts.push({ type: 'break' as const });
			// 行末の空白は見えないので落とす。空行は文字を足さない。
			const text = i < lines.length - 1 ? lines[i].replace(/[ \t]+$/, '') : lines[i];
			if (text !== '') parts.push({ type: 'text' as const, value: text });
		}
		ctx.replaceNode(node, parts);
	},
};
