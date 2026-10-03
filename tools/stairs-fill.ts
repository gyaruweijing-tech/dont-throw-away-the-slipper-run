import './dom-shim';
import { Stairs } from '../src/entities/Stairs';
import { CFG } from '../src/config';

/**
 * 段ごとに人が立っているかを数える。**空き段が出ないこと**の回帰テスト（§13 / 2026-08-22）。
 * 実機と同じ Stairs をそのまま回し、standing の y から段を逆算する。
 */
const DT = 1 / 60;
const S = CFG.stairs;
const N = S.cost.length;

function fill(count: number): { reached: number; per: number[]; secs: number } {
  const s = new Stairs();
  s.begin(count);
  let t = 0;
  while (!s.settled && t < 40) { t += DT; s.update(DT, -15); }
  const per = new Array(N).fill(0);
  for (const p of (s as any).standing as { y: number }[]) {
    const step = Math.round(p.y / S.rise) - 1;
    if (step >= 0 && step < N) per[step]++;
  }
  return { reached: s.reached, per, secs: t };
}

console.log('=== 段ごとの立ち人数（到達段までに 0 があってはいけない）===');
let bad = 0;
for (const n of [5, 40, 70, 100, 180, 250, 420, 600, 900, 1400, 2000, 3200, 7200, 16200, 40000]) {
  const r = fill(n);
  const upto = r.per.slice(0, Math.max(1, r.reached));
  const empty = upto.filter((v) => v === 0).length;
  if (empty > 0) bad++;
  console.log(
    `${String(n).padStart(6)}人 → ${String(r.reached).padStart(2)}段 / 各段 [${r.per.join(', ')}]` +
    ` / 合計 ${r.per.reduce((a, b) => a + b, 0)} / ${r.secs.toFixed(1)}秒` +
    (empty > 0 ? `  ← 空き段 ${empty}` : ''),
  );
}

console.log('\n=== 2周目に前回の立ち姿が残らないか（hide() のリセット漏れ）===');
const s = new Stairs();
s.begin(16200);
let t = 0;
while (!s.settled && t < 40) { t += DT; s.update(DT, -15); }
const before = (s as any).standing.length;
s.hide();
const after = (s as any).standing.length;
const meshAfter = (s as any).standMesh.count;
console.log(`払い切り後 ${before} 人 → hide() 後 ${after} 人 / standMesh.count=${meshAfter}`);
if (after !== 0 || meshAfter !== 0) { console.log('NG: 前回の立ち姿が残る'); bad++; }

console.log(bad === 0 ? '\nOK: 空き段なし・リセット漏れなし' : `\nNG: ${bad} 件`);
if (bad > 0) process.exit(1);
