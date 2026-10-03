import './dom-shim';
/**
 * ★**扇風機（風）の測定器**（2026-09-12。元は同じ日の `tools/belt.ts`）。
 *
 * **なぜ要ったか**: この日の朝、動く床を測って
 * ★**「押しは 99% の床で入っているのに、乗っても動かない床が 67〜69%」**
 * という事実が出た。原因は `lateral.keySpeed`(9) より押しが弱く、
 * **握れば打ち消せた**こと（`PROGRESS.md` §26）。
 * ★**扇風機も同じ `this.push` の経路を通るので、同じ罠に落ちる。**
 * だから床を廃止して扇風機にしたあとも、**同じ指標で測り続ける**。
 *
 * ★**プレイヤーの模型は `Game.update` と同じ順番**（操作 → 押し → バネ追従）。
 * ここを簡略にすると、測りたいもの（壁のクランプと綱引き）が消える。
 * `sim:phase4` も `sim:pacing` も x を直接与えているので、**この道は測れない**。
 */
import { CFG, resolveKnobs, lateralHalfWidth } from '../src/config';
import { ObstacleField } from '../src/world/ObstacleField';
import { Gates } from '../src/entities/Gates';
import { Crowd } from '../src/entities/Crowd';
import { initPhysics } from '../src/core/Physics';
/*
 * ★★**当たり判定の WebAssembly を読む**（2026-09-19）。
 * **実機と同じ判定で測るために要る。** 物理抜きで測ると「測定器が実際のプレイを
 * 反映しない」――このリポジトリで何度も出ている失敗なので、sim も必ず同じ道を通す
 */
await initPhysics();


