/**
 * ゲートの「演算そのもの」。**three にも DOM にも依存しない純粋モジュール**にしてある。
 * 描画（Gate.ts）と生成（GateDirector.ts）の両方から使い、ヘッドレスで検証できる。
 */

/**
 * `mod` は §4-C ★「数学で差別化する」の本命（2026-08-22 実装）。
 *
 * このジャンルは四則演算しか持っておらず、遊びの中身で差別化できない。
 * 鍵は「**プレイヤーは式を解いていない。どちらが大きいかしか見ていない**」＝
 * 0.5秒で暗算できることは要件ではなく、**0.5秒で大小が決まればよい**。
 *
 * `mod k` は**何千人いても結果が最大 k−1 人**になるので、
 * 「大きい記号のほうを取る」で走ってきたプレイヤーを一度だけ完全に裏切る。
 * 記号だけで成立するので翻訳もいらない（§4-I のレッドラインを踏まない）。
 */
export type GateOp = 'add' | 'sub' | 'mul' | 'div' | 'mod' | MathOp;

/**
 * ★**数学ボケモードの演算**（32種）。**四則演算を1つも使わない**（`MATHMODE.md`）。
 * ★**`mod` はここに入れない** —— 既存モードでも使っている、このモードの原型だから
 */
export type MathOp =
  /*
   * ★★**つまみのある族**。`v` が「自由なつまみ」で、四則演算の `+452` / `+18` の
   * **452 や 18 に当たる**。★**これが無いと蓋を通れる札が数種しかなくなる**（`MATHMODE.md` §3）
   */
  | 'pow'      // n^k（指数・累乗根）。★`n⁰` `√n` `n¹` `n²` `n³` `∛n` を全部これ1つに吸収
  | 'log'      // log_b n（対数）。b が自由
  | 'deriv'    // (n^k)′ ＝ k·n^(k-1)（微分）。k が自由
  | 'deriv2'   // ★(n^k)″ ＝ k(k-1)·n^(k-2)（二階微分）。k が自由
  | 'integ'    // ∫₀ⁿ x^k dx ＝ n^(k+1)/(k+1)（積分）。k が自由
  /** ★**つまみの無い「素の札」**。逆算できないので、たまたま蓋に入ったときだけ出る */
  | 'pow2' | 'fact' | 'comb2' | 'tri' | 'gcd' | 'lcm' | 'ln'
  /*
   * ★★**積分の札**（2026-09-21・本人「Lv1〜5で、もう積分だしちゃおう！なんかこれが1番理系っぽいし」
   * 「Lv11〜とかでは、積分自体を難しくするか何か」「うおっ理系っぽい〜ってのを感じさせたい」）。
   * ★**`integ`（∫₀ⁿxᵏdx）がやさしい側**で、こちらは**顔が派手な側**
   */
  | 'intln'     // ∫₁ⁿ ln x dx ＝ n ln n − n + 1
  | 'intdbl'    // ∫₀ⁿ∫₀ⁿ dy dx ＝ n²。★**見た目は二重積分、中身は n²**
  | 'intexp'    // ∫₀ⁿ eˣ dx ＝ eⁿ − 1。★爆弾
  | 'intgamma'  // ∫₀^∞ x^(n−1) e^(−x) dx ＝ Γ(n)。★**ガンマ関数の積分表示**（大学）
  | 'intatan'   // ∫₀ⁿ dx/(1+x²) ＝ arctan n。★**π/2 未満なので必ず1人**（大学の罠）
  /*
   * ★★**2026-09-21 に足した顔**（本人「微分はいい感じだけどもっとバリエーションをだしていい」）。
   * ★**`dlogn2` が特に効く** —— **穏やかに増やす札**が `σ(n)` と `n^1.1` しか無く、
   * **増やす側の「迷う対」が作れない原因**になっていた（`MATHMODE.md` §8-3）
   */
  | 'dlogn'    // (n·ln n)′ ＝ ln n + 1。強い減らし
  | 'dlogn2'   // (n²·ln n)′ ＝ n(2ln n + 1)。★穏やかな増やし
  | 'sumsq'    // Σ[k=1..n] k² ＝ n(n+1)(2n+1)/6
  | 'limE'     // lim (1+1/n)ⁿ → e。★**何人いても必ず2人**（大学の罠）
  | 'phi' | 'sigma' | 'divisors' | 'primepi' | 'nthprime' | 'nextprime' | 'fib' | 'gamma' | 'mod2'
  /*
   * ★★**情報科学の札。いまはどの区画にも入れていない**（2026-09-21・本人指定
   * 「数学にしぼろー」）。**消さずに取ってある** —— 本人「情報科学系も作りたかったらそうできるし」。
   * ★`sim:math` は**これらも検査している**ので、使うときに壊れていることはない
   */
  | 'shl' | 'shr' | 'xor' | 'and' | 'or' | 'popcount' | 'rev' | 'digitsum' | 'digitprod'
  | 'bin10' | 'pow2floor';

/** その演算が相手の数（`v`）を使うか。使わない演算は `v: 0` で作る */
export const MATH_USES_V: ReadonlySet<MathOp> = new Set<MathOp>([
  'pow', 'log', 'deriv', 'deriv2', 'integ', 'shl', 'shr', 'gcd', 'lcm', 'xor', 'and', 'or', 'mod2',
]);

/** ★**つまみを逆算して作れる族**。`aimMath()` が「狙う人数」から `v` を出す */
export const MATH_TUNABLE: readonly MathOp[] = ['pow', 'log', 'deriv', 'deriv2', 'integ'];

/** ★**つまみの無い素の札（数学）**。人数しだいで出たり出なかったりするのが性格 */
export const MATH_PLAIN: readonly MathOp[] = [
  'pow2', 'fact', 'comb2', 'tri', 'gcd', 'lcm', 'ln',
  'intln', 'intdbl', 'intexp', 'intgamma', 'intatan',
  'dlogn', 'dlogn2', 'sumsq', 'limE',
  'phi', 'sigma', 'divisors', 'primepi', 'nthprime', 'nextprime', 'fib', 'gamma', 'mod2',
];

/** ★**情報科学の札。取ってあるだけで、いまはどの区画にも入っていない** */
export const MATH_CS: readonly MathOp[] = [
  'shl', 'shr', 'xor', 'and', 'or', 'popcount', 'rev', 'digitsum', 'digitprod', 'bin10', 'pow2floor',
];

export const MATH_OPS: readonly MathOp[] = [...MATH_TUNABLE, ...MATH_PLAIN, ...MATH_CS];

function isMath(op: GateOp): op is MathOp {
  return op !== 'add' && op !== 'sub' && op !== 'mul' && op !== 'div' && op !== 'mod';
}

export interface GateChoice {
  op: GateOp;
  v: number;
}

export function applyOp(n: number, c: GateChoice): number {
  switch (c.op) {
    case 'add': return n + c.v;
    // 味方は死なない（§4-G）が、0 人を下回る概念はない
    case 'sub': return Math.max(0, n - c.v);
    case 'mul': return Math.floor(n * c.v);
    case 'div': return Math.floor(n / c.v);
    // 何千人いても最大 c.v-1 人になる。**このゲートだけは人数を見ずに危険**
    case 'mod': return c.v <= 1 ? 0 : n % c.v;
    default: return applyMath(Math.max(0, Math.floor(n)), c.op, c.v);
  }
}

