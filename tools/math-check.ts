/**
 * ★**数学ボケモードの演算を1つずつ確かめる**（2026-09-20 新設・`npm run sim:math`）。
 *
 * ★**なぜ要るか。** 32種は**目で読んでも合っているか分からない**（`φ(1000)=400` を暗算できない）。
 * `MATHMODE.md` の表に書いた n=12 / n=1000 の値を、**実装に答え合わせさせる**。
 * ★**片側だけ調べない**（`collision-basics.md` の作法）—— 値が合っているかだけでなく、
 * **上限を超えないこと・負にならないこと・小数にならないこと**も必ず対で見る。
 */
import {
  aimMath, applyOp, gateLabel, isGain, MATH_CS, MATH_HELP, MATH_OPS, MATH_PLAIN,
  MATH_TUNABLE, MATH_USES_V, MATH_MAX, applyOpBig, bigLog, cmpBig, fmtBig, type MathOp,
} from '../src/entities/gateOps';
import { mathHelpSections } from '../src/config';

let bad = 0;
const ok = (cond: boolean, msg: string): void => {
  if (!cond) { bad++; console.log(`  ★NG  ${msg}`); }
};

/** `MATHMODE.md` §1-2 の表。**ここが仕様で、実装のほうを直す** */
/*
 * ★**2026-09-26: 上限 99,999 を撤廃**（理系用の上限は `MATH_MAX` ＝ 10³⁰⁰）。
 * 前は「上限に張り付く」と書いていた欄を、**本当の値**に直した（`2¹⁰⁰⁰` `1000!` `Γ(1000)` は 10³⁰⁰ を越えるので上限）
 */
const TABLE: Partial<Record<MathOp, [number, number]>> = {
  pow2: [4096, MATH_MAX], fact: [479_001_600, MATH_MAX], comb2: [66, 499_500], tri: [78, 500_500],
  phi: [4, 400], sigma: [28, 2340], divisors: [6, 16],
  primepi: [5, 168], nthprime: [37, 7919], nextprime: [13, 1009], fib: [144, 4.346655768693743e208],
  rev: [21, 1], digitsum: [3, 1], digitprod: [2, 0], popcount: [2, 6],
  pow2floor: [8, 512], bin10: [1100, 1_111_101_000],
  // ★2026-09-21 に足した数学の札
  ln: [2, 6],
  // ★Γ(12)=11!=39,916,800。Γ(1000) は 10³⁰⁰ を越えるので上限
  gamma: [39_916_800, MATH_MAX],
};

console.log('=== 1. MATHMODE.md の表と合っているか（n=12 / n=1000）===');
for (const op of MATH_OPS) {
  const want = TABLE[op];
  const v = MATH_USES_V.has(op) ? 7 : 0;
  const a = applyOp(12, { op, v });
  const b = applyOp(1000, { op, v });
  if (!want) { console.log(`  （表なし）${op.padEnd(10)} n=12 → ${a} ／ n=1000 → ${b}`); continue; }
  // ★10¹⁵ を越える値は浮動小数なので、比で照合する
  const same = (x: number, y: number): boolean => x === y || Math.abs(x - y) <= Math.abs(y) * 1e-9;
  ok(same(a, want[0]), `${op} n=12 は ${want[0]} のはずが ${a}`);
  ok(same(b, want[1]), `${op} n=1000 は ${want[1]} のはずが ${b}`);
}
console.log(`  ${bad === 0 ? '合格' : '★NG あり'}  表にある ${Object.keys(TABLE).length} 種を照合`);

