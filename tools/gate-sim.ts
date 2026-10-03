import { GateDirector } from '../src/world/GateDirector';
import { applyOp, gateBounds, gateLabel, pickIndex, unreachableFrames, type GateShape } from '../src/entities/gateOps';
import { CFG, lateralHalfWidth, resolveKnobs } from '../src/config';

import { seedRandom } from './seed';
/*
 * ★**種を置く**（2026-09-15・検品 `59490ca` の指摘）。
 * これが無いと**同じコミットで2回回しただけで数字が変わり**、版どうしを比べられない。
 * ★**測り方を変えたわけではない**（走行数も式もそのまま）。毎回同じ道を引くようにしただけ
 */
seedRandom();


// pickIndex の境界（2枚 / 3枚）
const W = CFG.courseWidth;
const cases: [number, number, number][] = [
  [-99, 2, 0], [-0.01, 2, 0], [0.01, 2, 1], [99, 2, 1],
  [-99, 3, 0], [-1.9, 3, 0], [-1.7, 3, 1], [0, 3, 1], [1.7, 3, 1], [1.9, 3, 2], [99, 3, 2],
];
let bad = 0;
for (const [x, n, want] of cases) {
  const got = pickIndex(x, n, W);
  if (got !== want) { console.log(`  NG pickIndex(${x},${n}) = ${got} want ${want}`); bad++; }
}
console.log(`pickIndex: ${cases.length - bad}/${cases.length} ok`);

// 到達可能性: 群れが太ったときの横移動下限 minLateralRange で全部の枠を選べるか
const reach = CFG.minLateralRange;
for (const n of [2, 3]) {
  const idx = new Set([pickIndex(-reach, n, W), pickIndex(0, n, W), pickIndex(reach, n, W)]);
  console.log(`reach ${n}枚: 選べる枠 ${idx.size}/${n} ${idx.size === n ? 'ok' : 'NG'}`);
}

/* =====================================================================
 * ★★**届かない枠が1つも無いか**（2026-08-28 新設・これが今いちばん大事な合否）
 *
 * 2026-08-28 に本人の実プレイで「Lv6 でどうあがいても −1034 しか選べない」が出た。
 * 原因は `gateBounds` がコース幅 11m で境界を出すのに、
 * プレイヤーの可動域は大群で ±2.2m しかなかったこと。
 * **この検査があれば、つまみをどう触っても同じ事故は本番に出ない。**
 *
 * ★**発火ゼロを合格と誤読しないよう、先に「その型が本当に出たか」を数える。**
 * 2026-08-27 に、まさに「sim では新ゲート3種が一度も発火していなかった」が起きている。
 * ================================================================== */
{
  const shapes: GateShape[] = ['plain', 'slide', 'timed', 'hidden'];
  // 群れが太った最悪の可動域から、群れが空の最大まで
  const halfs = [CFG.minLateralRange, 3.0, 3.8, lateralHalfWidth(0)];
  let checked = 0;
  let bad = 0;
  const worst: string[] = [];
  const fired = new Map<GateShape, number>(shapes.map((k) => [k, 0]));

  for (let lv = 1; lv <= CFG.levels.length; lv++) {
    const g = resolveKnobs(lv).gate;
    // その区画で実際に出うる型だけを見る（確率0の型を測っても意味がない）
    const live = shapes.filter((k) =>
      k === 'plain'
      || (k === 'slide' && g.slideChance > 0)
      || (k === 'timed' && g.timedChance > 0)
      || (k === 'hidden' && g.hiddenChance > 0));
    for (const shape of live) {
      fired.set(shape, (fired.get(shape) ?? 0) + 1);
      for (const n of [2, 3]) {
        for (const phase of [1, -1, 0.7, 2.4, 4.1]) {
          for (const half of halfs) {
            // ゲートが見え始めてから通過するまでを 0.5m 刻みで全部見る
            for (let z = -Math.max(g.timedTell, 40); z <= 0; z += 0.5) {
              const b = gateBounds(shape, phase, z, n, g, half, CFG.courseWidth);
              const miss = unreachableFrames(b, half, CFG.courseWidth);
              checked++;
              if (miss.length > 0) {
                bad++;
                if (worst.length < 5) {
                  worst.push(`Lv${lv} ${shape} ${n}枚 可動域±${half.toFixed(1)}m z=${z.toFixed(1)} → 枠${miss.join(',')}が届かない`);
                }
              }
            }
          }
        }
      }
    }
  }
  console.log('');
  for (const shape of shapes) {
    const lv = fired.get(shape) ?? 0;
    console.log(`  ${shape}: ${lv} レベルで出うる ${lv === 0 ? '← NG 一度も出ない（検査になっていない）' : ''}`);
  }
  console.log(`届かない枠: ${bad} / ${checked} 通り ${bad === 0 ? 'ok' : 'NG'}`);
  for (const w of worst) console.log('   ' + w);
}