/**
 * ★**人数に関係なく必ず増える数学演算**。色分けに使う。
 * ★**「n しだい」のものはここに入れない** —— `mod` を損の色に寄せたのと同じ理由で、
 * **見た目で得だと誤解させたら罠ではなく事故になる**
 */
/**
 * ★★**増える枠か。色分けと SE の出し分けに使う。**
 *
 * ★**2026-09-21: 「増える札の一覧」をやめた。**
 * 前は `MATH_ALWAYS_GAIN` という手書きの集合で決めていたが、
 * **`Γ(n)` は n≧4 で・`Fₙ` は n≧6 で増える**（それ未満では減る）ので、
 * ★**一覧にどう書いても、ある人数では必ず嘘になる**
 * —— 本人の実機「**赤色なのに、通ったら数が増えた**」がこれ。
 * `tools/gain-check.ts` で洗ったら **`Γ(n)` `Fₙ` `lcm` `ₙC₂` の4枚が嘘**をついていた。
 *
 * ★**いまは実際に計算して比べる。** 札が何であっても、これから足す札であっても嘘にならない。
 * ★**`count` が 0（人数が分からない場面）のときだけ、昔ながらの当て推量に落ちる**
 * —— 四則演算は人数に関係なく向きが決まるので、そこは今までと同じ
 */
export function isGain(c: GateChoice, count = 0, over = 0): boolean {
  if (!isMath(c.op)) return c.op === 'add' || c.op === 'mul';
  // ★理系用は桁で比べる（上限 10³⁰⁰ を越えた人数でも、`n²` は増える色になる）
  if (count > 0) return cmpBig(applyOpBig(count, over, c), { n: count, over }) > 0;
  // 人数が分からないとき用の目安（つまみで向きが決まる族だけは確実に分かる）
  switch (c.op) {
    case 'pow': return c.v >= 1;
    case 'shl': return true;
    case 'shr': case 'log': case 'ln': return false;
    case 'deriv': return c.v >= 2;
    case 'deriv2': return c.v >= 3;
    case 'dlogn': return false;
    case 'dlogn2': return true;
    case 'integ': return c.v >= 1;
    default: return false;
  }
}

const SIGN: Record<'add' | 'sub' | 'mul' | 'div' | 'mod', string> = {
  add: '+',
  sub: '\u2212', // MINUS SIGN。ハイフンだと細くて遠くから読めない
  mul: '\u00d7',
  div: '\u00f7',
  // 「%」ではなく mod と書く。% は割合と誤読されるが、mod は見慣れない記号として警戒される
  mod: 'mod ',
};

/**
 * ★**数学演算の札**。**`n` を書いたまま出す** —— 「いまの人数に何が起きるか」を
 * 記号で見せるのが目的で、計算結果を見せるのではない（結果を見せたら考える余地が消える）。
 *
 * ★★**このモードは §4-I の言語不要要件を、本編より強く満たす。**
 * 社員は日本語で喋っているが（`LINES.syain`）、`√` `²` `log` `φ` `⊕` は**翻訳がいらない**。
 *
 * ★**`%s` は相手の数（`v`）の差し込み位置**。使わない演算には入れない
 */
const MATH_SIGN: Record<MathOp, string> = {
  pow: 'n^%s', log: 'log%s n', deriv: '(n^%s)\u2032', deriv2: '(n^%s)\u2033',
  integ: '\u222b\u2080\u207f x^%s dx',
  dlogn: '(n\u00b7ln n)\u2032', dlogn2: '(n\u00b2\u00b7ln n)\u2032',
  sumsq: '\u03a3k\u00b2', limE: 'lim(1+1/n)\u207f',
  ln: '\u222b\u2081\u207f dx/x', gamma: '\u0393(n)', mod2: 'n mod %s',
  intln: '\u222b\u2081\u207f ln x dx', intdbl: '\u222b\u2080\u207f\u222b\u2080\u207f dy dx',
  intexp: '\u222b\u2080\u207f e\u02e3 dx', intgamma: '\u222b\u2080^\u221e x\u207f\u207b\u00b9e\u207b\u02e3dx',
  intatan: '\u222b\u2080\u207f dx/(1+x\u00b2)',
  shl: 'n\u226a%s', shr: 'n\u226b%s',
  pow2: '2\u207f', fact: 'n!', comb2: '\u2099C\u2082', tri: 'T\u2099',
  phi: '\u03c6(n)', sigma: '\u03c3(n)', divisors: 'd(n)',
  primepi: '\u03c0(n)', nthprime: 'p\u2099', nextprime: 'next p', fib: 'F\u2099',
  gcd: 'gcd(n,%s)', lcm: 'lcm(n,%s)',
  rev: 'rev(n)', digitsum: 'S(n)', digitprod: '\u03a0(n)', popcount: 'bits(n)',
  xor: 'n\u2295%s', and: 'n\u2227%s', or: 'n\u2228%s',
  pow2floor: '2^\u230alog\u2082n\u230b', bin10: '(n)\u2082',
};

/** 添字の数字（`log\u2082n` のような見慣れた形にするため） */
const SUB = '\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089';
const toSub = (v: number): string => String(v).split('').map((d) => SUB[Number(d)] ?? d).join('');

/**
 * ★**べき乗の札の顔**。**見慣れた形があるときはそれで出す。**
 * 同じ `pow` 族だと気づかせるのは後の区画でよく、
 * ★**まず「あ、ルートだ」と読めるほうが大事**（0.5秒で大小を決めるゲームなので）
 */
function powLabel(k: number): string {
  if (k === 0) return 'n\u2070';
  if (k === 1) return 'n\u00b9';
  if (k === 2) return 'n\u00b2';
  if (k === 3) return 'n\u00b3';
  if (k === 0.5) return '\u221an';
  if (k === 0.33) return '\u221bn';
  // 小数はそのまま出す。★**末尾の 0 は落とす**（`n^1.20` より `n^1.2`）
  return `n^${String(k)}`;
}

/** 記号だけで表す＝文字を出さないので翻訳不要（§4-D の罪状アイコンと同じ思想） */
export function gateLabel(c: GateChoice): string {
  if (!isMath(c.op)) return SIGN[c.op] + c.v;
  if (c.op === 'pow') return powLabel(c.v);
  if (c.op === 'log') return `log${toSub(c.v)}n`;
  /*
   * ★**微分と積分は「式そのもの」を札に出す**（2026-09-21・本人指定）。
   * ★**`(n\u00b2)\u2032` は計算すると `2n` ＝ ちょうど2倍**。効き目は情報科学の `n\u226a1` と同じだが、
   * **顔が高校数学になる** —— これがこのモードの狙い
   */
  if (c.op === 'deriv') return `(${powLabel(c.v)})\u2032`;
  if (c.op === 'deriv2') return `(${powLabel(c.v)})\u2033`;
  if (c.op === 'integ') return `\u222b\u2080\u207f ${powLabel(c.v).replace('n', 'x')} dx`;
  return MATH_SIGN[c.op].replace('%s', String(c.v));
}

/**
 * `mod` は「増える枠」ではないが「減る枠」でもない（人数しだい）。
 * 色は損の側に寄せる —— **見た目で得だと誤解させたら罠ではなく事故になる**
 */

/**
 * §4-C: 通過判定は **群衆の中心X のみ**。個体で判定して分裂させない。
 * 端をはみ出しても必ずどれかに入る（クランプ）ので「どっちにも入らなかった」が起きない。
 */