console.log('');
console.log('=== 2. どの人数でも壊れないか（0〜3000 と上限まわり）===');
const NS = [0, 1, 2, 3, 7, 12, 99, 100, 512, 1000, 2999, 99_999, 1e6, 1e15, 1e100, MATH_MAX];
const VS = [0, 0.33, 0.5, 1, 1.2, 2, 3, 7, 10];
for (const op of MATH_OPS) {
  for (const v of MATH_USES_V.has(op) ? VS : [0]) {
  for (const n of NS) {
    /*
     * ★**計算しきれない人数（`mathDefined` が false）でも必ず答えが返ること**（2026-09-26）。
     * 札は見込み人数で選ぶので、**実人数 10³⁰⁰ に `σ(n)` が当たることはある** —— そこで固まっていた
     */
    const t0 = Date.now();
    const r = applyOp(n, { op, v });
    ok(Date.now() - t0 < 200, `${op}(${n}) が遅い: ${Date.now() - t0}ms（固まる）`);
    ok(Number.isInteger(r), `${op}(${n}) が整数でない: ${r}`);
    ok(r >= 0, `${op}(${n}) が負: ${r}`);
    ok(r <= MATH_MAX, `${op}(${n}) が上限超え: ${r}`);
    ok(Number.isFinite(r), `${op}(${n}) が有限でない: ${r}`);
  }
  }
}
console.log(`  ${bad === 0 ? '合格' : '★NG あり'}  ${MATH_OPS.length} 種 × ${NS.length} 通りの人数`);

console.log('');
console.log('=== 3. ★つまみの逆算が当たっているか（MATHMODE.md §3-4）===');
/*
 * ★**`aimMath` は「n を want にする k」を返す。** 丸めと切り捨てでずれるので、
 * **どれくらいずれるか**を数字で見る。★**ずれないことではなく、狙いの側に動くことが要件**
 */
for (const n of [8, 30, 100, 800, 5000]) {
  for (const ratio of [0.35, 0.6, 1.5, 2.5]) {
    const want = Math.round(n * ratio);
    const hits: string[] = [];
    for (const op of MATH_TUNABLE) {
      const v = aimMath(op, n, want);
      if (v === null) continue;
      const got = applyOp(n, { op, v });
      hits.push(`${gateLabel({ op, v })}→${got}`);
      // ★狙いが増やす側なら増え、減らす側なら減っていること（ぴったりでなくてよい）
      if (want > n) ok(got > n, `${op} n=${n} want=${want} なのに減った: ${got}`);
      if (want < n) ok(got < n, `${op} n=${n} want=${want} なのに増えた: ${got}`);
    }
    console.log(`  n=${String(n).padStart(5)} want=${String(want).padStart(6)}  ${hits.join('  ')}`);
  }
}

console.log('');
console.log('=== 3b. ★「良い対」が成立しているか ===');
ok(applyOp(16, { op: 'pow', v: 0.5 }) === applyOp(16, { op: 'log', v: 2 }), '√n と log₂n は n=16 で同じはず');
ok(applyOp(4, { op: 'pow', v: 2 }) === applyOp(4, { op: 'pow2', v: 0 }), 'n² と 2ⁿ は n=4 で同じはず');
ok(applyOp(12, { op: 'sigma', v: 0 }) > applyOp(12, { op: 'shl', v: 1 }), '12 は過剰数なので σ(12) > 24 のはず');
ok(applyOp(8, { op: 'sigma', v: 0 }) < applyOp(8, { op: 'shl', v: 1 }), '8 は不足数なので σ(8) < 16 のはず');
ok(applyOp(6, { op: 'sigma', v: 0 }) === applyOp(6, { op: 'shl', v: 1 }), '6 は完全数なので σ(6) = 12 ちょうどのはず');
ok(applyOp(500, { op: 'pow', v: 0 }) === 1, 'n⁰ は必ず1人のはず');
ok(applyOp(500, { op: 'pow', v: 1 }) === 500, 'n¹ は変わらないはず');
// ★★**本人指定の置き換え**: (n²)′ ＝ 2n。情報科学の n≪1 と効き目が同じことを検査に入れる
ok(applyOp(500, { op: 'deriv', v: 2 }) === applyOp(500, { op: 'shl', v: 1 }),
  '(n²)′ は n≪1 と同じ（どちらも2倍）のはず');
ok(applyOp(100, { op: 'integ', v: 1 }) === 5000, '∫₀ⁿx dx は n²/2 のはず');
ok(applyOp(100, { op: 'integ', v: 0 }) === 100, '∫₀ⁿ1 dx は n そのもののはず');
ok(applyOp(7, { op: 'gamma', v: 0 }) === 720, 'Γ(7) は 6! ＝ 720 のはず');
ok(applyOp(1000, { op: 'ln', v: 0 }) === 6, 'ln(1000) ≒ 6.9 なので切り捨て 6 のはず');
console.log(`  ${bad === 0 ? '合格' : '★NG あり'}`);

