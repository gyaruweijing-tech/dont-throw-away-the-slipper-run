/**
 * ★★**理系用モードで実際に出た札を数える**（2026-09-21 新設・`npm run sim:deal`）。
 *
 * ★**なぜ要ったか。** 本人の実機「**ほとんど2種類だったな**」。
 * `sim:math` は**演算が正しく計算できるか**しか見ておらず、
 * ★**「実際に何が何%出たか」を誰も測っていなかった**。
 * 32種を用意しても**出てこなければ無いのと同じ**なので、出目のほうを数える。
 *
 * 見るのは**偏り**。1種が 40% を超えていたら、その区画は実質その札のゲームになっている。
 */
import { resolveLevel } from '../src/config';
import { GateDirector } from '../src/world/GateDirector';
import { gateLabel, applyOp, MATH_MAX } from '../src/entities/gateOps';

/*
 * ★**種を入れた**（2026-09-25・検品 9/22 の `- [!]`）。前は `Math.random` のままで、
 * **同じコードでも回すたびに % が動き、前後の比較ができなかった**。
 * `tools/pacing.ts` と同じ mulberry32。走行ごとに `setSeed` するので、版どうしを同じ種で比べられる
 */
let seed = 1;
Math.random = (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const setSeed = (lv: number, run: number): void => {
  seed = (lv * 1000 + run) | 0;
  for (let i = 0; i < 16; i++) Math.random(); // 隣り合う種の相関を切る（`pacing.ts` と同じ）
};

for (const band of [[1, 5], [6, 10], [11, 15], [16, 20]]) {
  const count = new Map<string, number>();
  let cards = 0;
  for (let lv = band[0]; lv <= band[1]; lv++) {
    const sp = resolveLevel(lv - 1, 'math');
    for (let run = 0; run < 60; run++) {
      setSeed(lv, run);
      const d = new GateDirector(sp.start, sp.gateTier, sp.gateGap, lv);
      let n = sp.start;
      // 1走行ぶん（道 330m ／ 平均間隔 37m ＝ 9枚前後）
      for (let i = 0; i < 9; i++) {
        const row = d.next();
        const best = row.choices.reduce((a, b) => (applyOp(n, a) > applyOp(n, b) ? a : b));
        for (const c of row.choices) {
          const lab = gateLabel(c);
          count.set(lab, (count.get(lab) ?? 0) + 1);
          cards++;
        }
        n = Math.min(MATH_MAX, applyOp(n, best));
        d.sync(n);
      }
    }
  }
  const all = [...count.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n=== Lv${band[0]}〜${band[1]}  出た札 ${all.length} 種（${cards} 枚）===`);
  for (const [lab, c] of all) console.log(`   ${lab.padEnd(12)} ${String(c).padStart(5)} 枚  ${(c / cards * 100).toFixed(1)}%`);
}

/*
 * ★★**2枚の「組み合わせ」を数える**（2026-09-21・本人の指摘で足した）。
 * > 「n^1.2, n^1.15 というように、nの乗数だけを比べるのだと、その数字の大小を比べるだけ。
 * >  でも、n^2, nC2 といように違う計算式出されたら『あれどっちだ？』っていう判断が生まれる」
 * ★**出た札の種類ではなく、対の種類が本当の難しさ**なので、そちらを数える
 */
console.log('\n\n########## 2枚の組み合わせ ##########');
for (const band of [[1, 5], [6, 10], [11, 15], [16, 20]]) {
  let same = 0, diff = 0, rows = 0, close = 0;
  const pairs = new Map<string, number>();
  for (let lv = band[0]; lv <= band[1]; lv++) {
    const sp = resolveLevel(lv - 1, 'math');
    for (let run = 0; run < 60; run++) {
      setSeed(lv, run);
      const d = new GateDirector(sp.start, sp.gateTier, sp.gateGap, lv);
      let n = sp.start;
      for (let i = 0; i < 9; i++) {
        const row = d.next();
        const [c0, c1] = row.choices;
        if (c1) {
          rows++;
          if (c0.op === c1.op) same++; else diff++;
          /*
           * ★★**「迷う対」の割合**（2026-09-21・本人の最優先を数字にしたもの）。
           * > 「パッと二式がでてきて、ど、どうすれば！？と計算をあせられるのがいい」
           * ★**2枚の結果が 0.5〜2倍に収まっていれば、どちらが大きいか一瞬では分からない。**
           * 逆に 10倍も違えば、式を読まなくても勝負がついてしまう
           */
          const ra = applyOp(n, c0), rb = applyOp(n, c1);
          const k = Math.min(ra, rb) / Math.max(1, Math.max(ra, rb));
          if (k >= 0.5) close++;
          const key = [c0.op, c1.op].sort().join(' vs ');
          pairs.set(key, (pairs.get(key) ?? 0) + 1);
        }
        const best = row.choices.reduce((a, b) => (applyOp(n, a) > applyOp(n, b) ? a : b));
        n = Math.min(MATH_MAX, applyOp(n, best));
        d.sync(n);
      }
    }
  }
  console.log(`\nLv${band[0]}〜${band[1]}  ★同じ族どうし ${(same / rows * 100).toFixed(1)}%`
    + ` ／ 違う族 ${(diff / rows * 100).toFixed(1)}%`
    + ` ／ ★★迷う対（比 0.5〜2倍）${(close / rows * 100).toFixed(1)}%`);
  for (const [k, c] of [...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`   ${k.padEnd(24)} ${(c / rows * 100).toFixed(1)}%`);
  }
}

/*
 * ★★**最初の3枚で群れが壊れないか**（2026-09-25・検品 9/22 の ★★★ を回帰検査にしたもの）。
 * 9/21 夜に2枚目の相方が `n¹` から `2ⁿ` に置き換わり、**2枚目で上限に張り付き → 3枚目で全滅**になった。
 * ★**片側だけ見ない**: 「上限に張り付かない」と並べて「3枚目で5人以下にならない」も見る。
 * 操作は2通り（いちばん増える方／半々で選ぶ＝札を読まない人）
 */
console.log('\n\n########## 最初の3枚 ##########');
let ng = 0;
const MAX = MATH_MAX;
for (const lv of [1, 5, 10, 15, 20]) {
  const sp = resolveLevel(lv - 1, 'math');
  for (const policy of ['best', 'coin'] as const) {
    let capped = 0, wiped = 0;
    const after3: number[] = [];
    const RUNS = 300;
    for (let run = 0; run < RUNS; run++) {
      setSeed(lv, run);
      const d = new GateDirector(sp.start, sp.gateTier, sp.gateGap, lv);
      let n = sp.start;
      for (let i = 0; i < 3; i++) {
        const row = d.next();
        const pick = policy === 'best'
          ? row.choices.reduce((a, b) => (applyOp(n, a) > applyOp(n, b) ? a : b))
          : row.choices[Math.floor(Math.random() * row.choices.length)];
        n = Math.min(MAX, applyOp(n, pick));
        d.sync(n);
        if (i === 1 && n >= MAX) capped++;
      }
      after3.push(n);
      if (n <= 5) wiped++;
    }
    after3.sort((a, b) => a - b);
    const med = after3[RUNS >> 1];
    const bad = capped > 0;
    if (bad) ng++;
    console.log(`  ${bad ? '★NG' : '合格'}  Lv${String(lv).padEnd(2)} ${policy === 'best' ? '増える方' : '半々    '}`
      + `  2枚目で上限 ${(capped / RUNS * 100).toFixed(0).padStart(3)}%`
      + `  3枚目のあと中央値 ${String(med).padStart(6)}人`
      + `  5人以下 ${(wiped / RUNS * 100).toFixed(0).padStart(3)}%`);
  }
}
console.log(ng === 0 ? '  合格  2枚目で上限に張り付く走行 0%' : `  ★NG ${ng} 行`);
