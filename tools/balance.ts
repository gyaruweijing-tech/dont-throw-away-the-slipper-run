import { GateDirector } from '../src/world/GateDirector';
import { applyOp } from '../src/entities/gateOps';

import { seedRandom } from './seed';
/*
 * ★**種を置く**（2026-09-15・検品 `59490ca` の指摘）。
 * これが無いと**同じコミットで2回回しただけで数字が変わり**、版どうしを比べられない。
 * ★**測り方を変えたわけではない**（走行数も式もそのまま）。毎回同じ道を引くようにしただけ
 */
seedRandom();


const best = (n: number, cs: any[]) => { let b = 0; for (let i = 1; i < cs.length; i++) if (applyOp(n, cs[i]) > applyOp(n, cs[b])) b = i; return b; };

let mulSeen = 0, mulBest = 0, rows = 0;
const kindCount: Record<string, number> = {};
for (let s = 0; s < 600; s++) {
  const d = new GateDirector(8, 3);   // tier3 ＝ 全部の型を出す（Lv5 相当）
  let n = 8;
  for (let i = 0; i < 14; i++) {
    const cs = d.next().choices;
    rows++;
    const key = cs.map((c) => c.op).sort().join('/');
    kindCount[key] = (kindCount[key] ?? 0) + 1;
    const bi = best(n, cs);
    const mi = cs.findIndex((c) => c.op === 'mul');
    if (mi >= 0) { mulSeen++; if (bi === mi) mulBest++; }
    n = applyOp(n, cs[bi]);
    d.sync(n);
  }
}
console.log(`× を含むゲート: ${(mulSeen / rows * 100).toFixed(1)}% / そのうち × が正解: ${(mulBest / mulSeen * 100).toFixed(1)}%`);
console.log('組み合わせの内訳:');
for (const [k, v] of Object.entries(kindCount).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(16)} ${(v / rows * 100).toFixed(1)}%`);
}
