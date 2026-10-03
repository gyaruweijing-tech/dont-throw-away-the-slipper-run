/*
 * 元絵を測る道具（2026-09-13）。**切り出せるかを目ではなく数字で判定する。**
 *
 *   node tools/inspect-src.mjs
 *
 * 見るのは3つ:
 *   1. 背景が本当に抜けているか（四隅と縁のアルファ）
 *   2. 不透明な部分の外接矩形
 *   3. ★**行ごとの「塊の数」**。腕が胴から離れていれば、肩の高さで塊が3つになる。
 *      くっついていれば1つ。**これが切れる／切れないの判定そのもの**
 */
import { readPNG } from './png.mjs';

const FILES = ['hero', 'hr', 'syain'];
const A = 40; // これ未満のアルファは「背景」とみなす

for (const name of FILES) {
  const img = readPNG(`assets/v2/char/src/${name}.png`);
  const { w, h, data } = img;
  const al = (x, y) => data[(y * w + x) * 4 + 3];

  // --- 1. 背景 ---
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => al(x, y));
  let edgeOpaque = 0;
  for (let x = 0; x < w; x++) { if (al(x, 0) >= A) edgeOpaque++; if (al(x, h - 1) >= A) edgeOpaque++; }
  for (let y = 0; y < h; y++) { if (al(0, y) >= A) edgeOpaque++; if (al(w - 1, y) >= A) edgeOpaque++; }

  // --- 2. 外接矩形 ---
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (al(x, y) < A) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }

  // --- 3. 行ごとの塊 ---
  const runsAt = (y) => {
    const out = [];
    let s = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && al(x, y) >= A;
      if (on && s < 0) s = x;
      if (!on && s >= 0) { if (x - s >= 4) out.push([s, x - 1]); s = -1; }
    }
    return out;
  };

  const H = y1 - y0 + 1;
  const rows = [];
  for (let i = 1; i <= 19; i++) {
    const y = Math.round(y0 + (H * i) / 20);
    const r = runsAt(y);
    rows.push(`  ${String(Math.round((i / 20) * 100)).padStart(3)}%  y=${String(y).padStart(4)}  塊${r.length}  ${r.map(([a, b]) => `${a}-${b}`).join(' ')}`);
  }

  console.log(`\n=== ${name}.png  ${w}x${h} ===`);
  console.log(`  四隅のアルファ: ${corners.join(', ')}   縁の不透明画素: ${edgeOpaque}`);
  console.log(`  外接矩形: x ${x0}..${x1} (${x1 - x0 + 1})  y ${y0}..${y1} (${H})`);
  console.log(rows.join('\n'));
}
