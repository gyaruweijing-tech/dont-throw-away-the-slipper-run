/**
 * ★★**桁を奪うダメージの検査**（2026-09-26 新設・`npm run sim:digit`）。
 *
 * > 本人「10³⁰⁰ とかなのに、相手からのダメージが 25 とかだと微妙」
 * > 「他のステージでのダメージ量が変わっちゃいけないので、理系用だけ触る」
 *
 * ★**片側だけ見ない**:
 *  1. **ノーマル・ハードは `digitHit` を持たない**（＝ダメージは1人も変わらない）
 *  2. 理系用でも**人数が少ないうち（10⁶ 以下）は1人も変わらない**
 *  3. 10¹² 以上では、奪う桁がつまみどおり（一団 30%・ボス 50%・障害物 5/15/35%）
 *  4. 10³⁰⁰ を越えた人数（`over > 0`）でも効き、最低人数は割らない
 */
import './dom-shim';
import { MODES, CFG } from '../src/config';
import { Crowd } from '../src/entities/Crowd';
import { bigLog, fmtBig, MATH_MAX } from '../src/entities/gateOps';

let bad = 0;
const ok = (cond: boolean, msg: string): void => {
  if (!cond) { bad++; console.log(`  ★NG  ${msg}`); }
};

console.log('=== 1. 理系用以外は桁を奪わない ===');
for (const m of Object.values(MODES)) {
  if (m.id === 'math') ok(!!m.digitHit, '理系用に digitHit が無い');
  else ok(m.digitHit === undefined, `${m.name} に digitHit がある（ダメージが変わってしまう）`);
}
{
  const c = new Crowd();
  c.setCount(5000);
  c.shrinkDigits(0.5); // digitHit が null なら何もしない
  ok(c.count === 5000, `digitHit なしで人数が変わった: ${c.count}`);
}

const D = MODES.math.digitHit!;
const crowdAt = (L: number): Crowd => {
  const c = new Crowd();
  c.digitHit = D;
  c.cap = MATH_MAX; // ★ゲームと同じく理系用の蓋（`Game.enter`）
  if (L <= 300) c.setCount(10 ** L); else c.setBig({ n: MATH_MAX, over: L - 300 });
  return c;
};

console.log('=== 2. 理系用でも少人数（10⁶ 以下）は変わらない ===');
for (const n of [1, 8, 100, 5000, 999_999]) {
  const c = new Crowd();
  c.digitHit = D;
  c.cap = MATH_MAX;
  c.setCount(n);
  c.shrinkDigits(D.boss);
  ok(c.count === n, `${n}人で ${c.count} に減った`);
}

console.log('=== 3. 10¹² 以上はつまみどおり ===');
for (const [name, f] of [['一団', D.rival], ['ボス', D.boss], ['障害物・大', D.big], ['障害物・小', D.small]] as const) {
  for (const L of [12, 50, 300, 456, 1e5]) {
    const c = crowdAt(L);
    c.shrinkDigits(f);
    const got = bigLog(c.count, c.over);
    const want = L * (1 - f);
    ok(Math.abs(got - want) < 1e-6 * Math.max(1, L), `${name} 10^${L} → 10^${got}（狙い 10^${want}）`);
    if (L === 300 || L === 456) {
      const from = L <= 300 ? fmtBig(10 ** L) : fmtBig(MATH_MAX, L - 300);
      console.log(`  ${name.padEnd(6)} ${from} → ${fmtBig(c.count, c.over)}`);
    }
  }
}
// 間（10⁶〜10¹²）はなだらか
{
  let prev = 0;
  for (let L = 6; L <= 12; L += 0.5) {
    const c = crowdAt(L);
    c.shrinkDigits(D.rival);
    const lost = L - bigLog(c.count, c.over);
    ok(lost >= prev - 1e-9, `10^${L} で奪う桁が前より減った（なだらかでない）`);
    prev = lost;
  }
}

console.log('=== 4. 最低人数は割らない ===');
{
  const c = crowdAt(20);
  c.shrinkDigits(1);
  ok(c.count >= Math.min(c.count, CFG.minSurvivors) && c.count >= 1, `全滅した: ${c.count}`);
}

if (bad > 0) throw new Error(`桁ダメージの検査に NG が ${bad} 件`);
console.log('\n全部合格');
