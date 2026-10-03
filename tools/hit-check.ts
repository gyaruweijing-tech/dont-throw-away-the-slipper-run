import './dom-shim';
import * as THREE from 'three';
import { initPhysics } from '../src/core/Physics';
import { Crowd } from '../src/entities/Crowd';
import { ObstacleField } from '../src/world/ObstacleField';
import { ObstacleView, type ObstacleKind } from '../src/entities/Obstacle';
import { CFG, resolveKnobs } from '../src/config';

/*
 * ★★**当たり判定の検査**（2026-09-19）。
 *
 * 出どころは `Collision-Sim` の `tools/verify.mjs` ――
 * 「**主張している挙動を、実際に物理ステップを回して確認する**」。
 * ★**片側だけ調べない**（`docs/notes/sensor-vs-solver-groups` の教訓）。
 * 「当たるべきときに当たる」と「**当たらないべきときに当たらない**」を必ず対で見る。
 */
await initPhysics();

const DT = CFG.hit.dt;
let bad = 0;

function check(name: string, ok: boolean, detail: string): void {
  if (!ok) bad++;
  console.log(`  ${ok ? '合格' : '★不合格'}  ${name} … ${detail}`);
}

/**
 * 1本だけ置いて、主人公を `heroX` に固定したまま通過させ、減った人数を返す。
 * @param count 群れの人数。**「外れる」検査では小さくする** ――
 *   群れは人数ぶん横に太るので、400人の群れは半径 3m になり、
 *   4m 横の障害物にも**端が本当に触れる**（それは正しい当たり）
 */
function pass(kind: ObstacleKind, heroX: number, wide: number, count: number, startX = 0): number {
  const crowd = new Crowd();
  crowd.add(count);
  const field = new ObstacleField();
  field.reset([kind], 0, 1, resolveKnobs(1).obstacle);
  for (let i = 0; i < 240; i++) crowd.update(DT, heroX);   // 隊列を落ち着かせる
  const before = crowd.count;

  const at = 60;
  field.placeForTest(kind, at, startX, wide);
  for (let d = at - 30; d < at + 30; d += CFG.runSpeed * DT) {
    field.update(DT, d, crowd, heroX);
    crowd.update(DT, heroX);
  }
  return before - crowd.count;
}

const SMALL = 8;    // 半径 0.9m ほど。外れるべき検査はこれで見る
const BIG = 400;    // 半径は上限の 3.08m

console.log('=== とげ ===');
{
  const w = CFG.obstacle.spikeW / 2;
  const hit = pass('spike', 0, w, BIG);
  const miss = pass('spike', 4, w, SMALL);
  check('正面のとげ', hit > 0, `−${hit}人`);
  check('4m 横のとげ（小さい群れ）', miss === 0, `−${miss}人`);
}

console.log('\n=== 人事部 ===');
{
  const w = CFG.obstacle.hrW / 2;
  const hit = pass('hr', 0, w, BIG);
  const miss = pass('hr', 4, w, SMALL);
  check('正面の人事部', hit > 0, `−${hit}人`);
  check('4m 横の人事部（小さい群れ）', miss === 0, `−${miss}人`);
}

/*
 * ★★★**ここが 2026-09-19 の本丸。**
 *
 * 回転ハンマーの頭は、絵では `pivot.rotation.y = spin` で回るので
 * **ワールドでは `baseX + len·cos(spin)`** にいる。
 * 旧実装の当たり判定は **`baseX + sin(spin)·sweep`** を見ていた ―― **90°ずれていた。**
 * ★だから「**絵の頭の位置**」と「**判定の箱の位置**」を直に突き合わせる。
 * 通過させる検査では、ハンマーは通過中に振れるので**この食い違いを捕まえられない**
 * （実際そうなって、両方当たってしまった）。**絵そのものを測るしかない。**
 */
console.log('\n=== 回転ハンマー: 絵と判定が同じ場所にあるか ===');
{
  const view = new ObstacleView(new THREE.BoxGeometry(1, 1, 1));
  let worst = 0;
  for (const spin of [0, 0.4, 0.9, 1.57, 2.2, 3.0, 4.1, 5.3]) {
    view.place('hammer', 0, -4, 0.75, spin, 2, 3.2, false);
    view.group.updateMatrixWorld(true);
    const heads: THREE.Object3D[] = [];
    view.group.traverse((o) => { if (o.name === 'hammerHead') heads.push(o); });
    if (heads.length !== 2) { check('絵の頭が2つ見つかる', false, `${heads.length}個`); break; }
    for (const h of heads) {
      const p = h.getWorldPosition(new THREE.Vector3());
      // その頭に一番近い判定の箱との距離
      let near = Infinity;
      for (const b of view.hits) near = Math.min(near, Math.hypot(b.x - p.x, b.z - p.z));
      worst = Math.max(worst, near);
    }
  }
  check('8通りの角度で、絵の頭と判定の箱が重なっている', worst < 0.05, `最大ずれ ${worst.toFixed(3)}m`);
  // ★旧実装が同じ検査を受けたらどうなるかを、数字で残しておく
  let gap = 0;
  let at = 0;
  for (let t = 0; t < Math.PI * 2; t += 0.01) {
    const d = Math.abs(3.2 * Math.cos(t) - 3.2 * Math.sin(t));
    if (d > gap) { gap = d; at = t; }
  }
  console.log(`  参考: 旧判定（sin）と絵（cos）のずれは最大 ${gap.toFixed(2)}m（spin=${at.toFixed(2)}・振り幅3.2のとき）`);
}

