import * as THREE from 'three';

/**
 * 紙のテクスチャをコードで作る（PROGRESS §15 / `PLAN.md`）。
 *
 * **起動時に canvas へ1回描いて普通のテクスチャにする。** フラグメントシェーダで
 * 毎フレーム計算するのではないので、実行時コストは通常のテクスチャ参照と同じ。
 * 外部素材ゼロなので初回DL（8MB目標・§6）も増えない。
 *
 * **タイル化が肝。** 継ぎ目が出ると地面全体が格子に見えて即バレするので、
 * 格子ノイズの座標を必ず法（size）で折り返している（`wrap` 参照）。
 * 「シームレスに作る」は画像素材でいちばん面倒な部分なので、
 * ここは**コードで作るほうが確実に有利**な領域。
 */

/** 決定的な疑似乱数。同じ座標なら必ず同じ値（毎回違う模様になると差分が出て困る） */
function hash(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

const wrap = (v: number, n: number): number => ((v % n) + n) % n;

/** 5次のスムーズステップ。3次だと格子の筋が残る */
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * タイル化する値ノイズ。`period` で必ず折り返すので上下左右が繋がる。
 * @param u @param v 0..1
 */
function tileNoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = fade(x - xi);
  const yf = fade(y - yi);
  const a = hash(wrap(xi, period), wrap(yi, period), seed);
  const b = hash(wrap(xi + 1, period), wrap(yi, period), seed);
  const c = hash(wrap(xi, period), wrap(yi + 1, period), seed);
  const d = hash(wrap(xi + 1, period), wrap(yi + 1, period), seed);
  return (a + (b - a) * xf) + ((c + (d - c) * xf) - (a + (b - a) * xf)) * yf;
}

function make(size: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return { c, g: c.getContext('2d') as CanvasRenderingContext2D };
}