export function pickIndex(centerX: number, n: number, courseWidth: number): number {
  const i = Math.floor((centerX + courseWidth / 2) / (courseWidth / n));
  return i < 0 ? 0 : i > n - 1 ? n - 1 : i;
}

/**
 * ★**動く境界での枠の判定**（2026-08-26）。
 * `pickIndex` は等分前提なので、境界が動くゲート（横滑り・時限）では使えない。
 * **絵を作るのと同じ `bounds` 配列**を渡すこと ——
 * 別々に計算すると「見えている枠と当たる枠がずれる」という最悪のバグになる。
 *
 * @param bounds 0..1 の昇順、n+1 個
 */
export function pickBounds(centerX: number, bounds: readonly number[], courseWidth: number): number {
  const u = (centerX + courseWidth / 2) / courseWidth;
  for (let i = 0; i < bounds.length - 1; i++) {
    if (u < bounds[i + 1]) return i;
  }
  return bounds.length - 2;
}

/* =====================================================================
 * ゲートの境界（2026-08-28 にここへ移した）
 * ================================================================== */

/** `gateBounds` が読むつまみだけ。`GateKnobs` はこれを構造的に満たす */
export interface GateShapeKnobs {
  readonly slideAmp: number;
  readonly slideSpeed: number;
  readonly timedTell: number;
  readonly timedShut: number;
  readonly reachAim: number;
  readonly reachMinFrame: number;
}

export type GateShape = 'plain' | 'slide' | 'timed' | 'hidden';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * **枠の境界（0..1 の n+1 個）。絵と判定はこの1つの配列を共有する。**
 *
 * ★**2026-08-28: 可動域クランプを入れた。ここが今回の修正の本体。**
 *
 * それまで境界は「コース幅 11m に対する比」だけで動いていたが、
 * プレイヤーが実際に立てる帯は `lateralHalfWidth()` が決める狭い帯で、
 * **大群だと ±2.2m しかない**。Lv6 の時限ゲートは境界が x=−4.62m まで寄るので、
 * ★**痩せた枠は「狭くて通りにくい」のではなく、そもそも到達できなかった。**
 * 実プレイで「どうあがいても −1034 しか選べない」という形で出た（2026-08-28）。
 *
 * ★**痩せ具合（`timedShut`）は下げていない。** 選択は群れの**中心**の位置だけで決まるので
 * （`pickBounds`）、枠が細くても中心さえ入れば人数は1人も減らない。
 * **問題は幅ではなく位置**だったので、**動かせる範囲だけを可動域の内側に閉じ込めた。**
 *
 * 副作用として、**群れが太るほどゲートの閉じ方が穏やかになる**。
 * これは緩和ではなく整合で、「可動域が狭いほど要求も狭くする」という同じ規則の裏表。
 *
 * @param z        ゲートまでの相対距離。手前が負、通過が 0
 * @param n        枠の数
 * @param halfWidth いまプレイヤーが動ける半幅（m）。`lateralHalfWidth()` の戻り値
 * @param courseWidth コース幅（m）
 */
export function gateBounds(
  shape: GateShape,
  phase: number,
  z: number,
  n: number,
  g: GateShapeKnobs,
  halfWidth: number,
  courseWidth: number,
): number[] {
  const b: number[] = [];
  for (let i = 0; i <= n; i++) b.push(i / n);
  if (n < 2) return b;

  let shift = 0;
  if (shape === 'slide') {
    shift = Math.sin(-z * 0.1 * g.slideSpeed + phase) * g.slideAmp;
  } else if (shape === 'timed') {
    // z は手前で負。-tell → 0 で 0 → 1 に進む
    const u = clamp((z + g.timedTell) / g.timedTell, 0, 1);
    shift = phase * u * (1 / n - g.timedShut / n);
  }
  for (let i = 1; i < n; i++) b[i] += shift;

  /*
   * ★**可動域クランプ。**
   * 内側の境界を、プレイヤーが届く帯の内側だけに閉じ込める。
   * `i` 番目の境界は左に i-1 枚、右に n-1-i 枚の枠を連れているので、
   * その枚数ぶんの最小幅を残した範囲に収める。**これで順序と最小幅が同時に保証される。**
   */
  const limM = Math.max(0.4, halfWidth - g.reachAim);
  const lo = 0.5 - limM / courseWidth;
  const hi = 0.5 + limM / courseWidth;
  const minW = g.reachMinFrame / courseWidth;
  for (let i = 1; i < n; i++) {
    const loI = lo + (i - 1) * minW;
    const hiI = hi - (n - 1 - i) * minW;
    b[i] = clamp(b[i], Math.min(loI, hiI), Math.max(loI, hiI));
  }
  return b;
}

/**
 * **その境界が「全部の枠を選べる」形になっているかを判定する。**
 * `sim:gate` の合格条件。★この検査があれば、つまみをどう触っても
 * 2026-08-28 の理不尽（届かない枠）は二度と本番に出ない。
 *
 * @returns 届かない枠の番号の一覧。空なら合格
 */
export function unreachableFrames(
  bounds: readonly number[],
  halfWidth: number,
  courseWidth: number,
  needM = 0.35,
): number[] {
  const lo = 0.5 - halfWidth / courseWidth;
  const hi = 0.5 + halfWidth / courseWidth;
  const need = needM / courseWidth;
  const bad: number[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const overlap = Math.min(bounds[i + 1], hi) - Math.max(bounds[i], lo);
    if (overlap < need) bad.push(i);
  }
  return bad;
}

/* ═══════════════════════════════════════════════════════════════════════
 * ★★★**数学ボケモードの演算**（2026-09-20・本人案）。仕様は `MATHMODE.md`。
 *
 * > **本人:「ゲートが、全部数式でめっちゃむずい。四則演算を一切入れない、理系ゲート」**
 *
 * ★**核は四則演算のときと1ミリも変わらない。**「解く」のではなく**どちらが大きいか**。
 * `mod` が「何千人いても k−1 人になる」で一度だけ裏切るのと同じ構造を、32通りに増やす。
 *
 * ★**`v` を使う演算と使わない演算がある。** `gcd` `lcm` `xor` `and` `or` `mod` は
 * `v` が相手の数。それ以外は `v` を見ない（`0` を入れておく）。
 * ★**引数の形（`applyOp(n, c)`）は変えていない**ので、`Gates` も `GateDirector` も
 * 測定器4本（`balance` / `skill` / `gate-sim` / `trap-check`）も構造は同じまま動く。
 * ════════════════════════════════════════════════════════════════════ */

/**
 * ★**人数の上限。** `n²` や `(n)₂` はゲート1枚で 10⁹ に行くので、**演算の出口で必ず蓋をする。**
 *
 * ★★**ここが定義の唯一の場所**。`CFG.crowd.maxCount` はこれを参照している ——
 * 同じ数字を2か所に書くと、このリポジトリが何度も踏んでいる型になる。
 * ★**5桁にした理由**: HUD の札の幅を作り直さずに収まる
 */
export const MAX_CROWD = 99_999;