// 通しシミュレーション
function run(label: string, choose: (n: number, cs: any[]) => number, gates: number) {
  const d = new GateDirector(8, 3);   // tier3 ＝ 全部の型を出す（Lv5 相当）
  let n = 8;
  let minN = n;
  const log: string[] = [];
  for (let i = 0; i < gates; i++) {
    const cs = d.next().choices;
    const pick = choose(n, cs);
    const before = n;
    n = applyOp(n, cs[pick]);
    d.sync(n);
    minN = Math.min(minN, n);
    if (i < 8) log.push(`${before}\u2192${n} [${cs.map(gateLabel).join(' | ')}] pick ${gateLabel(cs[pick])}`);
  }
  console.log(`\n${label}: ${gates}ゲート後 ${n}人 / 最小 ${minN}人`);
  for (const l of log) console.log('   ' + l);
}

const best = (n: number, cs: any[]) => { let b = 0; for (let i = 1; i < cs.length; i++) if (applyOp(n, cs[i]) > applyOp(n, cs[b])) b = i; return b; };
const worst = (n: number, cs: any[]) => { let b = 0; for (let i = 1; i < cs.length; i++) if (applyOp(n, cs[i]) < applyOp(n, cs[b])) b = i; return b; };
const rand = (_n: number, cs: any[]) => Math.floor(Math.random() * cs.length);

run('上手に選ぶ（§9 Lv1 は5ゲートで60人前後が目標）', best, 5);
run('上手に選ぶ・長め', best, 20);
run('毎回わざと最悪を選ぶ（詰まないか）', worst, 30);
run('ランダム', rand, 20);

// 「分岐点またぎ」が本当に分岐しているか＝手持ちで正解が入れ替わる型が出ているか
let cross = 0, total = 0;
for (let s = 0; s < 400; s++) {
  const d = new GateDirector(8, 3);   // tier3 ＝ 全部の型を出す（Lv5 相当）
  let n = 8;
  for (let i = 0; i < 12; i++) {
    const cs = d.next().choices;
    if (cs.length === 2) {
      total++;
      const a = applyOp(n, cs[0]), b = applyOp(n, cs[1]);
      // 手持ちが半分／倍だったら正解が入れ替わるか
      const half = Math.max(1, Math.floor(n / 2)), dbl = n * 2;
      const f1 = (applyOp(half, cs[0]) > applyOp(half, cs[1])) !== (a > b);
      const f2 = (applyOp(dbl, cs[0]) > applyOp(dbl, cs[1])) !== (a > b);
      if (f1 || f2) cross++;
    }
    n = applyOp(n, cs[best(n, cs)]);
    d.sync(n);
  }
}
console.log(`\n手持ちで正解が入れ替わるゲート: ${((cross / total) * 100).toFixed(1)}% (${cross}/${total})`);

// ===== mod の罠（§4-C ★）が実際に出て、実際に罠として働くか =====
console.log('\n=== mod k ゲート ===');
{
  let seen = 0, gates = 0, trapped = 0, lost = 0;
  // ★tier4 で回す。mod は tier4 でしか出ず、CFG.levels で tier4 を使うのは Lv17〜20（開始44人）。
  // 2026-08-24 まで tier3 で回していたので「NG: 一度も出ていない」が出続けていた（判定文ではなく検査条件が古かった）
  for (let s = 0; s < 400; s++) {
    const d = new GateDirector(44, 4);
    let n = 44;
    for (let i = 0; i < 16; i++) {
      const cs = d.next().choices;
      gates++;
      const mi = cs.findIndex((c) => c.op === 'mod');
      if (mi >= 0) {
        seen++;
        // 「大きい記号のほうを取る」で走ってきたプレイヤーは mod を選ばない側が正解か？
        const other = applyOp(n, cs[1 - mi]);
        const viaMod = applyOp(n, cs[mi]);
        if (viaMod < other) { trapped++; lost += other - viaMod; }
      }
      // 上手に選ぶ
      let b = 0;
      for (let k = 1; k < cs.length; k++) if (applyOp(n, cs[k]) > applyOp(n, cs[b])) b = k;
      n = applyOp(n, cs[b]);
      d.sync(n);
    }
  }
  console.log(`  出現率 ${((seen / gates) * 100).toFixed(1)}% (${seen}/${gates})`);
  console.log(`  うち mod を選ぶと損する割合 ${seen ? ((trapped / seen) * 100).toFixed(0) : 0}%` +
    ` / 踏んだときの平均損 ${trapped ? Math.round(lost / trapped) : 0}人`);
  /*
   * ★**「出ていない」は現在は正常。** 2026-08-24 に `PLANS[4]` から `modTrap` を外した
   * （踏むと 0.1% しか戻せず、走行が終わるため。§12-7）。
   * **常時赤い検査は、赤の意味を確かめるまで検査として機能しない** ——
   * この検査は tier3 で回していたせいで数日「NG」を出し続けていた前科がある
   */
  console.log(seen > 0
    ? '  OK: 罠が成立している'
    : '  －: いまは意図的に寝かせてある（PLANS[4] から modTrap を外した。§12-7）');
}
