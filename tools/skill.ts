import './dom-shim';
import { CFG, resolveKnobs, lateralHalfWidth } from '../src/config';
import { Crowd } from '../src/entities/Crowd';
import { Gates } from '../src/entities/Gates';
import { ObstacleField } from '../src/world/ObstacleField';
import { Boss } from '../src/entities/Boss';
import { Pickups } from '../src/world/Pickups';
import { applyOp, type GateChoice } from '../src/entities/gateOps';
import { initPhysics } from '../src/core/Physics';
/*
 * ★★**当たり判定の WebAssembly を読む**（2026-09-19）。
 * **実機と同じ判定で測るために要る。** 物理抜きで測ると「測定器が実際のプレイを
 * 反映しない」――このリポジトリで何度も出ている失敗なので、sim も必ず同じ道を通す
 */
await initPhysics();


/**
 * **腕前と運を分けて測る**（`GAMEPLAY.md` Phase A の合格条件）。
 *
 * §16 は「完璧操作と無操作を比べる」を手で書いたスクリプトでやって、そのまま捨てていた。
 * だから**同じ物差しで測り直せなくなっていた**。道具として残す。
 *
 * ★**単位は「到達段」ではなく「ゴール人数」。**
 * 段は累積コスト表による対数バケットなので解像度が粗く、
 * **コスト表を変えた瞬間に過去の測定値と比べられなくなる**（外部レビュー 穴4・採用）。
 * 人数ならコスト表から独立している。
 *
 * 読み方:
 *   運の幅  = 完璧操作でのゴール人数の 最大 ÷ 最小。**乱数だけで結果が何倍ちがうか**
 *   腕前の効果 = 完璧操作の中央値 ÷ 無操作の中央値。**上手いと何倍になるか**
 * 合格は「運の幅 ≤ 3倍」かつ「腕前の効果 > 運の幅」。
 */
/**
 * ★**乱数に種を与えて、前後を同じ乱数列で比べる**（2026-08-24・入れ直し）。
 *
 * 最初は素の `Math.random()` で120走行ずつ測っていた。
 * ところが**まったく同じコードの120走行を2回やって、Lv3 の運の幅が 10.6倍 と 21.5倍**になった。
 * 人数は乗算で伸びるので分布の裾が重く、**120本では P90 が安定しない。**
 * 物差しがぶれていると「直したのか壊したのか」が判定できない。
 *
 * `LEARNED.md`（2026-08-23）に同じ教訓が既にある ——
 * 絵の測定でも `Math.random()` のせいで明度が21ずれ、種を固定して差が 0 になった。
 * **同じ罠に2回はまった。**
 *
 * 走行 i は必ず種 i で回す。前の版と後の版を**同じ種の集合**で比べるので、
 * 「乱数がたまたま良かった」が両方に等しく効いて相殺される（対応のある比較）。
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

const DT = 1 / 60;
const RUNS = 120;
/**
 * 種の集合そのものを変えて測り直すための下駄。`SEED_BASE=7 npm run sim:skill`
 * **種を固定しても、標本が120本しかないことは変わらない。**
 * 結論が種の集合で変わるなら、それはまだ「差が出た」と言ってはいけない差
 */
const BASE = Number(process.env.SEED_BASE ?? 0) * 1_000_000;
/** 動ける帯の端（`Game.update` と同じ考え方の上限側） */
const HALF = CFG.courseWidth / 2 - CFG.playableInset;

type Row = { at: number; choices: GateChoice[]; resolved: boolean };
type Live = { at: number; x: number; wide: number; kind: string };

/** 選択肢 i の枠の中心X（`Gates.update` と同じ式） */
const laneX = (i: number, n: number): number =>
  -CFG.courseWidth / 2 + (CFG.courseWidth / n) * (i + 0.5);

