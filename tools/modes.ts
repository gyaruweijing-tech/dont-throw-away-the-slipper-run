/**
 * ★**モード（ノーマル／ハード／理系）の数字を決めるための測定**（2026-09-20 新設・`npm run sim:modes`）。
 *
 * ★**なぜ要るか。** ボスの HP は「**何人で着くか**」からしか決められない。
 * `sim:boss` はいまの HP での勝率しか出さないので、**「HP をいくつにすれば勝率が何%になるか」には答えられない**。
 * モードを3つに増やすと、この問いを **3倍**答えることになる。
 *
 * ★**着いたときの人数の分布は HP に依存しない**（ボスは道中に影響しない）。
 * だから**分布は1回だけ測り、HP はその上で総当たり**すればよい ―― 物理を回すのは 1/40 で済む。
 *
 * 勝率の定義は `tools/boss-hp.ts` と同じ:
 *   1回で … 着いた人数 ≧ HP ／ 2回までに … 連続2走行の合計 ≧ HP（持ち越しがあるため）
 */
import './dom-shim';
import { initPhysics } from '../src/core/Physics';
import { CFG, resolveKnobs, resolveLevel, lateralHalfWidth, MODE_LIST, type GameMode } from '../src/config';
import { Crowd } from '../src/entities/Crowd';
import { Gates } from '../src/entities/Gates';
import { ObstacleField } from '../src/world/ObstacleField';
import { Pickups } from '../src/world/Pickups';
import { Boss } from '../src/entities/Boss';

await initPhysics();

