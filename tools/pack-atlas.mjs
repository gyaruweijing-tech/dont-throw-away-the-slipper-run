/*
 * ★**1枚絵 → キャラのアトラス**（2026-09-13 新設）。
 *
 *   node tools/pack-atlas.mjs          … public/assets/atlas.png を作る
 *   node tools/pack-atlas.mjs --debug  … 切り出した各パーツを .shots/parts/ にも書き出す
 *
 * ★**これが「参考通りにならない」の答え。** 今までは `gen-atlas.js` が
 * **コードで絵を描いて**いたので、参考画像に似るはずがなかった。
 * この道具は**描かない。切って貼るだけ**。絵は `assets/v2/char/src/*.png` が正。
 *
 * ### ★切り方は矩形だけ。**塗りつぶし方式は試して捨てた**（2026-09-13）
 * 最初は「濃い茶の輪郭線を壁にして塗りつぶす」で腕を抜こうとした。**2つとも失敗した**:
 *   ① 人事部の**濃紺のスーツが、輪郭線と同じくらい暗い**。明るさで壁を判定すると
 *      服そのものが壁になり、塗りつぶしが1画素も広がらなかった（`0px`）
 *   ② 主人公の腕は、袖・白いカフス・手が**それぞれ輪郭線で仕切られている**ので、
 *      袖に種を置いても**袖だけ**（70x71）しか取れなかった
 * ★**色で線を見分けるのは、この絵柄では成立しない。**
 * 代わりに「**腕は左右の端・胴は真ん中**」という位置の性質を使う。
 * どこで割るかは `tools/inspect-src.mjs` が出す「行ごとの塊」で決める ——
 * 塊が3つになる行の境目が、そのまま腕と胴の境目になる。
 *
 * ### マスへの入れ方
 * パーツの外接矩形を**マスいっぱいに引き伸ばす**（縦横比は保たない）。
 * 見た目の縦横比は `cutoutLayout.ts` の `w`/`h` が決めるので、
 * ★**この道具が出す「推奨 w/h」をそちらへ書き写せば、伸びずに出る**。
 */
import fs from 'node:fs';
import { readPNG, writePNG } from './png.mjs';

const SRC = 'assets/v2/char/src';
const OUT = 'public/assets/atlas.png';
const SIZE = 1024;
const GRID = 4;
const CELL = SIZE / GRID;          // 256
/** マスの内側に取る余白。`cutoutLayout.ts` の INSET（8/2048）より広く取る */
const PAD = 5;

const ALPHA = 40;

/**
 * ★**パーツの取り方**。数字は元絵の画素座標（`tools/inspect-src.mjs` で測った）。
 * box は [x0, y0, x1, y1]。**関節は少し多めに含める**（折ったとき隙間が空かないように）
 */
const PLAN = {
  hero: {
    // 鶏ごと頭。上に他のものが無いので素直に取れる
    head: { box: [428, 18, 822, 592] },
    /*
     * ★**胴は「真ん中の帯」だけ**にする。腕を含めると、腕を振ったときに
     * **胴に描かれた腕が後ろに残る**。割る位置は、塊が3つになる行（y=882）の
     * 胴の範囲 498-755 —— つまり **x 497..758 が胴、その外が腕**
     */
    body: { box: [497, 556, 758, 956] },
    /*
     * 左腕（袖・カフス・手）。★上端は肩（y=612）から。
     * 内側の縁は胴との境目に合わせてあるので、重ねたときに継ぎ目が出ない
     */
    arm: { box: [402, 612, 499, 950] },
    // 左脚。スリッパまで含める（脚のパーツに履物を含めるのが `ASSETS.md` の指定）
    leg: { box: [398, 948, 628, 1238] },
  },
  hr: {
    head: { box: [403, 12, 847, 474] },
    // 胴＝真ん中の帯（塊3の行 y=700 で 506-749）。肩の端は腕の板が隠す
    body: { box: [415, 440, 845, 1048] },
    // 左腕。★判子の箱まで含める（箱は腕と一緒に振れてほしい）
    // ★スカートの左端が同じ矩形に入るので、`keep` で腕の塊だけ残す
    // ★**腕章が付いている右腕のほうを取る**（左腕には腕章が無い）。反転すれば両腕に付く
    arm: { box: [753, 598, 1021, 1008], keep: [824, 700] },
    leg: { box: [376, 1038, 576, 1238] },
  },
  /*
   * ★**掲げるスリッパは専用の1枚**（2026-09-13 夜）。
   * 最初は主人公の足元から切り出したが、**足が入ったまま足首で切れている**ので
   * 「切れたもの」にしか見えなかった。本人に描き直してもらったものがこれ。
   * ★**白い光彩が焼き込まれている**ので `alphaMin` で薄い画素を捨てる
   */
  slipper: {
    slipper: { box: [0, 0, 1253, 1253], alphaMin: 150, dropGrey: true, rot90: true },
  },
  syain: {
    head: { box: [288, 12, 738, 508] },
    /*
     * ★**社員だけ腕を消さない。** セーターの袖が胴と同じ1枚の形で描かれていて、
     * 輪郭線でも分かれていない（＝塗りつぶしでも切れない）。
     * いまの作りは**腕を振らない**（`rivalParts` が `PART.torso`）ので、
     * 袖を胴に残したまま、同じ場所へ腕の板を重ねれば**元の絵と同じに見える**。
     * ★殴る動きを付ける日に、袖を分けた絵を描き直す（`TASKS.md` の A）
     */
    body: { box: [288, 492, 738, 852] },
    arm: { box: [292, 690, 400, 852] },
    leg: { box: [298, 836, 514, 1008] },
  },
};