function run(lv: number, perfect: boolean, runSeed: number): { count: number; gates: number } {
  // **同じ走行番号なら、無操作でも完璧操作でも同じコースが出る**（操作以外を揃える）
  seed = runSeed;
  const sp = CFG.levels[lv];
  const crowd = new Crowd();
  const gates = new Gates(sp.start, sp.gateTier, sp.gateGap, resolveKnobs(lv + 1).gate);
  gates.reset(sp.start, sp.gateTier, sp.length - CFG.gate.tailClear, sp.minCount, sp.gateGap, resolveKnobs(lv + 1).gate);
  const obstacles = new ObstacleField();
  const boss = new Boss();
  const pickups = new Pickups();
  obstacles.reset(sp.obstacles, sp.obstacleFrom, sp.obstacleChance, resolveKnobs(lv + 1).obstacle);
  boss.reset(sp.rivals, (lv + 1) % 5 === 0);
  gates.reserve(sp.rivals, CFG.boss.clashZ + 6);
  gates.onSchedule = (a, b, clear) => { if (clear) obstacles.offer(a, b); pickups.offer(a, b); };
  let gateCount = 0;
  gates.onResolve = (r) => { gateCount++; crowd.setCount(r.after); };
  crowd.add(sp.start);

  const rows = (gates as unknown as { rows: Row[] }).rows;
  const live = (obstacles as unknown as { live: Live[] }).live;
  let d = 0;
  let x = 0;
  while (d < sp.length) {
    d += CFG.runSpeed * obstacles.speedScale * DT;
    if (perfect) {
      /*
       * **「完璧」の定義**: いちばん手前の出来事に正しく反応する。
       *   ゲート ＝ 今の人数にとって最も増える枠の中心へ寄る
       *   障害物 ＝ 横へ避ける
       * ★**避けを入れないと、腕前ではなく「ゲートだけ見て障害物に突っ込む人」を測ることになる。**
       * 実際、避け無しで測ると Lv4 の腕前の効果が 0.8倍（＝上手いほうが損）になった。
       */
      let near = Infinity;
      let gate: Row | null = null;
      for (const r of rows) {
        const ahead = r.at - d;
        if (r.resolved || ahead < 0 || ahead >= near) continue;
        near = ahead; gate = r;
      }
      let obNear = Infinity;
      let ob: Live | null = null;
      for (const o of live) {
        const ahead = o.at - d;
        if (ahead < -2 || ahead > 22 || ahead >= obNear) continue;
        obNear = ahead; ob = o;
      }
      if (ob && obNear < near) {
        // 群れの半径ぶん余計に離れる。壁際で詰むので、逃げ場の広いほうへ逃げる
        const clear = ob.wide + crowd.visualRadiusX + 0.4;
        const l = ob.x - clear;
        const r = ob.x + clear;
        x = Math.abs(l) <= Math.abs(r) ? l : r;
      } else if (gate) {
        const n = gate.choices.length;
        let best = -Infinity;
        let bi = 0;
        for (let i = 0; i < n; i++) {
          const v = applyOp(crowd.count, gate.choices[i]);
          if (v > best) { best = v; bi = i; }
        }
        x = laneX(bi, n);
      }
      x = Math.max(-HALF, Math.min(HALF, x));
    }
    gates.update(DT, d, x, crowd.count, lateralHalfWidth(crowd.visualRadiusX));
    obstacles.update(DT, d, crowd, x);
    pickups.update(DT, d, crowd, x);
    boss.update(DT, d, crowd, x);
    crowd.update(DT, x);
  }
  return { count: crowd.count, gates: gateCount };
}

/**
 * ★**最小〜最大ではなく 10〜90パーセンタイルで見る。**
 * 人数は乗算で伸びるので、外れ値1本が最大値を10倍動かす。
 * 実際、コードを変えずに測り直しただけで Lv4 の「運の幅」が 361倍 → 1111倍 に振れた。
 * **幅の指標そのものが安定していないと、改善したかを判定できない。**
 */
const pct = (a: number[], p: number): number => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const med = (a: number[]): number => pct(a, 0.5);
const ratio = (a: number, b: number): string => (b <= 0 ? '∞' : `${(a / b).toFixed(1)}倍`);

void realRandom;
console.log('=== 腕前と運（ゴール人数・コスト表から独立した物差し）===');
console.log('乱数は種つき。走行番号が同じなら必ず同じコースになる（版どうしを対応づけて比べるため）');
console.log(`各 ${RUNS} 走行。運の幅 = 完璧の P90 ÷ P10 ／ 腕前の効果 = 完璧の中央値 ÷ 無操作の中央値\n`);
console.log('       無操作(中央値)   完璧(中央値)     完璧の P10〜P90     運の幅   腕前の効果  ゲート');

for (let lv = 0; lv < CFG.levels.length; lv++) {
  const idleR = Array.from({ length: RUNS }, (_, i) => run(lv, false, BASE + lv * 100003 + i));
  const goodR = Array.from({ length: RUNS }, (_, i) => run(lv, true, BASE + lv * 100003 + i));
  const idle = idleR.map((r) => r.count).sort((a, b) => a - b);
  const good = goodR.map((r) => r.count).sort((a, b) => a - b);
  const gc = goodR.map((r) => r.gates).sort((a, b) => a - b);
  const luck = ratio(pct(good, 0.9), Math.max(1, pct(good, 0.1)));
  const skill = ratio(med(good), Math.max(1, med(idle)));
  console.log(
    `Lv${lv + 1}  ${String(med(idle)).padStart(11)}人 ${String(med(good)).padStart(12)}人` +
    `   ${String(pct(good, 0.1)).padStart(6)} 〜 ${String(pct(good, 0.9)).padEnd(7)}` +
    ` ${luck.padStart(8)} ${skill.padStart(12)}` +
    `   ${gc[0]}〜${gc[gc.length - 1]}本`,
  );
}
