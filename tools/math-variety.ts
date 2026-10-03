/**
 * ★★**理系用の「変化」を測る**（2026-09-26 新設・`npm run sim:variety`）。
 *
 * > 本人「第2ステージで、全く同じセットの数式が3回か4回出てきた」
 * > 「Lv13 あたりでも Lv1・2 と同じ数式ばかり。レベルが上がっても何も増えていない」
 *
 * 見るもの:
 *  1. **1走行で同じ組（2枚の札の顔）が2回以上出た走行の割合**。★**0% が合格**
 *  2. **1走行で出た札の種類の数**（平均）
 *  3. **説明書（`mathHelpSections`）に載っている札のうち、その区画で一度も出なかったもの**。★**空が合格**
 *  4. **その区画で新しく増えた札が、1走行に1枚以上出た割合**
 *
 * 操作は2通り（いちばん増える方／半々で選ぶ＝札を読まない人）
 */
import { resolveLevel, mathHelpSections, MATH_ZONES } from '../src/config';
import { GateDirector } from '../src/world/GateDirector';
import { gateLabel, applyOp, MATH_MAX, type GateChoice } from '../src/entities/gateOps';

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
  for (let i = 0; i < 16; i++) Math.random();
};

/*
 * ★**走行数**（2026-09-26・本人「最低でも100回、必要ならそれ以上」）。
 * 1レベル 500走行 × 選び方3通り × 20レベル ＝ 30,000走行。
 * 「1走行で同じ組が出る」が 0.2%（500回に1回）でも拾える数にしてある
 */
const RUNS = 500;
const GATES = 9;
const help = mathHelpSections();
let ng = 0;
type Policy = 'best' | 'coin' | 'worst';

console.log('Lv   選び方  同じ組が出た走行  1走行の族  前の走行と同じ組  1枚目が前と同じ  新しい札の枚数  出なかった札');
for (let lv = 1; lv <= 20; lv++) {
  const zi = MATH_ZONES.findIndex((z) => lv >= z.fromLv && lv <= z.toLv);
  const listed = new Set(help.slice(0, zi + 1).flatMap((h) => h.ops));
  const before = new Set(help.slice(0, zi).flatMap((h) => h.ops));
  const fresh = new Set([...listed].filter((op) => !before.has(op)));
  const sp = resolveLevel(lv - 1, 'math');
  for (const policy of ['best', 'coin', 'worst'] as Policy[]) {
    let repeatRuns = 0, fams = 0, overlap = 0, overlapN = 0, firstSame = 0, freshCards = 0, cards = 0;
    const seenOps = new Set<string>();
    let prevPairs: Set<string> | null = null;
    let prevFirst = '';
    // ★レベルごとに1つの director を使い回す（ゲームと同じく「もう一回」は reset）
    const d = new GateDirector(sp.start, sp.gateTier, sp.gateGap, lv);
    for (let run = 0; run < RUNS; run++) {
      setSeed(lv, run);
      d.reset(sp.start, sp.gateTier, sp.gateGap, lv);
      let n = sp.start;
      const pairs = new Set<string>();
      const fam = new Set<string>();
      let repeated = false, first = '';
      for (let i = 0; i < GATES; i++) {
        const row = d.next();
        const key = row.choices.map(gateLabel).sort().join(' | ');
        if (i === 0) first = key;
        if (pairs.has(key)) repeated = true;
        pairs.add(key);
        for (const c of row.choices) {
          fam.add(c.op); seenOps.add(c.op); cards++;
          if (fresh.has(c.op as never)) freshCards++;
        }
        const pick: GateChoice = policy === 'coin'
          ? row.choices[Math.floor(Math.random() * row.choices.length)]
          : row.choices.reduce((a, b) => ((applyOp(n, a) > applyOp(n, b)) === (policy === 'best') ? a : b));
        n = Math.min(MATH_MAX, applyOp(n, pick));
        d.sync(n);
      }
      if (repeated) repeatRuns++;
      fams += fam.size;
      if (prevPairs) {
        overlap += [...pairs].filter((k) => prevPairs!.has(k)).length / pairs.size; overlapN++;
        if (first === prevFirst) firstSame++;
      }
      prevPairs = pairs; prevFirst = first;
    }
    const missing = [...listed].filter((op) => !seenOps.has(op));
    const bad = repeatRuns > 0 || missing.length > 0;
    if (bad) ng++;
    console.log(`Lv${String(lv).padEnd(3)}${policy.padEnd(6)}`
      + `  ${(repeatRuns / RUNS * 100).toFixed(1).padStart(6)}%`
      + `  ${(fams / RUNS).toFixed(1).padStart(8)}族`
      + `  ${(overlap / overlapN * 100).toFixed(1).padStart(12)}%`
      + `  ${(firstSame / overlapN * 100).toFixed(1).padStart(12)}%`
      + `  ${(freshCards / cards * 100).toFixed(0).padStart(10)}%`
      + `  ${missing.length ? missing.join(',') : 'なし'}`
      + (bad ? '  ★NG' : ''));
  }
}
console.log(ng ? `\n★NG ${ng} 件` : '\n合格');
if (ng) process.exit(1);
