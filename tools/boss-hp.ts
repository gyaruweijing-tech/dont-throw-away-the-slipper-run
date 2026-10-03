/**
 * ★**ボスの前に着いたときの人数を測る**（2026-09-06 新設・`npm run sim:boss`）。
 *
 * ★**なぜ要ったか。** ボスの HP は「どれくらい削れるか」で決めるしかないのに、
 * それを測る道具が1つも無く、**8/28 から「Lv15 が3通りの操作すべてで敗北」が放置**されていた。
 * `sim:phase4` は突破したかどうかは出すが、**負けた回に何人で着いたか**は出さないので、
 * 「HP を何人にすればいいか」には答えられない。
 *
 * 出るのは**ボスの帯に入る直前の人数**（中央値と幅）。HP を決める基準は:
 *   **HP ≦ 1.6 × 中央値**（＝中央値の走りなら持ち越しで2回目に勝てる／上手い走りなら1回で勝てる）
 *
 * ★**種つき**（2026-09-06 夜に入れた）。走行番号が同じなら必ず同じコースになるので、
 * **版どうしを比べられる**。種の集合ごと変えて確かめたいときは `SEED_BASE=7 npm run sim:boss`
 */
import './dom-shim';
import { initPhysics } from '../src/core/Physics';
import { CFG, resolveKnobs, lateralHalfWidth } from '../src/config';
import { Crowd } from '../src/entities/Crowd';
import { Gates } from '../src/entities/Gates';
import { ObstacleField } from '../src/world/ObstacleField';
import { Pickups } from '../src/world/Pickups';
import { Boss } from '../src/entities/Boss';

/*
 * ★★**当たり判定の WebAssembly を読む**（2026-09-19）。
 * **実機と同じ判定で測るために要る。** 物理抜きで測ると「測定器が実際のプレイを
 * 反映しない」――このリポジトリで何度も出ている失敗なので、sim も必ず同じ道を通す
 */
await initPhysics();



/*
 * ★**種を固定する**（2026-09-06 夜。クラウド検品が 8/29 から積み続けていた `- [!]`）。
 *
 * 検品の指摘:「**コードが1行も変わっていないのに、Lv15 の敗北が 9/9 → 6/9 → 8/9 と動く。
 * この表からは『ボス回で終わる走行が 58〜75% ある』しか読めず、どのレベルが重いかは決まらない**」。
 * ★**種が無いまま `rivals[].hp` を触るな**という警告だったが、
 * 2026-09-06 の夜にこちらが先に hp を触ってしまったので、**種を入れて測り直す**。
 *
 * `tools/skill.ts` と同じ mulberry32。走行番号 i は必ず種 i で回すので、
 * **版どうしを同じ種の集合で比べられる**（対応のある比較）
 */
const realRandom = Math.random;
let seed = 1;
const seeded = (): number => {
  // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
Math.random = seeded;
/** 種の集合そのものを変えて測り直す下駄（`SEED_BASE=7 npm run sim:boss`） */
const SEED_BASE = Number(process.env.SEED_BASE ?? 0) * 1_000_000;
void realRandom;

const DT = 1 / 60;

function arrive(lv: number, drive: (t: number) => number, runSeed: number): number {
  seed = SEED_BASE + runSeed;
  const sp = CFG.levels[lv];
  const k = resolveKnobs(lv + 1);
  const crowd = new Crowd();
  const boss = new Boss();
  boss.reset(sp.rivals, (lv + 1) % 5 === 0);
  const at = boss.bossAt ?? sp.length;
  const gates = new Gates(sp.start, sp.gateTier, sp.gateGap, k.gate);
  gates.reset(sp.start, sp.gateTier, Math.min(sp.length - CFG.gate.tailClear, at - CFG.boss.open.gateClear), sp.minCount, sp.gateGap, k.gate);
  const obstacles = new ObstacleField();
  const pickups = new Pickups();
  obstacles.reset(sp.obstacles, sp.obstacleFrom, sp.obstacleChance, k.obstacle);
  gates.onSchedule = (a, b, clear) => { if (clear) obstacles.offer(a, b); pickups.offer(a, b); };
  gates.onResolve = (r) => crowd.setCount(r.after);
  pickups.onCoin = () => {};
  pickups.onMult = () => {};
  crowd.add(sp.start);
  let d = 0, t = 0;
  while (d < at - CFG.boss.clashZ) {
    t += DT;
    d += CFG.runSpeed * obstacles.speedScale * DT;
    const x = drive(t);
    gates.update(DT, d, x, crowd.count, lateralHalfWidth(crowd.visualRadiusX));
    obstacles.update(DT, d, crowd, x);
    pickups.update(DT, d, crowd, x);
    crowd.update(DT, x);
  }
  return crowd.count;
}

const drives: [string, (t: number) => number][] = [
  ['中央固定', () => 0],
  ['左右に振る', (t) => Math.sin(t * 0.9) * 3.4],
  ['速く振る', (t) => Math.sin(t * 2.1) * 3.9],
];
console.log('ボスに着いたときの人数（各20走行の中央値／最小〜最大）');
const arrivals = new Map<number, number[]>();
for (const lv of [4, 9, 14, 19]) {
  const hp = CFG.levels[lv].rivals.at(-1)!.hp;
  const all: number[] = [];
  const line: string[] = [];
  for (const [name, dr] of drives) {
    const xs = Array.from({ length: 20 }, (_, i) => arrive(lv, dr, i + 1));
    all.push(...xs);
    const s = [...xs].sort((a, b) => a - b);
    line.push(`${name} ${s[10]}(${s[0]}〜${s[19]})`);
  }
  arrivals.set(lv, all);
  console.log(`  Lv${lv + 1} hp=${hp}  ` + line.join(' / '));
}

/*
 * ★**勝てる割合**（2026-09-06）。`sim:phase4` は1操作につき1走行しか回さないので、
 * **運の幅が100倍あるこのゲームでは「たまたま負けた」と「勝てない」を区別できない**。
 * 持ち越し（`bosshp:<level>`）があるので、見るべきは「**2回目までに勝てるか**」。
 * 削った量は次の挑戦に持ち越されるので、2回の合計人数が HP を超えれば勝てる
 */
console.log('');
console.log('勝てる割合（60走行。★持ち越しがあるので「2回目まで」が実際の手応え）');
for (const [lv, all] of arrivals) {
  const hp = CFG.levels[lv].rivals.at(-1)!.hp;
  const one = all.filter((n) => n >= hp).length / all.length;
  let two = 0;
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    const b = all[(i * 7 + 3) % all.length];   // 別の走行と組ませる（決め打ちでよい）
    if (a + b >= hp) two++;
  }
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  console.log(`  Lv${lv + 1} hp=${hp}  1回で ${pct(one)} / 2回までに ${pct(two / all.length)}`);
}