const realRandom = Math.random;
let seed = 1;
const seeded = (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
Math.random = seeded;
const SEED_BASE = Number(process.env.SEED_BASE ?? 0) * 1_000_000;
void realRandom;

const DT = 1 / 60;

/** ボスの帯に入る直前の人数。`tools/boss-hp.ts` の `arrive` と同じ手順（★モード込み） */
function arrive(lv: number, drive: (t: number) => number, runSeed: number, mode: GameMode): number {
  seed = SEED_BASE + runSeed;
  const sp = resolveLevel(lv, mode);
  const k = resolveKnobs(lv + 1, mode);
  const mathLv = mode === 'math' ? lv + 1 : null;
  const crowd = new Crowd();
  const boss = new Boss();
  boss.reset(sp.rivals, (lv + 1) % 5 === 0);
  const at = boss.bossAt ?? sp.length;
  const gates = new Gates(sp.start, sp.gateTier, sp.gateGap, k.gate, mathLv);
  gates.reset(sp.start, sp.gateTier, Math.min(sp.length - CFG.gate.tailClear, at - CFG.boss.open.gateClear), sp.minCount, sp.gateGap, k.gate, mathLv);
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

/**
 * 2走行の合計で勝てる割合。
 *
 * ★★**組ませ方は `tools/boss-hp.ts` と1文字も変えない**（`(i * 7 + 3) % n`）。
 * 最初は隣どうし（`i + 1`）で組ませていたが、**同じ2つの道具が同じ問いに違う数字を出した**
 * （Lv10 で 53% と 42%）。隣どうしだと**同じ操作の走行ばかりが組む**ので、
 * `boss-hp.ts` の「操作をまたいで組ませる」とずれる。
 * ★**どちらが正しいかより、2か所に別の定義があることのほうが悪い。**
 */
function rates(all: readonly number[], hp: number): { one: number; two: number } {
  const one = all.filter((n) => n >= hp).length / all.length;
  let two = 0;
  for (let i = 0; i < all.length; i++) {
    if (all[i] + all[(i * 7 + 3) % all.length] >= hp) two++;
  }
  return { one, two: two / all.length };
}

/** 「2回までに ~target%」になる HP を総当たりで探す。人数は整数なので刻みも整数 */
function hpFor(all: readonly number[], target: number): number {
  const hi = Math.max(...all) * 2 + 10;
  let best = 1;
  for (let hp = 1; hp <= hi; hp++) {
    if (rates(all, hp).two >= target) best = hp; else break;
  }
  return best;
}

const RUNS = 20;
const BOSS_LV = [4, 9, 14, 19];

/**
 * ★**モードごとの「2回までに勝てる割合」の帯**（2026-09-20・本人が決めた）。
 * 本人:「**Lv20 は、2回目までに勝てる確率 40% くらい。少しむずいくらいが**」。
 * ノーマルは 40〜65%（最初のボスがいちばん甘く、Lv20 で 40%）。
 * ハードはその下 ―― **どのレベルもノーマルより確実に低い**が、
 * 20% を割ると持ち越しがあっても心が折れるので下限を置く
 */
const BAND: Record<GameMode, [number, number]> = {
  normal: [0.40, 0.65],
  hard: [0.20, 0.45],
  math: [0.20, 0.45],
};

/*
 * ★★**モードごとに測り直す。** ハードはゲートも厳しいので、
 * **着く人数の分布そのものが変わる**。ノーマルの分布に倍率を掛けて
 * 済ませると、Lv20 の 4000 と同じ「測らずに置いた数字」になる
 */
/** 1モードだけ測る下駄。`ONLY=math npm run sim:modes`（全部回すと長いので） */
const ONLY = process.env.ONLY;
for (const m of MODE_LIST) {
  if (ONLY && m.id !== ONLY) continue;
  if (!m.ready) {
    console.log(`\n########## ${m.name} ########## ★準備中なので測らない（ready: false）`);
    continue;
  }
  console.log(`\n########## ${m.name} ##########`);
  const arrivals = new Map<number, number[]>();

  console.log('  --- 1. ボスに着いたときの人数（20走行 × 操作3種 ＝ 60走行）---');
  for (const lv of BOSS_LV) {
    const all: number[] = [];
    for (const [, dr] of drives) {
      all.push(...Array.from({ length: RUNS }, (_, i) => arrive(lv, dr, i + 1, m.id)));
    }
    arrivals.set(lv, all);
    const s2 = [...all].sort((a, b) => a - b);
    console.log(`    Lv${lv + 1}  中央値 ${s2[all.length >> 1]}（${s2[0]}〜${s2[all.length - 1]}）`);
  }

  console.log('  --- 2. いまの HP の勝率 ---');
  for (const [lv, all] of arrivals) {
    const hp = resolveLevel(lv, m.id).rivals.at(-1)!.hp;
    const s2 = [...all].sort((a, b) => a - b);
    const med = s2[all.length >> 1];
    const r = rates(all, hp);
    const ratio = hp / med;
    /*
     * ★**合否は「2回までの勝率が帯に入っているか」で見る。**
     * `tools/boss-hp.ts` の「HP ≦ 1.6 × 中央値」は目安として正しいが、
     * **中央値との比は分布の裾の形で意味が変わる**（同じ 2.0倍でも勝率が 20% にも 50% にもなる）。
     * 欲しいのは勝率のほうなので、判定はそちらでする。比は参考として残す
     */
    const [lo, hi] = BAND[m.id];
    const ok = r.two >= lo && r.two <= hi ? '合格' : '★帯の外';
    console.log(
      `    Lv${lv + 1}  hp=${hp}  1回 ${(r.one * 100).toFixed(0)}% / 2回まで ${(r.two * 100).toFixed(0)}%`
      + `（帯 ${(lo * 100).toFixed(0)}〜${(hi * 100).toFixed(0)}%）${ok} ｜ 参考: 中央値の ${ratio.toFixed(1)}倍`,
    );
  }

  console.log('  --- 3. 目標の勝率にするなら HP はいくつか ---');
  const TARGETS = [0.55, 0.45, 0.40, 0.35, 0.30, 0.25];
  console.log('    ' + 'レベル'.padEnd(8) + TARGETS.map((t) => `${(t * 100).toFixed(0)}%`.padStart(9)).join(''));
  for (const [lv, all] of arrivals) {
    console.log('    ' + `Lv${lv + 1}`.padEnd(8) + TARGETS.map((t) => `${hpFor(all, t)}`.padStart(9)).join(''));
  }
}