/** `tools/skill.ts` と同じ mulberry32。走行 i は必ず種 i で回す */
let seed = 1;
Math.random = (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const DT = 1 / 60;
const RUNS = 40;
/** つまみを振って測り直すための下駄。`FAN_PUSH=16 npm run sim:wind` */
if (process.env.FAN_PUSH) (CFG.obstacle as { fanPush: number }).fanPush = Number(process.env.FAN_PUSH);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * 操作の型。`hold` が true のとき「行きたい位置」へ `keySpeed`(9m/s) で寄せ続ける。
 * ★**握り続けると、`keySpeed` より弱い押しは打ち消せる。**
 * 「無操作」は `targetX` を一切動かさない ＝ **風だけが残る素の強さ**が出る
 */
const DRIVES: [string, boolean, (t: number) => number][] = [
  ['無操作', false, () => 0],
  ['中央に戻す', true, () => 0],
  ['左右に振る', true, (t) => Math.sin(t * 0.9) * 3.4],
];

type Rec = { pushed: boolean; want: number; x: number };

console.log(`扇風機 ―― 風が本当にプレイヤーを動かしているか（${RUNS}走行 × 操作3種）`);
console.log(`fanPush = ${CFG.obstacle.fanPush} ／ keySpeed = ${CFG.lateral.keySpeed}`);
console.log('★風はランダムに ON / OFF する（本人指定。首振りはしない）ので、一度も吹かない台が必ず出る\n');

for (let lv = 0; lv < CFG.levels.length; lv++) {
  const sp = CFG.levels[lv];
  // 型は各レベルの顔の並びで固まっている（顔ゼロのレベルは never[]）ので、ここだけ広げて見る
  if (!(sp.obstacles as readonly string[]).includes('fan')) continue;
  const k = resolveKnobs(lv + 1);
  let fans = 0, hit = 0;            // 風の帯に入った台数と、実際に押された台数
  let pushSum = 0, lostSum = 0;     // 押しの量と、壁で捨てた量
  let onFrames = 0, bandFrames = 0; // 帯の中にいたフレームのうち、吹いていた割合
  let driftSum = 0, dead = 0;       // 帯を出た時点で「狙いからどれだけずれたか」

  for (let r = 0; r < RUNS; r++) {
    for (const [, hold, drive] of DRIVES) {
      seed = r + 1;
      const crowd = new Crowd();
      const gates = new Gates(sp.start, sp.gateTier, sp.gateGap, k.gate);
      const obstacles = new ObstacleField();
      obstacles.reset(sp.obstacles, sp.obstacleFrom, sp.obstacleChance, k.obstacle);
      gates.reset(sp.start, sp.gateTier, sp.length - CFG.gate.tailClear, sp.minCount, sp.gateGap, k.gate);
      crowd.add(sp.start);
      gates.onSchedule = (a: number, b: number, clear: boolean): void => {
        if (!clear || a < sp.obstacleFrom || b - a < k.obstacle.minGateGap) return;
        obstacles.offer(a, b);
      };
      gates.onResolve = (res: { after: number }): void => crowd.setCount(res.after);

      const live = (obstacles as unknown as {
        live: { kind: string; at: number; x: number; wide: number; blowing: boolean }[];
      }).live;
      const seen = new Map<object, Rec>();
      let d = 0, t = 0, x = 0, targetX = 0;
      while (d < sp.length) {
        d += CFG.runSpeed * DT;
        t += DT;
        gates.update(DT, d, x, crowd.count, lateralHalfWidth(crowd.visualRadiusX));
        obstacles.update(DT, d, crowd, x);
        crowd.update(DT, x);

        const half = lateralHalfWidth(crowd.visualRadiusX);
        // ★`Game.update` と同じ順番: 操作 → 押し → バネ
        const want = clamp(drive(t), -half, half);
        if (hold) {
          const step = CFG.lateral.keySpeed * DT;
          targetX += clamp(want - targetX, -step, step);
        }
        const push = (obstacles as unknown as { push: number }).push;
        if (push !== 0) {
          const before = targetX;
          targetX = clamp(targetX + push * DT, -half, half);
          pushSum += Math.abs(push * DT);
          lostSum += Math.abs(push * DT) - Math.abs(targetX - before);
        }
        x += (targetX - x) * (1 - Math.exp(-CFG.lateral.follow * DT));

        // --- 扇風機1台ごとの記録 ---
        for (const o of live) {
          if (o.kind !== 'fan') continue;
          if (Math.abs(d - o.at) >= k.obstacle.fanRun * 0.5) continue;
          let rec = seen.get(o);
          if (!rec) { rec = { pushed: false, want, x }; seen.set(o, rec); }
          bandFrames++;
          if (o.blowing) onFrames++;
          if (push !== 0) rec.pushed = true;
          /*
           * ★**帯を出た時点の「狙いとのズレ」を持ち回る。**
           * 「押しが入った回数」では効いたことにならない ―― `keySpeed` より弱い風は
           * 毎フレーム打ち消せるので、**抜けた時点で残っているズレ**だけが「流された」
           */
          rec.want = want; rec.x = x;
        }
      }
      for (const rec of seen.values()) {
        fans++;
        // ★通り過ぎるあいだ一度も吹かなかった台は分母から外す（ランダム ON/OFF なので必ず出る）
        if (!rec.pushed) continue;
        hit++;
        const drift = Math.abs(rec.x - rec.want);
        driftSum += drift;
        // 0.4m ＝ 群れの横半径より小さい。これ以下は画面で「動いた」と読めない
        if (drift < 0.4) dead++;
      }
    }
  }

  const n = RUNS * DRIVES.length;
  const pct = (v: number, of: number): string => `${((v / Math.max(1, of)) * 100).toFixed(0)}%`;
  console.log(
    `Lv${String(lv + 1).padStart(2)} fanRun ${k.obstacle.fanRun.toFixed(0)} fanOn ${k.obstacle.fanOn.toFixed(1)} fanOff ${k.obstacle.fanOff.toFixed(1)}`
    + ` ｜ 1走行 ${(fans / n).toFixed(1)}台 ｜ 帯の中で吹いていた割合 ${pct(onFrames, bandFrames)}`
    + `\n       ★一度でも押された台 ${pct(hit, fans)} (${hit}/${fans})`
    + ` ｜ 押し ${(pushSum / n).toFixed(1)}m のうち ★壁で捨てた ${(lostSum / n).toFixed(1)}m (${pct(lostSum, pushSum)})`
    + `\n       ★流された量（風を抜けた時点で狙いからずれて残った距離）平均 ${(driftSum / Math.max(1, hit)).toFixed(2)}m`
    + ` ｜ ★★押されたのに 0.4m 未満しか動かない ${pct(dead, hit)} (${dead}/${hit})`,
  );
}