/**
 * ★★**理系用の人数の上限**（2026-09-26・本人「上限を撤廃して変化を絶対に優先」）。
 * 99,999 で蓋をしていたせいで、人数が増えると `n!` `2ⁿ` `ₙC₂` などが**全部「上限超え」で使えなくなり**、
 * 残るのが `n^k` `(n^k)′` `∫xᵏ` の3族だけになっていた（Lv13 が Lv2 と同じ顔ぶれに見えた原因）。
 * ★**実質の撤廃**。10³⁰⁰ は JS の数（〜1.8×10³⁰⁸）が壊れない所までの余白で、表示は `fmtCount` が `×10ⁿ` にする。
 * ★**ふつう／ハードは今までどおり `MAX_CROWD`**（`CFG.crowd.maxCount`）
 */
export const MATH_MAX = 1e300;

/** 演算の出口。**負にも小数にも上限超えにもしない**（NaN も 0 に落とす） */
const capped = (v: number): number => (!(v > 0) ? 0 : v >= MATH_MAX ? MATH_MAX : Math.floor(v));

/**
 * ★★**その人数で、その札が「正しく計算できるか」**（2026-09-26・上限の撤廃と一緒に足した）。
 * 上限が 99,999 だった間は全部の札が必ず計算できたが、**10¹⁵ 人の φ(n) は割り算を 3,000万回**回すことになる。
 * ★**計算できない人数では、その札は出さない**（`usableByFamily` が見る）。嘘の答えを出すより出さないほうがいい
 */
export function mathDefined(op: MathOp, n: number): boolean {
  switch (op) {
    // ★1e8 まで（割り算 1万回）。札の色は毎フレーム計算するので、ここが重いと端末が詰まる
    case 'phi': case 'sigma': case 'divisors': return n <= 1e8;
    case 'primepi': case 'nextprime': return n < SIEVE_MAX;
    case 'nthprime': return n <= 99_999;
    // ★`n!` `2ⁿ` `Fₙ` などは、大きい n では**上限（10³⁰⁰）に届くのが正しい答え**なので外さない
    case 'shl': case 'shr': case 'xor': case 'and': case 'or': case 'popcount':
    case 'rev': case 'digitsum': case 'digitprod': case 'bin10': case 'pow2floor':
      return n <= 2 ** 31 - 1;
    default: return true;
  }
}

const SUP = '\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079';
/**
 * ★★**人数の書き方**（2026-09-26・本人「10の何乗とか簡単に」）。
 * 100万人未満はいつもどおり `12,345`、それ以上は `1.2×10¹⁵`。HUD・数字ポップ・リザルトで共有する
 */
export function fmtCount(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) < 1e6) return v.toLocaleString();
  let e = Math.floor(Math.log10(Math.abs(v)));
  let m = v / 10 ** e;
  if (Math.abs(m) >= 9.95) { m /= 10; e++; }
  return `${m.toFixed(1)}\u00d710${String(e).split('').map((d) => SUP[Number(d)]).join('')}`;
}

/** 素数の表。`π(n)` と `pₙ` と `nextprime` が共有する。**1度だけ作る** */
let sieve: Uint8Array | null = null;
/** ★`pₙ` の上限（99,999 番目の素数は 1,299,709）まで引けるように取る */
const SIEVE_MAX = 1_300_000;
function primes(): Uint8Array {
  if (sieve) return sieve;
  const s = new Uint8Array(SIEVE_MAX + 1).fill(1);
  s[0] = 0; s[1] = 0;
  for (let i = 2; i * i <= SIEVE_MAX; i++) {
    if (!s[i]) continue;
    for (let j = i * i; j <= SIEVE_MAX; j += i) s[j] = 0;
  }
  sieve = s;
  return s;
}

/** ★素数の個数の累積 `pi[k]`（k 以下の素数の数）と素数の並び。**1度だけ作る**（表引きで O(1)） */
let tables: { pi: Uint32Array; list: Uint32Array } | null = null;
function primeTables(): { pi: Uint32Array; list: Uint32Array } {
  if (tables) return tables;
  const s = primes();
  const pi = new Uint32Array(SIEVE_MAX + 1);
  const list: number[] = [];
  for (let i = 2; i <= SIEVE_MAX; i++) {
    pi[i] = pi[i - 1] + s[i];
    if (s[i]) list.push(i);
  }
  tables = { pi, list: Uint32Array.from(list) };
  return tables;
}

/** オイラー関数 φ(n)。★**n が素数なら n−1**（ほぼ無傷）、合成数なら激減 */
function phi(n: number): number {
  let r = n, m = n;
  for (let p = 2; p * p <= m; p++) {
    if (m % p) continue;
    while (m % p === 0) m /= p;
    r -= r / p;
  }
  if (m > 1) r -= r / m;
  return Math.floor(r);
}

/** 約数の和 σ(n)。★**増える側**。2n と比べると「過剰数か不足数か」そのもの */
function sigma(n: number): number {
  let r = 0;
  for (let d = 1; d * d <= n; d++) {
    if (n % d) continue;
    r += d;
    const e = n / d;
    if (e !== d) r += e;
  }
  return r;
}

/** 約数の個数 d(n)。1000 でも 16 */
function divisorCount(n: number): number {
  let r = 0;
  for (let d = 1; d * d <= n; d++) {
    if (n % d) continue;
    r += n / d === d ? 1 : 2;
  }
  return r;
}

function gcd(a: number, b: number): number {
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}

/** 桁を逆に読む。★**1000 → 0001 → 1 人**。末尾が 0 なら即死 */
function reverseDigits(n: number): number {
  return Number(String(n).split('').reverse().join(''));
}

/** 桁の積。★**0 が1桁でもあれば全滅** */
function digitProduct(n: number): number {
  let r = 1;
  for (const ch of String(n)) r *= Number(ch);
  return r;
}

function digitSum(n: number): number {
  let r = 0;
  for (const ch of String(n)) r += Number(ch);
  return r;
}

/** 2進表記の 1 の個数。最大でも 17 前後 */
function popcount(n: number): number {
  let r = 0;
  for (let v = n; v > 0; v >>>= 1) r += v & 1;
  return r;
}

/**
 * ★**演算の本体**（`applyOp` から呼ばれる）。**すべて `capped` を通して返す。**
 * `n` は 0 以上の整数、`v` は相手の数（使わない演算もある）
 */