/** マス割り。★`src/entities/cutoutLayout.ts` の `SLOT` と必ず一致させる */
const CELLS = [
  ['hero.head', 0, 0], ['hero.body', 1, 0], ['hero.arm', 2, 0], ['hero.leg', 3, 0],
  ['keep', 0, 1], ['hero.armUp', 1, 1], ['slipper.slipper', 2, 1], ['keep', 3, 1],
  ['hr.head', 0, 2], ['hr.body', 1, 2], ['hr.arm', 2, 2], ['hr.leg', 3, 2],
  ['syain.head', 0, 3], ['syain.body', 1, 3], ['syain.arm', 2, 3], ['syain.leg', 3, 3],
];

// ─────────────────────────────────────────────────────────────

const px = (img, x, y) => ((y * img.w + x) << 2);
const alphaAt = (img, x, y) => img.data[px(img, x, y) + 3];

/** 矩形で切り抜いた小さな画像を作る */
function cut(img, box) {
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sp = px(img, x0 + x, y0 + y), dp = (y * w + x) << 2;
      img.data.copy(data, dp, sp, sp + 4);
    }
  }
  return { w, h, data };
}

/**
 * ★**種につながっている塊だけ残す**（2026-09-13）。判定は**アルファだけ**。
 *
 * 人事部の腕を矩形で切ると、スカートの左端が一緒に入ってしまう
 * （腕とスカートの x の範囲が、行によって入れ替わるので、1つの矩形では分けられない）。
 * ★**色を見ないので、濃紺のスーツでも破綻しない**（明るさで線を判定して失敗した反省）。
 * 矩形の中で腕とスカートが**触れていない**ことが条件なので、
 * 箱の上端は「離れ始める行」より下から取ること。
 */
function keepBlob(img, seed) {
  const { w, h, data } = img;
  const mask = new Uint8Array(w * h);
  const stack = [seed[0] + seed[1] * w];
  while (stack.length) {
    const p = stack.pop();
    if (mask[p]) continue;
    const x = p % w, y = (p / w) | 0;
    if (data[(p << 2) + 3] < ALPHA) continue;
    mask[p] = 1;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  for (let p = 0; p < mask.length; p++) if (!mask[p]) data[(p << 2) + 3] = 0;
  return img;
}

/** 不透明な部分だけの外接矩形に詰める。**余白があるとマスの中で位置がずれる** */
function trim(img, at = null) {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (img.data[px(img, x, y) + 3] < ALPHA) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return img;
  if (at) at.box = [x0, y0, x1, y1];
  return cut(img, [x0, y0, x1, y1]);
}

/** 時計回りに90度まわした画像を作る（掲げるスリッパを縦持ちにするため） */
function rotate90(img) {
  const out = { w: img.h, h: img.w, data: Buffer.alloc(img.w * img.h * 4) };
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const s = (y * img.w + x) << 2;
      const d = ((x * out.w + (out.w - 1 - y)) << 2);
      img.data.copy(out.data, d, s, s + 4);
    }
  }
  return out;
}

/**
 * 面積平均でマスへ貼る。★**縮小と拡大を1つの式で扱う**ので、
 * 縮めたときにギザギザにならない。アルファは**事前乗算**して混ぜる
 * （しないと、透明な画素の黒が滲み出して輪郭が暗く濁る）
 */