console.log('');
console.log('=== 4. 札の見た目（遠くから読めるかは実機で見る）===');
console.log('  素の札: ' + MATH_PLAIN
  .map((op) => gateLabel({ op, v: MATH_USES_V.has(op) ? 7 : 0 })).join('  '));
console.log('  べき族: ' + [0, 0.33, 0.5, 0.8, 1, 1.2, 1.7, 2, 3].map((k) => gateLabel({ op: 'pow', v: k })).join('  '));
console.log('  対数族: ' + [2, 3, 5, 10].map((b) => gateLabel({ op: 'log', v: b })).join('  '));
console.log('  微分族: ' + [1, 1.5, 2, 2.5, 3].map((k) => gateLabel({ op: 'deriv', v: k })).join('  '));
console.log('  積分族: ' + [0, 0.5, 1, 2].map((k) => gateLabel({ op: 'integ', v: k })).join('  '));
console.log('  （取ってある情報科学の札: ' + MATH_CS
  .map((op) => gateLabel({ op, v: MATH_USES_V.has(op) ? 7 : 0 })).join('  ') + '）');

console.log('');

console.log('');
console.log('=== 5. ★札の色が嘘をついていないか（本人の実機「赤色なのに、通ったら数が増えた」）===');
/*
 * ★★**色は `isGain(c, count)` が決める。** 前は手書きの一覧で決めていて、
 * **`Γ(n)` `Fₙ` `lcm` `ₙC₂` の4枚が嘘**をついていた。
 * ★**人数を渡していれば、どの札でも・これから足す札でも嘘にならない**ことを確かめる
 */
const CNS = [2, 3, 4, 5, 6, 8, 12, 30, 100, 500, 3000, 50000];
let lies = 0;
for (const op of MATH_OPS) {
  for (const v of MATH_USES_V.has(op) ? [0, 0.5, 1, 2, 3, 7] : [0]) {
    for (const n of CNS) {
      const c = { op, v };
      const r = applyOp(n, c);
      if (r === n) continue;            // 増えも減りもしない札は色を問わない
      if (isGain(c, n) !== r > n) {
        lies++;
        if (lies <= 5) console.log(`  ★NG  ${gateLabel(c)} n=${n} → ${r} なのに色が ${isGain(c, n) ? '藍(増)' : '朱(減)'}`);
      }
    }
  }
}
ok(lies === 0, `色が嘘をついている組み合わせが ${lies} 件`);
console.log(`  ${lies === 0 ? '合格' : '★NG'}  ${MATH_OPS.length} 種 × 人数 ${CNS.length} 通りで、色と実際が一致`);

console.log('');
console.log('=== 6. ★区画で使う札すべてに説明があるか（説明書の書き忘れ検査）===');
/*
 * ★**説明を書き忘れたらここで落ちる。** 札を足すのは簡単だが説明は忘れやすく、
 * **説明書だけ古くなる**のがこのリポジトリが何度も踏んでいる型
 */
const used = new Set<MathOp>();
for (const sec of mathHelpSections()) for (const op of sec.ops) used.add(op);
for (const op of used) {
  const h = MATH_HELP[op];
  ok(!!h, `${op} に説明がない`);
  if (!h) continue;
  ok(h.name.length > 0 && h.desc.length > 0 && h.ex.length > 0, `${op} の説明が空`);
  // ★例には必ず数字を入れる（意味より例のほうが速く伝わるので、例が無いと役に立たない）
  ok(/[0-9]/.test(h.ex), `${op} の例に数字が入っていない: ${h.ex}`);
}
console.log(`  ${bad === 0 ? '合格' : '★NG'}  区画で使う ${used.size} 種すべてに説明がある`);
console.log(`  （説明書は ${mathHelpSections().length} 区画に分かれている）`);