function applyMath(n: number, op: MathOp, v: number): number {
  const P = primes;
  /*
   * ★★**計算しきれない人数では、近似で答える**（2026-09-26・実機で固まった）。
   * 札は「見込み人数」で選ぶが、答えは**実際の人数**で出す。見込みが 100人で `σ(n)` を出したあと、
   * 実人数が 10¹⁵ だと割り算を 3,000万回、10³⁰⁰ だと**永遠に**回っていた（ブラウザで 100走行を回して見つけた）。
   * ★大きい n では表示が `×10ⁿ` なので、近似で十分（平均的な値を返す）
   */
  if (!mathDefined(op, n)) {
    const L = Math.log(n);
    switch (op) {
      case 'phi': return capped(n * 6 / Math.PI ** 2);      // φ(n) の平均は 6n/π²
      case 'sigma': return capped(n * Math.PI ** 2 / 6);    // σ(n) の平均は π²n/6
      case 'divisors': return capped(L);                     // d(n) の平均は ln n
      case 'primepi': return capped(n / L);                  // 素数定理
      case 'nthprime': return capped(n * (L + Math.log(L))); // pₙ ≒ n(ln n + ln ln n)
      case 'nextprime': return capped(n + L);                // 素数の間隔の平均は ln n
      default: return capped(n);                             // 情報科学の札（いまは出さない）
    }
  }
  switch (op) {
    /*
     * ★★**べき乗の族**（2026-09-21）。**`v` が指数 k**。
     * `n⁰`（必ず1人）`√n`（k=0.5）`n¹`（無変化）`n²` `n³` `∛n` は**全部この1つ**。
     * ★**k は小数でよい** —— 本人「整数じゃなくなるけどそれが、数学モードの面白さ」
     */
    case 'pow': {
      if (v <= 0) return 1;            // n⁰ ＝ 1。★人数に関係なく1人
      if (n <= 1) return capped(n);    // 0^k も 1^k も自分自身
      return capped(n ** v);
    }
    // ★**対数の族。`v` が底。** 底が大きいほど激しく減る
    case 'log': {
      if (n < 1) return 0;
      const b = v < 2 ? 2 : v;
      return capped(Math.log(n) / Math.log(b));
    }
    /*
     * ★★**微分の族**（2026-09-21・本人「高校数学までの範囲が最多で」）。
     * **(n^k)′ ＝ k·n^(k−1)**。★**`k=2` なら `2n` ＝ ちょうど2倍**で、
     * 情報科学の `n≪1`（ビットずらし）と**効き目は同じまま顔だけ高校数学になる**
     */
    case 'deriv': {
      if (n < 1 || v <= 0) return 0;
      return capped(v * n ** (v - 1));
    }
    /*
     * ★**積分の族**。**∫₀ⁿ xᵏ dx ＝ n^(k+1)/(k+1)**。
     * `k=1` なら `n²/2`、`k=0` なら `n` そのもの
     */
    case 'integ': {
      if (n < 1 || v < 0) return 0;
      return capped(n ** (v + 1) / (v + 1));
    }
    /*
     * ★**二階微分 (n^k)″ ＝ k(k−1)·n^(k−2)**（2026-09-21）。
     * ★**`(n³)″ ＝ 6n`** と、**微分と同じ形なのに答えが1段ずれる**のがこの札の役目。
     * ★`k=2` は **k(k−1)n⁰ ＝ 2** で**何人いても2人**（微分の顔をした罠）
     */
    case 'deriv2': {
      if (n < 1 || v <= 1) return 0;
      return capped(v * (v - 1) * n ** (v - 2));
    }
    // ★**(n·ln n)′ ＝ ln n + 1**。微分の顔をした強い減らし
    case 'dlogn': return n < 1 ? 0 : capped(Math.log(n) + 1);
    // ★★**(n²·ln n)′ ＝ n(2·ln n + 1)**。**穏やかに増やす札**（2〜3倍くらい）
    case 'dlogn2': return n < 1 ? 0 : capped(n * (2 * Math.log(n) + 1));
    // ★**Σ[k=1..n] k² ＝ n(n+1)(2n+1)/6**。n=20 で 2,870。小さいときの爆弾
    case 'sumsq': return capped((n * (n + 1) * (2 * n + 1)) / 6);
    /*
     * ★★**lim (1+1/n)ⁿ → e**。★**何人いても必ず2人**（e ≒ 2.718 の切り捨て）。
     * `n⁰` と同じ全滅だが、**e に収束することを知らないと避けられない**
     */
    case 'limE': return n < 1 ? 0 : capped((1 + 1 / n) ** n);
    // ★**∫₁ⁿ dx/x ＝ ln n**。積分の顔をした自然対数。底 e の `log` と同じもの
    case 'ln': return n < 1 ? 0 : capped(Math.log(n));
    // ★**∫₁ⁿ ln x dx ＝ n ln n − n + 1**。n log n くらいで増える
    case 'intln': return n < 1 ? 0 : capped(n * Math.log(n) - n + 1);
    // ★**二重積分だが中身は n²**。顔が派手なだけ ―― これがこのモードの「理系ボケ」
    case 'intdbl': return capped(n * n);
    // ★**∫₀ⁿ eˣ dx ＝ eⁿ − 1**。n=12 で既に上限超え。**小さいときだけ神札**
    case 'intexp': return capped(Math.exp(n) - 1);
    // ★**ガンマ関数の積分表示。Γ(n) ＝ (n−1)!** と同じ値。顔だけが派手
    case 'intgamma': return applyMath(n, 'gamma', 0);
    /*
     * ★★**∫₀ⁿ dx/(1+x²) ＝ arctan n**。arctan は **π/2 ≒ 1.5707 を超えない**ので、
     * **何人いても必ず1人**。`n⁰` と同じ即死だが、**気づくには arctan の上限を知っている必要がある**
     */
    case 'intatan': return n < 1 ? 0 : capped(Math.atan(n));
    // ★**ガンマ関数 Γ(n) ＝ (n−1)!**。階乗を実数へ広げたもの（大学）
    case 'gamma': {
      let r = 1;
      for (let i = 2; i < n; i++) { r *= i; if (r >= MATH_MAX) return MATH_MAX; }
      return capped(r);
    }
    // ★**合同式 n ≡ ? (mod k)**。`mod` と同じ計算だが、数学の顔で出す
    case 'mod2': return v <= 1 ? 0 : capped(n % v);
    // ★**ビットずらし。`v` がずらす幅** —— `n≪2` は4倍、`n≫3` は 1/8
    case 'shl': return capped(n * 2 ** Math.max(1, Math.round(v)));
    case 'shr': return capped(Math.floor(n / 2 ** Math.max(1, Math.round(v))));

    // 2ⁿ は n=17 で既に上限を超える。★**小さいときだけ神札**（`mod` の鏡像）
    case 'pow2': return capped(2 ** n);
    // n! は n=9 で既に上限超え。★**n≦7 でしか成立しない罠**
    case 'fact': {
      let r = 1;
      for (let i = 2; i <= n; i++) { r *= i; if (r >= MATH_MAX) return MATH_MAX; }
      return capped(r);
    }
    case 'comb2': return capped((n * (n - 1)) / 2);
    case 'tri': return capped((n * (n + 1)) / 2);
    case 'phi': return n < 1 ? 0 : capped(phi(n));
    case 'sigma': return n < 1 ? 0 : capped(sigma(n));
    case 'divisors': return n < 1 ? 0 : capped(divisorCount(n));
    case 'primepi': {
      if (n < 2) return 0;
      // ★表引き（前は毎回 n まで数えていた。札の色は毎フレーム計算するので 130万回×札の数になる）
      return capped(primeTables().pi[Math.min(Math.floor(n), SIEVE_MAX)]);
    }
    // n 番目の素数。★**増える側**。だいたい n·ln n
    case 'nthprime': {
      if (n < 1) return 0;
      const list = primeTables().list;
      return n <= list.length ? capped(list[Math.floor(n) - 1]) : MATH_MAX;
    }
    case 'nextprime': {
      const s = P();
      for (let i = Math.max(2, n); i <= SIEVE_MAX; i++) if (s[i]) return capped(i);
      return MATH_MAX;
    }
    case 'fib': {
      let a = 0, b = 1;
      for (let i = 0; i < n; i++) { const t = a + b; a = b; b = t; if (a >= MATH_MAX) return MATH_MAX; }
      return capped(a);
    }
    case 'gcd': return v <= 0 ? 0 : capped(gcd(n, v));
    case 'lcm': return v <= 0 || n <= 0 ? 0 : capped((n / gcd(n, v)) * v);
    case 'rev': return capped(reverseDigits(n));
    case 'digitsum': return capped(digitSum(n));
    case 'digitprod': return capped(digitProduct(n));
    case 'popcount': return capped(popcount(n));
    case 'xor': return capped(n ^ v);
    case 'and': return capped(n & v);
    case 'or': return capped(n | v);
    // 2 のべきへ切り下げ。最大で半減
    case 'pow2floor': return n < 1 ? 0 : capped(2 ** Math.floor(Math.log2(n)));
    // ★**2進表記を10進で読む**。12 → 1100。理系ボケの極み
    case 'bin10': return n < 1 ? 0 : capped(Number(n.toString(2)));
  }
}