function toTexture(c: HTMLCanvasElement, repeat: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * ★ 紙の地合い（T2）。**これ1枚を世界全体に乗算すると、全部が紙になる。**
 *
 * 単純な値ノイズだけだと「砂嵐」になるので、3つ重ねている:
 *  1. 大きいムラ（抄紙のムラ）
 *  2. 細かい粒（繊維の密度）
 *  3. **横方向に伸びた筋（繊維の流れ）** ← これが「紙」と「ノイズ」の分かれ目
 *
 * 明度は 0.86〜1.0 に収める。**濃いと画面全体が汚れて見える。**
 */
/**
 * ★**1枚しか作らない**（2026-08-24 / `GAMEPLAY.md` A-4）。
 *
 * この関数の冒頭コメント自身が「**これ1枚を**世界全体に乗算する」と書いているのに、
 * キャッシュが無かった。呼び出しは Obstacle×2 / Boss / Syain / Stairs / Crowd / Game×2 の
 * **8箇所で、同じ絵が8枚できていた**（検品の実測: 生成だけで 1111ms・GPU 上で 1MB×8）。
 * 起動が1秒遅いのは、携帯の実機ではもっと重い。`charAtlas` は最初からこれを持っていた。
 */
const grainCache = new Map<number, THREE.CanvasTexture>();

export function paperGrain(size = 512): THREE.CanvasTexture {
  const hit = grainCache.get(size);
  if (hit) return hit;
  const { c, g } = make(size);
  const img = g.createImageData(size, size);
  const d = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // 1) 大きいムラ
      const blotch = tileNoise(u, v, 8, 1) * 0.55 + tileNoise(u, v, 16, 2) * 0.45;
      // 2) 細かい粒
      const grain = tileNoise(u, v, 128, 3) * 0.6 + tileNoise(u, v, 256, 4) * 0.4;
      // 3) 繊維の流れ。**横に潰したノイズ**。これが無いと紙に見えない
      const fibre = tileNoise(u * 0.18, v, 96, 5);

      const n = blotch * 0.34 + grain * 0.40 + fibre * 0.26;
      // 0.86〜1.0 の狭い帯に写す
      const lum = 0.86 + n * 0.14;
      const px = (y * size + x) * 4;
      const b = Math.round(lum * 255);
      d[px] = b; d[px + 1] = b; d[px + 2] = b; d[px + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  // ごく少数の「ダマ」。均一だと機械的に見えるので、規則性を壊す点を少しだけ置く
  g.globalAlpha = 0.10;
  for (let i = 0; i < 90; i++) {
    const x = hash(i, 7, 11) * size;
    const y = hash(i, 13, 12) * size;
    const r = 0.7 + hash(i, 17, 13) * 2.0;
    g.fillStyle = hash(i, 19, 14) > 0.5 ? '#000' : '#fff';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  const tex = toTexture(c, 1);
  grainCache.set(size, tex);
  return tex;
}

/**
 * 地面（T3）＝**一枚の巨大な書類の面**。罫線と、うっすらした方眼。
 * **模様が目に入ったら失敗**なので、全部かなり薄い。
 */
export function groundSheet(size = 1024): THREE.CanvasTexture {
  const { c, g } = make(size);

  /*
   * ★**昇降口の床タイル**（本人決定 2026-08-23「書類はいらん」）。
   *
   * それまでは「一枚の書類の上を走る」つもりで罫線と方眼を描いていた。
   * 壁を下駄箱にするので、床が書類のままだと**世界が2つ混ざる**。
   *
   * タイルは 3列 × 5行。`Course.ts` の repeat(2,46) で貼ると
   * 1マスが約 1.83m 四方になる。実物の床タイルよりずっと大きいが、
   * **走る速さを目で数えられる大きさ**を優先した。
   * 細かくすると縮小でただの灰色の面になり、速度感が消える。
   */
  const GCOLS = 3;
  const GROWS = 5;
  /*
   * ★**実験1（2026-08-23）: 床だけ暗くする。**
   *
   * 参考（本家の実プレイ画面）を実測したら、**道の明度が30**だった。
   * こちらは72。**明暗の関係が逆になっていた。**
   *   参考 … 暗い道（30）の上に、明るい群衆（55）が乗る
   *   従来 … 明るい床（72）の上に、暗い群衆（37）が乗る
   * 群衆が画面で一番暗い＝「穴」に見えるので、主役として立たない。
   *
   * ここでは**床の色だけ**を変える（他は触らない）。
   * 効いたかどうかは `tools/look.js` で測る。
   */
  // 目地。下地として先に塗っておき、その上にタイルを内側へ寄せて置く。
  // **こうすると継ぎ目でも目地の幅が揃う**（端は半分ずつ出て、隣と合わさって1本になる）
  g.fillStyle = '#4a4b58';
  g.fillRect(0, 0, size, size);

  const grout = size * 0.006;
  const cw = size / GCOLS;
  const ch = size / GROWS;
  for (let r = 0; r < GROWS; r++) {
    for (let c2 = 0; c2 < GCOLS; c2++) {
      // タイルごとに明るさを散らす。**均一だと印刷物に見える**
      const n = tileNoise((c2 + 0.5) / GCOLS, (r + 0.5) / GROWS, 8, 17);
      const l = 0.92 + n * 0.10;
      // 冷たい灰紫。**暖色のまま暗くすると「泥」に見える**ので、青寄りに振る
      g.fillStyle = `rgb(${Math.round(104 * l)},${Math.round(106 * l)},${Math.round(122 * l)})`;
      g.fillRect(c2 * cw + grout, r * ch + grout, cw - grout * 2, ch - grout * 2);
    }
  }

  // タイルの中の細かいムラ。**これが無いと塗りつぶしたPowerPointに見える**
  const step = Math.max(2, Math.floor(size / 256));
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const n = tileNoise(x / size, y / size, 96, 5);
      if (n < 0.5) continue;
      g.fillStyle = `rgba(210,214,230,${((n - 0.5) * 0.10).toFixed(3)})`;
      g.fillRect(x, y, step, step);
    }
  }

  return toTexture(c, 1);
}

/**
 * 紙の断面（T6）。押し出した側面に巻く。
 * **厚みが見えることが「紙工作」の証拠**になる（`PLAN.md`）。
 */
export function cardboardEdge(w = 256, h = 64): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d') as CanvasRenderingContext2D;

  g.fillStyle = '#e8dcc4';
  g.fillRect(0, 0, w, h);
  // 上下のライナー（平らな外層）
  g.fillStyle = '#d9c9a8';
  g.fillRect(0, 0, w, h * 0.18);
  g.fillRect(0, h * 0.82, w, h * 0.18);

  // 波目。**周期を幅の約数にしないと継ぎ目が出る**
  const waves = 16;
  g.strokeStyle = '#c9b691';
  g.lineWidth = 3;
  g.beginPath();
  for (let x = 0; x <= w; x++) {
    const t = (x / w) * waves * Math.PI * 2;
    const y = h * 0.5 + Math.sin(t) * h * 0.26;
    if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();

  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
