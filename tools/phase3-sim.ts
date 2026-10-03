import './dom-shim';
import { initPhysics } from '../src/core/Physics';
import { Crowd } from '../src/entities/Crowd';
import { Gates } from '../src/entities/Gates';
import { ObstacleField } from '../src/world/ObstacleField';
import { CFG, resolveKnobs, lateralHalfWidth } from '../src/config';

import { seedRandom } from './seed';
/*
 * ★**種を置く**（2026-09-15・検品 `59490ca` の指摘）。
 * これが無いと**同じコミットで2回回しただけで数字が変わり**、版どうしを比べられない。
 * ★**測り方を変えたわけではない**（走行数も式もそのまま）。毎回同じ道を引くようにしただけ
 */
seedRandom();

/*
 * ★★**当たり判定の WebAssembly を読む**（2026-09-19）。
 * **実機と同じ判定で測るために要る。** 物理抜きで測ると「測定器が実際のプレイを
 * 反映しない」――このリポジトリで何度も出ている失敗なので、sim も必ず同じ道を通す
 */
await initPhysics();


const DT = 1 / 60;

function play(seconds: number, startCount: number, drive: (t: number) => number) {
  const crowd = new Crowd();
  // tier3 ＝ 全部の型を出す（Lv5 相当）。つまみも Lv5 のものを渡す（既定値に落とさない）
  const gates = new Gates(startCount, 3, 1, resolveKnobs(5).gate);
  gates.reset(startCount, 3, Infinity, 0, 1, resolveKnobs(5).gate);
  const obstacles = new ObstacleField();
  gates.onSchedule = obstacles.offer;
  obstacles.reset(CFG.levels[4].obstacles, CFG.levels[4].obstacleFrom, CFG.levels[4].obstacleChance, resolveKnobs(5).obstacle);
  crowd.add(startCount);

  let distance = 0;
  let t = 0;
  let gateLoss = 0, gateGain = 0, obsLoss = 0, noiseLoss = 0;
  let loudSec = 0, syainEncounters = 0;
  const obsHits: number[] = [];
  const gateAts: number[] = [];
  const obsAts: number[] = [];
  let minGateObsGap = Infinity;

  gates.onResolve = (r) => {
    crowd.setCount(r.after);
    if (r.after >= r.before) gateGain += r.after - r.before;
    else gateLoss += r.before - r.after;
    gateAts.push(distance);
  };
  obstacles.onHit = (_x, loss) => { obsLoss += loss; obsHits.push(loss); obsAts.push(distance - 1.5); };

  while (t < seconds) {
    t += DT;
    distance += CFG.runSpeed * obstacles.speedScale * DT;
    const x = drive(t);
    gates.update(DT, distance, x, crowd.count, lateralHalfWidth(crowd.visualRadiusX));
    obstacles.update(DT, distance, crowd, x);
    crowd.update(DT, x);
  }

  for (const a of obsAts) for (const b of gateAts) minGateObsGap = Math.min(minGateObsGap, Math.abs(a - b));

  return { crowd, gateGain, gateLoss, obsLoss, noiseLoss, obsHits, loudSec, syainEncounters, minGateObsGap, distance };
}

// 中央固定＝何も避けない下手なプレイ
const r1 = play(180, 8, () => 0);
console.log('=== 3分・中央固定（何も避けない） ===');
console.log(`  走行 ${r1.distance.toFixed(0)}m / 最終 ${r1.crowd.count}人（描画 ${r1.crowd.drawn}体）`);
console.log(`  ゲート +${r1.gateGain} / −${r1.gateLoss}`);
console.log(`  障害物 −${r1.obsLoss}（${r1.obsHits.length}回 / 1回あたり平均 ${Math.round(r1.obsLoss / Math.max(1, r1.obsHits.length))}）`);
console.log(`  社員の騒音 −${r1.noiseLoss}（遭遇 ${r1.syainEncounters}回 / うるさかった時間 ${r1.loudSec.toFixed(1)}秒）`);
console.log(`  ゲートと障害物の最小間隔 ${r1.minGateObsGap.toFixed(1)}m（ゲート間隔の約半分あれば正常）`);

// 左右に振って避ける上手なプレイ
const r2 = play(180, 8, (t) => Math.sin(t * 0.9) * 3.4);
console.log('\n=== 3分・左右に振る ===');
console.log(`  最終 ${r2.crowd.count}人 / 障害物 −${r2.obsLoss} / 騒音 −${r2.noiseLoss}`);
console.log(`  ゲートと障害物の最小間隔 ${r2.minGateObsGap.toFixed(1)}m`);

// 描画上限を超えた大群でも障害物が効いているか（被害スケールの検証）
const big = new Crowd();
big.add(6000);
for (let i = 0; i < 200; i++) big.update(DT, 0);
const before = big.count;
/*
 * ★★**2026-09-19: `hitBurst` を消したので、ここは `strike` で測る。**
 * 見ているものは同じ ―― **描画上限（実体839体）を超えた大群でも、
 * 論理人数がちゃんと減るか**。段階の割合は `CFG.hit.lossMid` を使う
 */
const bodies = big.agents.map((a, n) => (!a.leaving && Math.abs(a.x) <= 1 ? n : -1)).filter((n) => n >= 0);
const loss = big.strike(bodies, before * CFG.hit.lossMid);
console.log(`\n=== 描画上限ごしの被害スケール ===`);
console.log(`  論理 ${before}人 / 実体 ${big.drawn}体 → 触れた ${bodies.length}体 で −${loss}人 (${(loss / before * 100).toFixed(1)}%)`);
console.log(`  実体数だけで引いていたら −${bodies.length}人 = ${(bodies.length / before * 100).toFixed(2)}% にしかならない`);
