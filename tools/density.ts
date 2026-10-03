import './dom-shim';
import { initPhysics } from '../src/core/Physics';
/**
 * ★**密度の測定器**（2026-09-12 新設）。
 *
 * **なぜ要ったか**: 本人が「とげも回転ハンマーも出ていない」「3〜5回ちょろっと出てくるだけでつまんない」
 * と言ったとき、**既存の sim はどれも「何が何個出たか」を出さなかった**。
 * `sim:pacing` は語彙を数えるが、**1回でも出れば語彙に入る**ので
 * 「出ている」と「十分に出ている」の区別がつかない。
 *
 * ★**空き区間と連続空きを数えるのが本体。**
 * 本人の指定:「**2回以上何もギミックや敵がいない区間は存在しないように**」。
 * つまり**連続空きの最長が 1 以下**になるのが合格ライン。
 */
import { CFG, resolveKnobs } from '../src/config';
import { ObstacleField } from '../src/world/ObstacleField';
import { Gates } from '../src/entities/Gates';
import { Crowd } from '../src/entities/Crowd';
import { Boss } from '../src/entities/Boss';

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


const RUNS = 30;
const DT = 1 / 60;
console.log(`実際に湧いた障害物（${RUNS}走行の平均）／ゲート間の空き区間`);
for (let lv = 0; lv < CFG.levels.length; lv++) {
  const sp = CFG.levels[lv];
  const k = resolveKnobs(lv + 1);
  const tally: Record<string, number> = {};
  let gaps = 0, empty = 0, maxRun = 0;
  const place: Record<string, { x: number; wide: number }[]> = {};
  for (let r = 0; r < RUNS; r++) {
    const crowd = new Crowd();
    const gates = new Gates(sp.start, sp.gateTier, sp.gateGap, k.gate);
    const obstacles = new ObstacleField();
    const boss = new Boss();
    obstacles.reset(sp.obstacles, sp.obstacleFrom, sp.obstacleChance, k.obstacle);
    boss.reset(sp.rivals, (lv + 1) % 5 === 0);
    const bossAt = boss.bossAt;
    const stop = bossAt === null ? sp.length - CFG.gate.tailClear
      : Math.min(sp.length - CFG.gate.tailClear, bossAt - CFG.boss.open.gateClear);
    gates.reset(sp.start, sp.gateTier, stop, sp.minCount, sp.gateGap, k.gate);
    gates.reserve(sp.rivals, CFG.boss.clashZ + 6);
    crowd.add(sp.start);
    const live = (obstacles as any).live as { kind: string }[];
    let run = 0;
    gates.onSchedule = (a: number, b: number, clear: boolean) => {
      if (!clear) return;
      /*
       * ★**障害物を置かないと決めている区間は、空きに数えない**（2026-09-12 修正）。
       *   ① `obstacleFrom` の手前 ―― §3「最初の10秒」のために意図的に空けている
       *   ② `minGateGap` より狭い区間 ―― 物理的に置けない
       * ★ここを数えていたため、「連続空き最長 3」が**全部スタート直後の分**でも
       * 同じ数字になっていた（道中がスカスカなのか判別できない）
       */
      /*
       * ★★**2026-09-15: `obstacleFrom` の手前を除外するのをやめた。**
       *
       * 本人の実機:「**2区間に一つもギミックがない区間が連続しないっていうルールあったよね、
       * それ、最初の2区間で出ていないことが多い**」―― ★**本人が正しかった。**
       * この検査は「意図的に空けている区間は空きに数えない」と**自分で除外していた**ので、
       * **最初の2区間がまるごと空でも「合格」と出していた**（＝ 検査の空振り）。
       * ★**遊ぶ人には「意図的に空けた」かどうかは見えない。空は空。**
       * 物理的に置けない区間（`minGateGap` 未満）だけは、今までどおり数えない
       */
      if (b - a < k.obstacle.minGateGap) return;
      const before = live.length;
      obstacles.offer(a, b);
      const added = live.length - before;
      for (let i = before; i < live.length; i++) {
        const o = live[i] as unknown as { kind: string; x: number; wide: number };
        tally[o.kind] = (tally[o.kind] ?? 0) + 1;
        /*
         * ★**置かれた場所と幅を実物から拾う**（2026-09-12）。
         * ★前は別のファイルに**式を書き写して**確かめていたので、
         * `ObstacleField` を直しても**検査側の数字が古いまま**だった。
         * （「同じ判断が2か所にある」の典型。実物を読む形に直した）
         */
        if (o.kind === 'belt' || o.kind === 'hammer') {
          (place[o.kind] ??= []).push({ x: o.x, wide: o.wide });
        }
      }
      gaps++;
      if (added === 0) { empty++; run++; maxRun = Math.max(maxRun, run); } else run = 0;
    };
    gates.onResolve = (res: any) => crowd.setCount(res.after);
    let d = 0;
    while (d < sp.length) {
      d += CFG.runSpeed * DT;
      gates.update(DT, d, crowd.count, 0, 2.2);
      obstacles.update(DT, d, crowd, 0);
    }
  }
  const kinds = Object.entries(tally).map(([kk, n]) => `${kk} ${(n / RUNS).toFixed(1)}`).join(' / ') || '★★何も出ない★★';
  // ★床とハンマーは「逃げ場があるか」が遵いなので、実物の位置から出す
  const edge = CFG.courseWidth / 2 - CFG.playableInset;
  const note: string[] = [];
  for (const [kk, list] of Object.entries(place)) {
    if (list.length === 0) continue;
    let safe = 0;
    for (const o of list) {
      const lo = Math.max(-edge, o.x - o.wide);
      const hi = Math.min(edge, o.x + o.wide);
      safe = Math.max(safe, Math.max(lo - -edge, edge - hi));
    }
    note.push(`${kk} の逃げ場 最大 ${safe.toFixed(2)}m`);
  }
  console.log(
    `Lv${String(lv + 1).padStart(2)} ${sp.length}m [${sp.obstacles.join(',')}] chance ${sp.obstacleChance} from ${sp.obstacleFrom}m`
    + `\n       実測 ${kinds}  ｜ 空き区間 ${(empty / Math.max(1, gaps) * 100).toFixed(0)}% ／ 連続空き最長 ${maxRun}`
    + (note.length ? `
       ${note.join(' / ')}` : ''),
  );
}