function blit(dst, src, dx, dy, dw, dh, { flipX = false, flipY = false } = {}) {
  for (let y = 0; y < dh; y++) {
    const sy0 = (y * src.h) / dh, sy1 = ((y + 1) * src.h) / dh;
    for (let x = 0; x < dw; x++) {
      const sx0 = (x * src.w) / dw, sx1 = ((x + 1) * src.w) / dw;
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = Math.floor(sy0); sy < Math.max(Math.floor(sy0) + 1, Math.ceil(sy1)); sy++) {
        for (let sx = Math.floor(sx0); sx < Math.max(Math.floor(sx0) + 1, Math.ceil(sx1)); sx++) {
          if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue;
          const i = ((flipY ? src.h - 1 - sy : sy) * src.w + (flipX ? src.w - 1 - sx : sx)) << 2;
          const al = src.data[i + 3] / 255;
          r += src.data[i] * al; g += src.data[i + 1] * al; b += src.data[i + 2] * al;
          a += src.data[i + 3]; n++;
        }
      }
      if (!n) continue;
      const av = a / n;
      const o = ((dy + y) * dst.w + (dx + x)) << 2;
      if (av < 1) { dst.data[o + 3] = 0; continue; }
      const k = 255 / (av * n);
      dst.data[o] = Math.min(255, Math.round(r * k));
      dst.data[o + 1] = Math.min(255, Math.round(g * k));
      dst.data[o + 2] = Math.min(255, Math.round(b * k));
      dst.data[o + 3] = Math.round(av);
    }
  }
}

// ───────────────────────── 本体 ─────────────────────────

const debug = process.argv.includes('--debug');
if (debug) fs.mkdirSync('.shots/parts', { recursive: true });

const parts = {};
const aspect = {};
/** パーツの、元絵での外接矩形（trim 後）。レイアウトの数字を出すのに要る */
const trimmed = {};
/** キャラ全体の外接矩形 */
const bounds = {};

for (const [name, plan] of Object.entries(PLAN)) {
  const img = readPNG(`${SRC}/${name}.png`);
  { const t = {}; trim(img, t); bounds[name] = t.box; }
  for (const [part, spec] of Object.entries(plan)) {
    // ★`trim` を通すのは、指定した矩形に透明な余白があるとマスの中で位置がずれるから
    let piece = cut(img, spec.box);
    // ★焼き込まれた光彩やにじみを捨てる（`alphaTest 0.45` に届かない画素は実機でも消える）
    /*
     * ★**焼き込まれた白い光彩を落とす**（2026-09-13）。
     * この絵は背景が透明なのに、**縁のまわりに灰色の光が絵として描かれている**。
     * 灰色＝**彩度がほぼ無くて明るい**画素なので、そこだけ捨てる。
     * ★スリッパの色は残る —— 朱は彩度が高く、生成りの底も色味があり、輪郭の茶は暗い
     */
    if (spec.dropGrey) {
      for (let p = 0; p < piece.w * piece.h; p++) {
        const i = p << 2;
        const r = piece.data[i], g = piece.data[i + 1], b = piece.data[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx - mn < 28 && mx > 110) piece.data[i + 3] = 0;
      }
    }
    if (spec.alphaMin) { for (let p = 0; p < piece.w * piece.h; p++) if (piece.data[(p << 2) + 3] < spec.alphaMin) piece.data[(p << 2) + 3] = 0; }
    if (spec.keep) piece = keepBlob(piece, [spec.keep[0] - spec.box[0], spec.keep[1] - spec.box[1]]);
    const at = {};
    piece = trim(piece, at);
    if (spec.rot90) piece = rotate90(piece);
    trimmed[`${name}.${part}`] = [spec.box[0] + at.box[0], spec.box[1] + at.box[1], spec.box[0] + at.box[2], spec.box[1] + at.box[3]];
    console.log(`  ${name}.${part}: ${piece.w}x${piece.h}`);
    parts[`${name}.${part}`] = piece;
    aspect[`${name}.${part}`] = piece.w / piece.h;
  }
}

// 掲げる腕 ＝ 下ろした腕の上下反転（肩が下・手が上になる）
parts['hero.armUp'] = { ...parts['hero.arm'], flipY: true };
aspect['hero.armUp'] = aspect['hero.arm'];

// 既存のアトラスから、描き替えないマス（書類・影）をそのまま持ってくる
const old = readPNG(OUT);

