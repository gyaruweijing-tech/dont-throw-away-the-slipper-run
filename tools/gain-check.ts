/** ★札の色（isGain）と、実際に増えるかの食い違いを洗い出す（2026-09-21） */
import { applyOp, gateLabel, isGain, MATH_PLAIN, MATH_USES_V } from '../src/entities/gateOps';
const NS = [2, 3, 4, 5, 6, 8, 12, 30, 100, 500, 3000];
console.log('札            色       実際に増える人数           判定');
for (const op of MATH_PLAIN) {
  const v = MATH_USES_V.has(op) ? 7 : 0;
  const blue = isGain({ op, v });
  const up: number[] = []; const down: number[] = [];
  for (const n of NS) {
    const r = applyOp(n, { op, v });
    if (r > n) up.push(n); else if (r < n) down.push(n);
  }
  // 藍（増える色）なのに減る人数がある／朱（減る色）なのに増える人数がある
  const bad = blue ? down.length > 0 : up.length > 0;
  const mark = bad ? (blue ? '★藍なのに減る' : '★朱なのに増える') : '合っている';
  console.log(
    `${gateLabel({ op, v }).padEnd(12)} ${(blue ? '藍(増)' : '朱(減)').padEnd(7)} `
    + `増[${up.join(',') || 'なし'}] 減[${down.join(',') || 'なし'}]`.padEnd(42) + mark,
  );
}
