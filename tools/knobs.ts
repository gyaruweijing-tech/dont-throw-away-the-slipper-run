import './dom-shim';
import { CFG, ZONES, resolveKnobs } from '../src/config';

/**
 * **区画のつまみを解決した結果を、20レベルぶん並べて見せる**（2026-08-26）。
 *
 * ★これは外部レビューの指摘への答え。区画をベースにレベルが上書きする形は
 * 「**この値は区画のものか、レベルの例外か**」が分からなくなる、という指摘は正しい。
 * **解決後の表を目で見られるなら、その問題は起きない。**
 *
 * `npm run sim:knobs`
 */
const base = {
  obstacle: CFG.obstacle as Record<string, number>,
  gate: CFG.gate as unknown as Record<string, number>,
};

console.log('区画のつまみ（既定値と違うものだけ出す。何も出ないレベルは全部が既定値）\n');
for (const z of ZONES) {
  console.log(`■ 区画「${z.name}」 Lv${z.fromLv}〜${z.toLv}`);
  for (let lv = z.fromLv; lv <= z.toLv && lv <= CFG.levels.length; lv++) {
    const k = resolveKnobs(lv) as unknown as Record<string, Record<string, number>>;
    const diff: string[] = [];
    for (const group of ['obstacle', 'gate'] as const) {
      for (const [key, v] of Object.entries(k[group])) {
        const b = base[group][key];
        if (Math.abs(v - b) > 1e-9) diff.push(`${key} ${b}→${v.toFixed(2)}`);
      }
    }
    console.log(`  Lv${String(lv).padStart(2)}  ${diff.length === 0 ? '（全部が既定値）' : diff.join(' / ')}`);
  }
  console.log('');
}