/* ══════════════════════════════════════════════════════════════════════
 * ★★★**つまみの逆算**（2026-09-21）。`MATHMODE.md` §3-4。
 *
 * > **本人:「今までは四則演算でも、+452,+18みたいに幅があったからよかった。
 * > これを数学モードでどう出すかっていう感じだな」**
 *
 * ★**`+A` の A に当たるものを、数式の札にも作る。**
 * `crossPoint()` が「いまの人数で損得がひっくり返る A」を逆算しているのと同じ作法で、
 * **「いまの人数 n を、狙った人数 want にする k」**を逆算する。
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * ★★**つまみの候補**（2026-09-21）。**札に出す値そのもの**なので、
 * ここに並んでいる値しか出ない ＝ **見分けのつかない札が量産されない。**
 *
 * ★**前は逆算した生の値を 0.05 刻みに丸めていた**が、族が4つに増えて
 * （`deriv` は k·n^(k−1) なので閉じた式で逆算できない）**総当たりのほうが素直になった**。
 * 候補は高々22個・族は4つなので、1枚作るのに百回ほどの掛け算。**毎フレームではないので十分速い**
 */
const GRID: Partial<Record<MathOp, readonly number[]>> = {
  // 指数。★見慣れた顔（`∛n` `√n` `n²` `n³`）が出るように、その値を必ず含める
  pow: [0, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.33, 1.5, 1.75, 2, 2.5, 3],
  // 対数の底。★2 と 10 は高校で必ず出る
  log: [2, 3, 4, 5, 6, 8, 10, 16, 20, 32, 50],
  // 微分の指数。★**`k=2` が `2n` ＝ ちょうど2倍**（情報科学の `n≪1` の置き換え）
  // ★**k の幅を広げた**（本人「(n^2)' 以外見たの一個ぐらい」）。k=2 が 2n、k=3 が 3n²
  deriv: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5],
  deriv2: [2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 4],
  // 積分の指数
  integ: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3],
};

/**
 * `n` を `want` に近づけるつまみを、族ごとに総当たりで探す。**作れないときは `null`**。
 *
 * ★★**「狙いと同じ向きに動く候補」だけを見る。** 近さだけで選ぶと
 * **増やしたいのに減る札**が返ってきて、呼び出し側が毎回捨てることになる。
 * ★**ぴったり当てることは要件ではない** —— `+452` も「ちょうど」ではなく「その辺」でよい
 */