console.log('\n=== 回転ハンマー: 振り幅の外なら当たらない ===');
{
  const k = resolveKnobs(11).obstacle;
  const hit = pass('hammer', 0, k.hammerW / 2, BIG);
  // 柱は x=0 に立つので、頭は ±hammerSweep までしか届かない
  const out = k.hammerSweep + k.hammerW + 2.5;
  const miss = pass('hammer', out, k.hammerW / 2, SMALL);
  check('振り幅の内側に立つ', hit > 0, `−${hit}人`);
  check(`振り幅の外（${out.toFixed(1)}m）に立つ`, miss === 0, `−${miss}人`);
}

/*
 * ★**判子は落ちきる前に当たってはいけない。**
 * 旧実装は高さを一度も見ていなかったので、**空の上にある判子で人が減っていた**。
 */
console.log('\n=== 巨大判子: 高さを見ているか ===');
{
  const view = new ObstacleView(new THREE.BoxGeometry(1, 1, 1));
  view.stampY = 6;
  view.place('stamp', 0, 0, 1.6);
  const high = view.hits.map((b) => b.y - b.hy);
  view.stampY = 0;
  view.place('stamp', 0, 0, 1.6);
  const low = view.hits.map((b) => b.y - b.hy);
  check('空の上にある判子の判定は、人の頭より上', Math.min(...high) > 1.5, `箱の下端 ${Math.min(...high).toFixed(2)}m`);
  check('落ちきった判子の判定は、地面に届く', Math.min(...low) < 0.6, `箱の下端 ${Math.min(...low).toFixed(2)}m`);
  const hit = pass('stamp', 0, CFG.obstacle.stampR, BIG);
  check('落ちてくる判子の真下', hit > 0, `−${hit}人`);
}

console.log('\n=== 隙間: 通れるか ===');
{
  const w = CFG.obstacle.pinchGap / 2;
  const miss = pass('pinch', 0, w, SMALL);
  const hit = pass('pinch', 4, w, SMALL);
  check('隙間のど真ん中を通る（小さい群れ）', miss === 0, `−${miss}人`);
  check('隙間から 4m 外れる', hit > 0, `−${hit}人`);
}

/*
 * ★★**まだ遠い障害物で減ってはいけない**（2026-09-19・実機で出た）。
 * 判定用のスロットを使い回しているので、**切り忘れると前のフレームの障害物が残る**。
 * 実際それで「**32m 先のとげで人が減る**」が起きた。**ここは毎回見る。**
 */
console.log('\n=== まだ届いていない障害物 ===');
{
  const crowd = new Crowd();
  crowd.add(400);
  const field = new ObstacleField();
  field.reset(['spike'], 0, 1, resolveKnobs(1).obstacle);
  for (let i = 0; i < 240; i++) crowd.update(DT, 0);
  const before = crowd.count;
  // 種類も位置もばらばらに置いて、スロットの使い回しを起こす
  const kinds: ObstacleKind[] = ['spike', 'hammer', 'hr', 'pinch', 'stamp'];
  kinds.forEach((k, i) => field.placeForTest(k, 60 + i * 7, (i - 2) * 1.5, 1.0));
  for (let d = 0; d < 25; d += CFG.runSpeed * DT) {
    field.update(DT, d, crowd, 0);
    crowd.update(DT, 0);
  }
  check('35m 以上先に5本あるが、1人も減らない', before - crowd.count === 0, `−${before - crowd.count}人`);
}

/*
 * ★★**ダメージの3段階**（phase 2・本人指定）。
 * 「**大きく被る／割と被る／少ししか被らない**」が、実際に3段の階段になっているか。
 * ★**割合で見る** ―― 段は「触れた実体 ÷ 実体数」で決まるので、人数には依らない
 */
console.log('\n=== ダメージの3段階 ===');
{
  const w = 1.0;
  const seen = new Set<string>();
  for (const at of [0, 1.2, 2.4, 3.0, 3.4, 3.8, 4.2, 4.6]) {
    const pct = pass('spike', at, w, 400) / 400 * 100;
    seen.add(pct.toFixed(1));
    console.log(`  ${at.toFixed(1)}m ずれ … −${pct.toFixed(1)}%`);
  }
  /*
   * ★**階段になっていること**が確かめたいこと。連続だと「範囲＝ダメージ」に逆戻りする
   * （本人「当たった範囲＝ダメージにするからダメ」）。**同じ値が何度も出るのが正しい。**
   */
  check('ずれ幅8通りで、出てくる値が階段になる（連続ではない）', seen.size >= 2 && seen.size <= 4, `${seen.size}種類`);
}

console.log(bad === 0 ? '\n全部合格' : `\n★${bad}件 不合格`);
if (bad > 0) process.exit(1);