const atlas = { w: SIZE, h: SIZE, data: Buffer.alloc(SIZE * SIZE * 4) };
for (const [key, col, row] of CELLS) {
  const dx = col * CELL, dy = row * CELL;
  if (key === 'keep') {
    /*
     * ★**古いアトラスから、描き替えないマス（書類・影）を持ってくる。**
     * ★古いアトラスと大きさが違うことがある（2048 → 1024 に縮めた日がある）ので、
     * **同じ添字でコピーしてはいけない。** マスを切り出して、貼り直す
     */
    const oc = old.w / GRID;
    blit(atlas, cut(old, [col * oc, row * oc, (col + 1) * oc - 1, (row + 1) * oc - 1]), dx, dy, CELL, CELL);
    continue;
  }
  const p = parts[key];
  if (!p) throw new Error(`パーツが無い: ${key}`);
  blit(atlas, p, dx + PAD, dy + PAD, CELL - PAD * 2, CELL - PAD * 2, { flipY: !!p.flipY });
  if (debug) writePNG(`.shots/parts/${key.replace('.', '-')}.png`, p);
}

writePNG(OUT, atlas);
console.log(`\n★ ${OUT} を書きました（${SIZE}x${SIZE}）`);

/*
 * ★**`cutoutLayout.ts` に書く数字を、道具側で出す**（2026-09-13）。
 *
 * 元絵の画素の位置から機械的に出せるものを手で当てにいくと、必ずズレる。
 * 身長 1.75・足元が y=0・体の中心が x=0 という `cutoutLayout.ts` の約束に合わせて換算する。
 * ★`PAD` のぶん（マスの内側の余白）だけパーツが小さく描かれるので、そこも戻してある
 */
const FIT = CELL / (CELL - PAD * 2);
console.log('\n--- cutoutLayout.ts に書く数字（元絵の位置から機械換算）---');
for (const name of Object.keys(PLAN)) {
  const b = bounds[name];
  const scale = 1.75 / (b[3] - b[1] + 1);
  const cx = (b[0] + b[2]) / 2, bottom = b[3];
  console.log(`  [${name}]  身長 ${b[3] - b[1] + 1}px → 1.75`);
  for (const part of Object.keys(PLAN[name])) {
    const t = trimmed[`${name}.${part}`];
    const w = (t[2] - t[0] + 1) * scale * FIT;
    const h = (t[3] - t[1] + 1) * scale * FIT;
    const x = ((t[0] + t[2]) / 2 - cx) * scale;
    const y = (bottom - (t[1] + t[3]) / 2) * scale;
    console.log(`    ${part.padEnd(8)} x: ${x.toFixed(2)}, y: ${y.toFixed(2)}, w: ${w.toFixed(2)}, h: ${h.toFixed(2)}`);
  }
}

/*
 * ★**組み立てプレビュー**（`--preview`）。
 * 切ったパーツを、上で計算した位置どおりに並べて1枚の絵にする。
 * ★**実機を立ち上げなくても「ちゃんと人の形になるか」が分かる**ので、
 * 絵を差し替えるたびにここで先に確かめる。実機で見るのはその後でいい
 */
if (process.argv.includes('--preview')) {
  const PPU = 380;                       // 1ユニットあたりの画素
  const CW = 700, CH = Math.round(1.9 * PPU);
  for (const name of Object.keys(PLAN)) {
    const b = bounds[name];
    const scale = 1.75 / (b[3] - b[1] + 1);
    const cx = (b[0] + b[2]) / 2, bottom = b[3];
    const canvas = { w: CW, h: CH, data: Buffer.alloc(CW * CH * 4) };
    const order = ['leg', 'body', 'head', 'arm', 'slipper'];
    for (const part of order) {
      const t = trimmed[`${name}.${part}`];
      if (!t) continue;
      const p = parts[`${name}.${part}`];
      const w = (t[2] - t[0] + 1) * scale, h = (t[3] - t[1] + 1) * scale;
      const x = ((t[0] + t[2]) / 2 - cx) * scale, y = (bottom - (t[1] + t[3]) / 2) * scale;
      const put = (sx, mir) => blit(canvas, p,
        Math.round(CW / 2 + (sx - w / 2) * PPU), Math.round(CH - (y + h / 2) * PPU),
        Math.round(w * PPU), Math.round(h * PPU), { flipX: mir });
      put(x, false);
      // 腕と脚は左右2枚。**反転して置く**（ゲームと同じ作法）
      if (part === 'arm' || part === 'leg') put(-x, true);
    }
    writePNG(`.shots/preview-${name}.png`, canvas);
    console.log(`  プレビュー: .shots/preview-${name}.png`);
  }
}