console.log('');
console.log('=== 7. ★★上限のない人数（2026-09-26・本人「どこまでも増やせる仕組み」）===');
/*
 * ★**片側だけ見ない**:
 *  a. 10³⁰⁰ に届かない答えは、いままでの `applyOp` と**1人も違わない**こと（ふつうの走行を壊さない）
 *  b. 10³⁰⁰ の手前と向こうで、桁の計算がつながっていること（境目で数字が飛ばない）
 *  c. 10³⁰⁰ を越えた人数でも、答えが必ず出る・NaN にならない・色が嘘をつかない・速いこと
 *  d. 増える札で本当に 10³⁰⁰ を越えて増え続け、減る札で戻ってこられること
 */
{
  const before = bad;
  const OPS = MATH_OPS.filter((op) => !MATH_CS.includes(op));
  // a
  for (const op of MATH_OPS) {
    for (const v of MATH_USES_V.has(op) ? VS : [0]) {
      for (const n of NS) {
        const c = { op, v };
        const r = applyOp(n, c);
        if (r >= MATH_MAX) continue;
        const b = applyOpBig(n, 0, c);
        ok(b.over === 0 && b.n === r, `${op}(${n}) が applyOp と違う: ${r} → ${b.n}×10^${b.over}`);
      }
    }
  }
  // b: 同じ 10²⁰⁰ を「ふつうの数」と「桁」の両方から計算して比べる（素直な式の札だけ。整数論は近似なので外す）
  const SMOOTH: MathOp[] = ['pow', 'deriv', 'deriv2', 'integ', 'dlogn2', 'sumsq', 'intln', 'intdbl', 'comb2', 'tri'];
  for (const op of SMOOTH) {
    for (const v of MATH_USES_V.has(op) ? [0.5, 1.2, 2, 3, 7] : [0]) {
      const c = { op, v };
      const exact = applyOpBig(1e200, 0, c);
      const viaLog = applyOpBig(1e100, 100, c);
      // 両方 0人（`(√n)′` は 10²⁰⁰ で 0.5/10¹⁰⁰ ＝ 0人）なら一致
      const La = bigLog(exact.n, exact.over), Lb = bigLog(viaLog.n, viaLog.over);
      const d = La === Lb ? 0 : Math.abs(La - Lb);
      ok(d < 1e-6, `${gateLabel(c)} が 10²⁰⁰ で桁の計算とずれる: ${d}`);
    }
  }
  // c
  for (const over of [1, 156, 1e5, 1e100, 1e300]) {
    for (const op of OPS) {
      for (const v of MATH_USES_V.has(op) ? VS : [0]) {
        const c = { op, v };
        const t0 = Date.now();
        const b = applyOpBig(MATH_MAX, over, c);
        ok(Date.now() - t0 < 50, `${op} 10^(300+${over}) が遅い`);
        ok(Number.isFinite(b.n) && b.n >= 0 && Number.isFinite(b.over) && b.over >= 0,
          `${op} 10^(300+${over}) が壊れた: ${b.n}×10^${b.over}`);
        ok(b.over === 0 || b.n === MATH_MAX, `${op} はみ出したのに n が 10³⁰⁰ でない: ${b.n}`);
        const up = cmpBig(b, { n: MATH_MAX, over }) > 0;
        ok(isGain(c, MATH_MAX, over) === up, `${gateLabel(c)} 10^(300+${over}) で色が嘘`);
      }
    }
  }
  // d
  let L = bigLog(1e250);
  let cur = { n: 1e250, over: 0 };
  const path: string[] = [];
  for (const c of [{ op: 'pow', v: 2 }, { op: 'pow', v: 3 }, { op: 'fact', v: 0 }, { op: 'pow', v: 0.5 }, { op: 'log', v: 10 }] as const) {
    const next = applyOpBig(cur.n, cur.over, c);
    path.push(`${gateLabel(c)}→${fmtBig(next.n, next.over)}`);
    cur = next;
  }
  L = bigLog(cur.n, cur.over);
  console.log(`  10²⁵⁰ から: ${path.join('  ')}`);
  ok(Number.isFinite(L) && cur.over === 0, `減る札で戻ってこられない: ${fmtBig(cur.n, cur.over)}`);
  ok(fmtBig(MATH_MAX, 156) === '1.0×10⁴⁵⁶', `書き方: ${fmtBig(MATH_MAX, 156)}`);
  console.log(`  ${bad === before ? '合格' : '★NG'}  10³⁰⁰ の手前は完全に同じ・境目でつながる・越えても壊れない`);
}

console.log('');
// ★**落とす**。exit 0 で NG を素通りさせると「壊れている検査」になる（LEARNED.md 2026-08-28）
if (bad > 0) throw new Error(`理系用モードの検査に NG が ${bad} 件`);
console.log('全部合格');