export function aimMath(op: MathOp, n: number, want: number, anyDirection = false): number | null {
  if (n < 2 || want < 1) return null;
  const grid = GRID[op];
  if (!grid) return null;
  const up = want > n;
  let best: number | null = null;
  let bestGap = Infinity;
  for (const v of grid) {
    if (!mathDefined(op, n)) return null;
    const r = applyMath(n, op, v);
    if (r < 1) continue;
    /*
     * ★狙いが増やす側なら増える候補だけ、減らす側なら減る候補だけ。
     * ★**`anyDirection` は「顔の相方」を作るとき用**（2026-09-21）——
     * 相方に要るのは**顔の結果に近いこと**で、**人数から見た向きはどちらでもよい**
     */
    if (!anyDirection && (up ? r <= n : r >= n)) continue;
    const gap = Math.abs(r - want);
    if (gap < bestGap) { bestGap = gap; best = v; }
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════════════
 * ★★★**説明書**（2026-09-21・本人指定）。
 *
 * > **本人:「理系用モード選択したらさ、ホーム画面に、数式の説明が書いてある説明書も
 * > 追加してくれない？ 俺自身、『next pってなんだ...? なんだこの関数...?』ってなることがある」**
 *
 * ★★**札の実装と同じファイルに置く。** 別ファイルにすると
 * **札を足したときに説明だけ古くなる** —— このリポジトリが何度も踏んでいる型。
 * ★**`npm run sim:math` が「区画で使っている札すべてに説明があるか」を検査する**ので、
 * **書き忘れたら検査が落ちる。**
 * ═══════════════════════════════════════════════════════════════════ */

export interface MathHelp {
  /** 日本語の呼び名 */
  readonly name: string;
  /** ひとことの意味。★**別の専門用語で説明しない** */
  readonly desc: string;
  /** 具体例。★**必ず数字を1つ入れる**（意味より例のほうが速く伝わる） */
  readonly ex: string;
}

export const MATH_HELP: Readonly<Record<MathOp, MathHelp>> = {
  pow: { name: 'べき乗', desc: 'n を k 回かける。k が 1 より小さいとルート（減る）', ex: 'n=16 → n² は 256 ／ √n は 4' },
  log: { name: '対数', desc: '底を何回かけたら n になるか', ex: 'log₂n は n=64 → 6（2を6回かけると64）' },
  deriv: { name: '微分', desc: 'nᵏ を微分すると k·n^(k−1)。次数が1つ下がる', ex: '(n²)′ は 2n。n=50 → 100' },
  deriv2: { name: '二階微分', desc: 'nᵏ を2回微分すると k(k−1)·n^(k−2)。次数が2つ下がる', ex: '(n³)″ は 6n。n=50 → 300' },
  dlogn: { name: 'n·ln n の微分', desc: '積の微分で ln n + 1。すごく小さくなる', ex: 'n=200 → 6' },
  dlogn2: { name: 'n²·ln n の微分', desc: 'n(2·ln n + 1)。ゆるやかに増える', ex: 'n=200 → 2319' },
  sumsq: { name: '平方数の和', desc: '1² から n² までを全部たす', ex: 'n=20 → 2870' },
  limE: { name: 'e の定義', desc: '★どれだけ人がいても必ず 2 人。この式は e（≒2.718）に近づく', ex: 'n=9999 → 2' },
  integ: { name: '積分', desc: '0 から n まで xᵏ を積むと n^(k+1)/(k+1)。次数が1つ上がる', ex: '∫₀ⁿx dx は n²/2。n=20 → 200' },
  ln: { name: '自然対数（積分の形）', desc: '1 から n まで 1/x を積むと ln n。すごく小さくなる', ex: 'n=1000 → 6' },
  intln: { name: 'log の積分', desc: '1 から n まで ln x を積むと n·ln n − n + 1', ex: 'n=100 → 361' },
  intdbl: { name: '二重積分', desc: '見た目は大げさだが、中身はただの n²', ex: 'n=30 → 900' },
  intexp: { name: '指数関数の積分', desc: '0 から n まで eˣ を積むと eⁿ − 1。一気に爆発する', ex: 'n=8 → 2980' },
  intgamma: { name: 'ガンマ関数（積分の形）', desc: 'Γ(n) と同じもの。(n−1)! になる', ex: 'n=7 → 720' },
  intatan: { name: 'arctan の積分', desc: '★どれだけ人がいても必ず 1 人。arctan は π/2 を超えられない', ex: 'n=9999 → 1' },
  pow2: { name: '2 の n 乗', desc: '2 を n 回かける。n が小さいときだけ神', ex: 'n=10 → 1024' },
  fact: { name: '階乗', desc: '1 から n までを全部かける', ex: 'n=6 → 720' },
  gamma: { name: 'ガンマ関数', desc: '階乗を実数まで広げたもの。Γ(n) = (n−1)!', ex: 'n=7 → 720' },
  comb2: { name: '組合せ', desc: 'n 人から 2 人を選ぶ選び方の数', ex: 'n=10 → 45' },
  tri: { name: '三角数', desc: '1 から n までを全部たす', ex: 'n=10 → 55' },
  gcd: { name: '最大公約数', desc: 'n と k の両方を割り切れる最大の数。すごく小さくなる', ex: 'n=100, k=7 → 1' },
  lcm: { name: '最小公倍数', desc: 'n と k の両方で割り切れる最小の数。★必ず増える', ex: 'n=100, k=7 → 700' },
  phi: { name: 'オイラー関数', desc: 'n 以下で n と共通の約数を持たない数の個数。★n が素数なら n−1', ex: 'n=12 → 4 ／ n=13 → 12' },
  sigma: { name: '約数の和', desc: 'n の約数を全部たす。★必ず増える', ex: 'n=12 → 28（1+2+3+4+6+12）' },
  divisors: { name: '約数の個数', desc: 'n を割り切れる数がいくつあるか。すごく小さくなる', ex: 'n=1000 → 16' },
  primepi: { name: '素数の個数', desc: 'n 以下に素数がいくつあるか', ex: 'n=100 → 25' },
  nthprime: { name: 'n 番目の素数', desc: '小さいほうから数えて n 番目の素数。★必ず増える', ex: 'n=10 → 29' },
  nextprime: { name: '次の素数', desc: 'n 以上でいちばん小さい素数。ほとんど変わらない', ex: 'n=100 → 101' },
  fib: { name: 'フィボナッチ数', desc: '前の 2 つをたして作る数列の n 番目', ex: 'n=12 → 144' },
  mod2: { name: '合同式（余り）', desc: 'n を k で割った余り。★何人いても k−1 人以下', ex: 'n=5000, k=7 → 4' },
  // ★取ってある情報科学の札（いまはどの区画にも入っていない）
  shl: { name: '左シフト', desc: '2 を k 回かけるのと同じ', ex: 'n≪1 は 2倍' },
  shr: { name: '右シフト', desc: '2 で k 回割るのと同じ', ex: 'n≫1 は半分' },
  xor: { name: '排他的論理和', desc: '2進数にして、桁ごとに違えば 1', ex: 'n=12, k=7 → 11' },
  and: { name: '論理積', desc: '2進数にして、桁ごとに両方 1 なら 1', ex: 'n=12, k=7 → 4' },
  or: { name: '論理和', desc: '2進数にして、桁ごとにどちらか 1 なら 1', ex: 'n=12, k=7 → 15' },
  popcount: { name: '立っているビットの数', desc: '2進数にしたときの 1 の個数', ex: 'n=1000 → 6' },
  rev: { name: '桁の逆読み', desc: '数字を逆から読む。★末尾が 0 だと激減', ex: 'n=1000 → 1' },
  digitsum: { name: '桁の和', desc: '各桁をたす', ex: 'n=1234 → 10' },
  digitprod: { name: '桁の積', desc: '各桁をかける。★0 が 1 桁でもあれば全滅', ex: 'n=1000 → 0' },
  bin10: { name: '2進数を10進で読む', desc: '2進表記をそのまま10進の数として読む', ex: 'n=12 → 1100' },
  pow2floor: { name: '2 のべきに切り下げ', desc: 'n を超えない最大の 2 のべき', ex: 'n=1000 → 512' },
};

/**
 * ★★★**その人数で出せる札を、族ごとにまとめて全部返す**（2026-09-21・作り直しの土台）。
 *
 * ★**なぜ要るか**（`MATHMODE.md` §8-1）: 前は**札を1つの袋に入れて1枚引いて**いた。
 * `pow` は指数の候補が **16個**あるのに `Tₙ` `ₙC₂` `φ(n)` は **1枚ずつ**なので、
 * ★**`pow` が 16:1 で勝つのは当たり前**だった（本人「だいたい n^n ばかり」）。
 * ★**族ごとにまとめて返せば、呼ぶ側が「族を等確率で引く」ことができる。**
 *
 * @param ops 使ってよい札（区画が決める）
 * @param vs  つまみのある族で試す値
 */
export function usableByFamily(
  n: number,
  ops: readonly MathOp[],
  vs: (op: MathOp) => readonly number[],
): Map<MathOp, { c: GateChoice; r: number }[]> {
  const out = new Map<MathOp, { c: GateChoice; r: number }[]>();
  /*
   * ★計算しきれない人数（`mathDefined` が false）の札も出す（2026-09-26）。
   * `applyMath` がそこでは平均的な値の近似で答えるので固まらない。外すと、人数が大きいほど札の種類が痩せる
   */
  for (const op of new Set(ops)) {
    const list: { c: GateChoice; r: number }[] = [];
    for (const v of vs(op)) {
      const c: GateChoice = { op, v };
      const r = applyOp(n, c);
      /*
       * ★0人になる札は、そもそも選択肢にならない。
       * ★**上限（`MATH_MAX`）に届く札は外さない**（2026-09-26）—— 前は 99,999 に届く札を外していて、
       * 人数が増えるほど出せる札が3族まで痩せた
       */
      if (r < 1) continue;
      list.push({ c, r });
    }
    if (list.length > 0) out.set(op, list);
  }
  return out;
}

/** つまみの候補（`GRID`）を外から引けるようにする。素の札は `v` を使わないので 0 だけ */
export function gridFor(op: MathOp): readonly number[] {
  if (GRID[op]) return GRID[op] as readonly number[];
  if (op === 'gcd' || op === 'lcm' || op === 'mod2') return [3, 5, 7, 11, 13];
  return [0];
}


/* ══════════════════════════════════════════════════════════════════════
 * ★★★**上限のない人数**（2026-09-26・本人「10³⁰⁰ に達しても、どこまでも増やせる仕組みに」）。
 *
 * ★**人数を「数」と「桁のはみ出し」の2つで持つ**: 本当の人数 ＝ `n × 10^over`。
 *  - `over = 0` … ふつうの数（10³⁰⁰ まで）。**いままでと1ミリも変わらない**
 *  - `over > 0` … `n` は 10³⁰⁰ に張り付き、はみ出した桁を `over` が持つ（10⁴⁵⁶ なら over = 156）
 * JS の数は 1.8×10³⁰⁸ で壊れるので、それより上は**桁（log₁₀）で計算する**。
 * ★**群れの絵・当たり判定・ボス・壇は `n`（10³⁰⁰ まで）だけを見る**ので、ゲームの仕組みは何も変わらない。
 * 桁の上限は `LOG_MAX`（10^(10³⁰⁰)）で、実質どこまでも増える
 * ════════════════════════════════════════════════════════════════════ */

export interface Big {
  /** 10³⁰⁰ までの人数。`over > 0` のときは `MATH_MAX` */
  n: number;
  /** はみ出した桁（log₁₀）。0 ならふつうの数 */
  over: number;
}

/** 桁の上限。10^(10³⁰⁰) 人 */
const LOG_MAX = 1e300;
const MAX_LOG10 = 300; // log₁₀(MATH_MAX)
const LOG10E = Math.LOG10E;

/** 人数の桁（log₁₀）。0人は −∞ */
export function bigLog(n: number, over = 0): number {
  return n <= 0 ? -Infinity : Math.log10(n) + over;
}

/** 桁から人数に戻す。10³⁰⁰ 以下はふつうの数、それより上は `over` にはみ出させる */
export function fromLog(L: number): Big {
  if (!(L > -Infinity)) return { n: 0, over: 0 };
  if (L > LOG_MAX) L = LOG_MAX;
  if (L <= MAX_LOG10) return { n: capped(10 ** L + 1e-9), over: 0 };
  return { n: MATH_MAX, over: L - MAX_LOG10 };
}

/** 大小。`over` が両方 0 ならふつうに比べる（小さい数で丸めの誤差を入れない） */
export function cmpBig(a: Big, b: Big): number {
  if (a.over === 0 && b.over === 0) return a.n - b.n;
  return bigLog(a.n, a.over) - bigLog(b.n, b.over);
}

/**
 * ★**上限のない演算**。10³⁰⁰ に届かない答えは `applyOp` と**完全に同じ値**を返す
 * （届いたときと、もともと 10³⁰⁰ を越えているときだけ桁で計算する）
 */
export function applyOpBig(n: number, over: number, c: GateChoice): Big {
  if (!isMath(c.op)) {
    if (over === 0) return { n: applyOp(n, c), over: 0 };
    // 四則演算の札は理系用に出ないが、念のため桁で扱う（＋−は誤差にもならない）
    const L = bigLog(n, over);
    if (c.op === 'mul') return fromLog(L + Math.log10(Math.max(1e-300, c.v)));
    if (c.op === 'div') return fromLog(L - Math.log10(Math.max(1e-300, c.v)));
    if (c.op === 'mod') return { n: c.v <= 1 ? 0 : n % c.v, over: 0 };
    return { n, over };
  }
  if (over === 0) {
    const r = applyOp(n, c);
    if (r < MATH_MAX) return { n: r, over: 0 };
  }
  return mathBig(bigLog(n, over), n, c.op, c.v);
}

/** 桁（L ＝ log₁₀ n）で計算する。**小さくなる答えはふつうの数で返す**（丸めで 1 ずれないように） */
function mathBig(L: number, n: number, op: MathOp, v: number): Big {
  const num = (x: number): Big => (x > MATH_MAX ? fromLog(Math.log10(x)) : { n: capped(x), over: 0 });
  // 10^L が数として表せない（L > 308）ときは Infinity になり、そのまま上限（LOG_MAX）に張り付く
  const huge = (x: number): number => (Number.isFinite(x) ? x : LOG_MAX);
  const lnN = L / LOG10E; // ln n
  switch (op) {
    case 'pow': return v <= 0 ? { n: 1, over: 0 } : fromLog(L * v);
    case 'log': return num(L / Math.log10(v < 2 ? 2 : v));
    case 'deriv': return v <= 0 ? { n: 0, over: 0 } : fromLog(Math.log10(v) + (v - 1) * L);
    case 'deriv2': return v <= 1 ? { n: 0, over: 0 } : fromLog(Math.log10(v * (v - 1)) + (v - 2) * L);
    case 'integ': return v < 0 ? { n: 0, over: 0 } : fromLog((v + 1) * L - Math.log10(v + 1));
    case 'dlogn': return num(lnN + 1);
    case 'dlogn2': return fromLog(L + Math.log10(2 * lnN + 1));
    case 'sumsq': return fromLog(3 * L - Math.log10(3));
    case 'limE': return { n: 2, over: 0 };
    case 'ln': return num(lnN);
    case 'intln': return fromLog(L + Math.log10(Math.max(1, lnN - 1)));
    case 'intdbl': return fromLog(2 * L);
    case 'comb2': case 'tri': return fromLog(2 * L - Math.log10(2));
    case 'intatan': return { n: 1, over: 0 };
    // ★ここから下は「n 自体が指数に入る」札。桁の桁で爆発するので、ほぼ必ず上限（10^(10³⁰⁰)）
    case 'intexp': return fromLog(huge(10 ** L * LOG10E));
    case 'pow2': return fromLog(huge(10 ** L * Math.log10(2)));
    case 'fib': return fromLog(huge(10 ** L * Math.log10((1 + Math.sqrt(5)) / 2)));
    // log₁₀ n! ≒ n(log₁₀ n − log₁₀ e)（スターリングの近似）
    case 'fact': case 'gamma': case 'intgamma': return fromLog(huge(10 ** L * (L - LOG10E)));
    // ★整数論の札は平均的な値（`applyMath` の近似と同じ考え方）
    case 'phi': return fromLog(L + Math.log10(6 / Math.PI ** 2));
    case 'sigma': return fromLog(L + Math.log10(Math.PI ** 2 / 6));
    case 'divisors': return num(lnN);
    case 'primepi': return fromLog(L - Math.log10(lnN));
    case 'nthprime': return fromLog(L + Math.log10(lnN + Math.log(lnN)));
    case 'nextprime': return fromLog(L);
    case 'gcd': return v <= 0 ? { n: 0, over: 0 } : { n: capped(gcd(Math.floor(n % v) || v, v)), over: 0 };
    case 'lcm': return v <= 0 ? { n: 0, over: 0 } : fromLog(L + Math.log10(v));
    case 'mod2': return v <= 1 ? { n: 0, over: 0 } : { n: capped(n % v), over: 0 };
    default: return fromLog(L); // 情報科学の札（いまは出さない）
  }
}

const SUP_DIGITS = '\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079';
const sup = (e: number): string => String(e).split('').map((d) => SUP_DIGITS[Number(d)] ?? d).join('');

/**
 * ★**上限のない人数の書き方**。`over = 0` は `fmtCount` と同じ。
 * それより上は `3.2×10⁴⁵⁶`、桁そのものが 100万を越えたら `10^(1.2×10⁷)`
 */
export function fmtBig(n: number, over = 0): string {
  if (over <= 0) return fmtCount(n);
  return fmtLog(bigLog(n, over));
}

/** 桁（log₁₀）から書く */
export function fmtLog(L: number): string {
  if (!(L > -Infinity)) return '0';
  if (L < 6) return fmtCount(10 ** L);
  if (L < 1e6) {
    let e = Math.floor(L);
    let m = 10 ** (L - e);
    if (m >= 9.95) { m /= 10; e++; }
    return `${m.toFixed(1)}\u00d710${sup(e)}`;
  }
  return `10^(${fmtCount(L)})`;
}

/** ★**差の書き方**（数字ポップ用）。桁が 2つ以上ちがえば、差は大きいほうとほぼ同じ */
export function fmtDiff(a: Big, b: Big): string {
  const La = bigLog(a.n, a.over), Lb = bigLog(b.n, b.over);
  if (a.over === 0 && b.over === 0) return fmtCount(Math.abs(a.n - b.n));
  const hi = Math.max(La, Lb), lo = Math.min(La, Lb);
  if (hi - lo > 2 || !(lo > -Infinity)) return fmtLog(hi);
  return fmtLog(hi + Math.log10(1 - 10 ** (lo - hi)));
}
