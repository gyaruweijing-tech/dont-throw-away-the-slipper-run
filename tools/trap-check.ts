/**
 * **理不尽の検査**（2026-08-24 新設。外部レビュー #6 / #3）。
 *
 * 調べるのは2つ:
 *  1. **印紙の弧が画面端へ誘導した直後に、避けられない障害物が置かれていないか。**
 *     弧は「内側から外側へ抜ける掃き出し」なので、取り切ると必ず端に居る。
 *     その状態で障害物が同じ側に来ると、**拾ったことが罰になる**
 *  2. **mod ゲート（tier4）を踏んだとき、走行がそこで終わるのか。**
 *     「難易度」と「今までの全否定」は別物。踏んだあと何人まで戻せるかを見る
 */
import './dom-shim';
import { CFG, resolveKnobs, lateralHalfWidth } from '../src/config';
import { Crowd } from '../src/entities/Crowd';
import { Gates } from '../src/entities/Gates';
import { ObstacleField } from '../src/world/ObstacleField';
import { Pickups } from '../src/world/Pickups';
import { GateDirector } from '../src/world/GateDirector';
import { applyOp } from '../src/entities/gateOps';

const DT = 1 / 60;
const EDGE = CFG.courseWidth / 2 - CFG.playableInset;

/*
 * ★**種を入れる**（2026-08-27・`tools/skill.ts:42` と `tools/pacing.ts` に続いて3本目）。
 *
 * 入れる前は、コードを1文字も変えずに回すたびに
 * **Lv1 の弧の本数が 553〜591 本と揺れ、危険と出る本数も 0〜3 本で動いていた。**
 * 「0本なのか3本なのか」は結論そのものなので、揺れたままでは前後比較にならない。
 * 走行 s は必ず種 s で回す（対応のある比較）。
 */
