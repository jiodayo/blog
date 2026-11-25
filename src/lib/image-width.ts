/**
 * 画像の幅の指定を、HTML を組み立てる途中で拾って style に移す。
 *
 * 本文にはこう書く（Markdown の「タイトル」の場所を借りている）。
 *
 *     ![説明](./images/foo.jpg "w=50")
 *
 * 数字は本文の幅に対する割合。そのままだと画像にマウスを乗せたとき
 * 「w=50」と吹き出しが出てしまうので、ここで title を消している。
 *
 * 幅を決めた画像は真ん中に寄せる。本文より狭い画像が左に貼りついていると、
 * 字下げを間違えたように見えるため。寄せ方は CSS 側（global.css の
 * .prose img.sized）に書いてあって、ここは割合だけを渡す。
 */
import type { HastPluginDefinition } from 'satteri';

const WIDTH_RE = /^w=(\d{1,3})$/;

export const imageWidth: HastPluginDefinition = {
	name: 'image-width',
	element: {
		filter: ['img'],
		visit(node) {
			const props = (node.properties ?? {}) as Record<string, unknown>;
			const title = typeof props.title === 'string' ? props.title.trim() : '';
			const m = WIDTH_RE.exec(title);
			if (!m) return;

			// 極端な値で崩れないよう、5〜100% に収める
			const pct = Math.min(100, Math.max(5, Number(m[1])));
			const { title: _title, ...rest } = props;

			// クラスは付けない。hast は class を className として持つので、
			// Astro の画像コンポーネントを通ると className="..." が生のまま
			// もう一枚出てしまう。幅の値だけ渡して、選ぶのは CSS 側に任せる。
			return {
				...node,
				properties: {
					...rest,
					style: `--w: ${pct}%`,
				},
			};
		},
	},
};
