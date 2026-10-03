/*
 * ★**背景を抜く**（2026-09-15 新設）。
 *
 * **なぜ要ったか**: 本人が描いてきた Lv20 のボスの絵は、**白い背景ごと**書き出されていて、
 * ゲームに貼ると**白い四角の板**として出てしまった（本人「**背景が追加されたっマになっている**」）。
 *
 * ★**閾値で「白いピクセルを消す」だけでは絵が壊れる** ―― この作品の紙の色（クリーム #efe7d2）は
 * 白にとても近く、判子の縁もクリームなので、**絵の内側の白まで抜けて穴が空く**。
 *
 * ★**だから「外側から塗りつぶし」で抜く。** 画像の縁から辿れる明るいピクセルだけを透明にする。
 * 絵に囲まれた内側の白は、外から辿り着けないので残る。
 *
 * 使い方: node tools/cutout-bg.mjs <入力.png> <出力.png>
 */
import { readPNG, writePNG } from './png.mjs';

const [, , src, dst] = process.argv;
if (!src || !dst) throw new Error('usage: node tools/cutout-bg.mjs <in.png> <out.png>');

const img = readPNG(src);
const { w, h, data } = img;

/** 背景とみなす明るさ。★高くすると絵の淡い部分まで食うので、まず 232 で試す */
const BG = 232;
const isBg = (i) => data[i] >= BG && data[i + 1] >= BG && data[i + 2] >= BG;

// --- 縁から塗りつぶす（4近傍） ---
const seen = new Uint8Array(w * h);
const stack = [];
for (let x = 0; x < w; x++) { stack.push(x, x + (h - 1) * w); }
for (let y = 0; y < h; y++) { stack.push(y * w, w - 1 + y * w); }

let cut = 0;
while (stack.length > 0) {
  const p = stack.pop();
  if (seen[p]) continue;
  seen[p] = 1;
  const i = p * 4;
  if (!isBg(i)) continue;
  data[i + 3] = 0;
  cut++;
  const x = p % w, y = (p - x) / w;
  if (x > 0) stack.push(p - 1);
  if (x < w - 1) stack.push(p + 1);
  if (y > 0) stack.push(p - w);
  if (y < h - 1) stack.push(p + w);
}

/*
 * ★★**2パス目: 囲まれた背景も抜く**（2026-09-15 夜・本人「**檻のところの背景も抜けたら完璧**」）。
 *
 * ★**1パス目（縁からの塗りつぶし）だけでは、鳥かごの中が白いまま残る。**
 * かごの棒がドーム状に密で、隙間の**アンチエイリアス（半端な灰色）が堰になり、外から入れない**から。
 *
 * ★**「明るいものを全部抜く」では絵が壊れる** ―― この作品の紙はクリーム `#efe7d2` で、
 * **判子の下の縁もクリーム**。だから **「明るい」だけでなく「無彩色」も条件にする。**
 * 白や薄い灰は R=G=B に近く、クリームは**青だけ 29 低い**ので、ここで切り分けられる。
 */
const FLAT = 14;   // R/G/B の開き。これ以下なら「色が付いていない」＝ 背景の白や灰
const LIGHT = 232; // 明るさの下限
let cut2 = 0;
for (let p = 0; p < w * h; p++) {
  const i = p * 4;
  if (data[i + 3] === 0) continue;
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (min >= LIGHT && max - min <= FLAT) { data[i + 3] = 0; cut2++; }
}

/*
 * ★**縁を1周やわらげる。** 抜いたところと残ったところの境目が、拡大すると階段に見えるので、
 * 透明のとなりにある不透明なピクセルの alpha を少し落とす（1段だけ）。
 */
const alpha = Buffer.from(data);
for (let y = 1; y < h - 1; y++) {
  for (let x = 1; x < w - 1; x++) {
    const p = x + y * w, i = p * 4;
    if (data[i + 3] === 0) continue;
    const around = [p - 1, p + 1, p - w, p + w].filter((q) => data[q * 4 + 3] === 0).length;
    if (around > 0) alpha[i + 3] = 150;
  }
}

writePNG(dst, { w, h, data: alpha });
console.log(
  `${src} → ${dst}  ${w}x${h}  外から ${cut} ＋ 囲まれた背景 ${cut2} を透明化`
  + `（合わせて全体の ${(100 * (cut + cut2) / (w * h)).toFixed(1)}%）`,
);