let seed = 1;
Math.random = (): number => {
  // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** 走行ごとに種を置き直す。前後の版を同じ種の集合で比べるため */
const reseed = (s: number): void => { seed = s * 7919 + 1; for (let i = 0; i < 16; i++) Math.random(); };

/*
 * ★**1人も減らさない種類は「障害物」に数えない**（2026-08-27 修正）。
 *
 * ここは `kind !== 'belt'` だけを弾いていた。動く床しか無害な種類が無かった頃の名残で、
 * 2026-08-26 に足した **坂（`slope`/`climb`）と修正テープ（`whiteout`）が数に入っていた**。
 * この3種は**帯**なので `wide` に「帯の半分の長さ」（22〜42m の半分）が入り、`x` は 0。
 * 「同じ側にあり、横に逃げる余裕で届かない」の判定に入れると**必ず危険と出る**ので、
 * Lv11〜15（坂の区画）だけ 17〜28% が危険という**偽の山**ができていた。
 *
 * 判定の元は `ObstacleField.update` の `hurts`。**あちらを変えたらここも変える。**
 */
const HURTS = (k: string): boolean =>
  k !== 'belt' && k !== 'whiteout';

console.log('=== 1. 印紙の弧 → 障害物 の理不尽（外部レビュー #6）===');
console.log(`操作できる帯 ±${EDGE.toFixed(2)} / 弧の外端 ${CFG.pickup.arcOuter}\n`);

// ★**全20レベルを見る**（2026-08-27）。4本の抜き取りだと、
// 危険が出るのが Lv13 だけなのか、区画ごとの傾向なのかが分からない
for (let lv = 0; lv < CFG.levels.length; lv++) {
  const sp = CFG.levels[lv];
  let arcs = 0, risky = 0, worst = Infinity;
  for (let s = 0; s < 40; s++) {
    reseed(s);
    const crowd = new Crowd();
    const gates = new Gates(sp.start, sp.gateTier, sp.gateGap, resolveKnobs(lv + 1).gate);
    const obstacles = new ObstacleField();
    const pickups = new Pickups();
    gates.reset(sp.start, sp.gateTier, sp.length - CFG.gate.tailClear, sp.minCount, sp.gateGap, resolveKnobs(lv + 1).gate);
    obstacles.reset(sp.obstacles, sp.obstacleFrom, sp.obstacleChance, resolveKnobs(lv + 1).obstacle);
    // 置かれた物の一覧を作る
    const coins: { at: number; x: number }[] = [];
    const obs: { at: number; x: number; wide: number }[] = [];
    (pickups as unknown as { onPlace?: unknown }).onPlace = undefined;
    gates.onSchedule = (a, b, clear) => {
      const before = (obstacles as unknown as { live: { kind: string; at: number; x: number; wide: number }[] }).live.length;
      if (clear) obstacles.offer(a, b);
      const items = (obstacles as unknown as { live: { kind: string; at: number; x: number; wide: number }[] }).live;
      for (let i = before; i < items.length; i++) if (HURTS(items[i].kind)) obs.push({ at: items[i].at, x: items[i].x, wide: items[i].wide });
      const cb = (pickups as unknown as { coins: { at: number; x: number }[] }).coins.length;
      pickups.offer(a, b);
      const cs = (pickups as unknown as { coins: { at: number; x: number }[] }).coins;
      for (let i = cb; i < cs.length; i++) coins.push({ at: cs[i].at, x: cs[i].x });
    };
    let d = 0;
    while (d < sp.length) { d += CFG.runSpeed * DT; gates.update(DT, d, 0, crowd.count || sp.start, lateralHalfWidth(crowd.visualRadiusX)); }

    // 弧の終端（同じ側で at が最大のもの）を拾い、その先20mの障害物と比べる
    coins.sort((a, b) => a.at - b.at);
    for (let i = 0; i < coins.length; i++) {
      const isEnd = i === coins.length - 1 || coins[i + 1].at - coins[i].at > 3;
      if (!isEnd || Math.abs(coins[i].x) < CFG.pickup.arcOuter * 0.8) continue;
      arcs++;
      for (const o of obs) {
        const dz = o.at - coins[i].at;
        if (dz < 0 || dz > 20) continue;
        // 同じ側にあり、横に逃げる余裕（dz/走速 秒 × 横速度）で届かないか
        const need = Math.abs(o.x - coins[i].x) - o.wide;
        // ★`CFG.lateralSpeed` は**存在しないプロパティ**だった（2026-08-27 修正）。
        // undefined を掛けるので `canMove` が NaN になり、次行の比較が常に false ＝
        // **危険と判定された弧が一度も無い**（＝この検査はずっと 0 本と報告していた）。
        // 主人公の横速度は `CFG.lateral.keySpeed`
        const canMove = (dz / CFG.runSpeed) * CFG.lateral.keySpeed;
        if (need < 0 && canMove < o.wide * 2) { risky++; worst = Math.min(worst, dz); break; }
      }
    }
  }
  console.log(`  Lv${lv + 1}  弧の終端 ${arcs} 本中 **${risky} 本**が危険` +
    `${risky ? `（最短 ${worst.toFixed(1)}m）` : ''}`);
}

console.log('\n=== 2. mod ゲートを踏んだあと戻せるか（外部レビュー #3）===');
{
  const sp = CFG.levels[16];   // Lv17
  let hit = 0, sumBefore = 0, sumAfter = 0, sumEnd = 0, endAll = 0, runs = 0;
  for (let s = 0; s < 300; s++) {
    const d = new GateDirector(sp.start, sp.gateTier);
    let n: number = sp.start, before = 0, after = 0, met = false;
    for (let i = 0; i < 12; i++) {
      const cs = d.next().choices;
      let b = 0;
      for (let k = 1; k < cs.length; k++) if (applyOp(n, cs[k]) > applyOp(n, cs[b])) b = k;
      const mi = cs.findIndex((c) => c.op === 'mod');
      // 「大きい記号を取る」で走ってきた人が踏む想定 ＝ mod を選んでしまう
      const pick = mi >= 0 ? mi : b;
      if (mi >= 0 && !met) { met = true; before = n; after = applyOp(n, cs[pick]); }
      n = applyOp(n, cs[pick]);
      d.sync(n);
    }
    runs++; endAll += n;
    if (met) { hit++; sumBefore += before; sumAfter += after; sumEnd += n; }
  }
  if (hit === 0) {
    console.log(`  mod に当たった走行 0/${runs} ＝ **いまは意図的に寝かせてある**（PLANS[4] から外した。§12-7）`);
    console.log('  外す前の実測: 直前 50,070人 → 直後 11人 / ゴール平均 59人 ＝ 0.1% しか戻せない');
  } else {
  console.log(`  mod に当たった走行 ${hit}/${runs}`);
  console.log(`  踏む直前の平均 ${Math.round(sumBefore / hit)}人 → 直後 ${Math.round(sumAfter / hit)}人`);
  console.log(`  踏んだ走行のゴール平均 ${Math.round(sumEnd / hit)}人`);
  console.log(`  ★踏んだあと ${(sumEnd / hit / (sumBefore / hit) * 100).toFixed(1)}% まで戻せている`);
  }
}
