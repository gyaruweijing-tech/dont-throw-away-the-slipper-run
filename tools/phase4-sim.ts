import './dom-shim';
import { initPhysics } from '../src/core/Physics';
import { Stairs } from '../src/entities/Stairs';
import { CFG, resolveKnobs, lateralHalfWidth } from '../src/config';


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
/** 何本目の走行か。種を1本ずつ進めるための番号 */
let runNo = 0;

const DT = 1 / 60;
const N = CFG.stairs.cost.length;

function hearing(count: number) {
  const s = new Stairs();
  s.begin(count);
  let t = 0, spent = 0, frames = 0;
  while (!s.settled && t < 30) {
    t += DT;
    spent += s.update(DT, -15);
    frames++;
    if (frames > 60 * 30) break;
  }
  return { reached: s.reached, spent, seconds: t };
}

console.log('段の必要人数(累積):', CFG.stairs.cost.reduce<number[]>((a, c) => [...a, (a.at(-1) ?? 0) + c], []).join(' / '));
console.log('\n連れてきた人数 → 到達段 / 払った人数 / 演出の長さ');
for (const n of [0, 4, 5, 14, 15, 39, 40, 99, 100, 249, 250, 600, 1400, 3200, 7200, 16200, 40000]) {
  const r = hearing(n);
  const open = r.reached >= N ? ' ← 扉が開く' : '';
  console.log(`  ${String(n).padStart(6)} → ${String(r.reached).padStart(2)}段 / 払い ${String(r.spent).padStart(6)} / ${r.seconds.toFixed(1)}秒${open}`);
}

// 「あと1人足りない」が成立しているか（§4-E の引き止め装置）
let bad = 0;
/*
 * ★**判定行の NG を1か所に貯める**（2026-09-11）。
 * 9/8 は `minCount` の節がその場で `process.exit(1)` したせいで、**その下の
 * 「ゲームオーバー率」が一度も測れなかった**（＝ 直したい当の数字が見えない）。
 * **落ちるのは全部の節を出し切ってから**。`bad`（段の境界）は上の行で刷り終えている
 */
let ng = 0;
const cum: number[] = [];
let acc = 0;
for (const c of CFG.stairs.cost) { acc += c; cum.push(acc); }
for (let i = 0; i < N; i++) {
  const just = hearing(cum[i]).reached;
  const one = hearing(cum[i] - 1).reached;
  if (just !== i + 1 || one !== i) { console.log(`  NG 段${i + 1}: ちょうど=${just} / 1人不足=${one}`); bad++; }
}
console.log(`\n段の境界（ちょうどで登れて、1人足りないと登れない）: ${N - bad}/${N} ok`);

// --- レベル1本を通してゴール人数を見る（§4-E の引き止め装置が成立するか） ---
import { Crowd } from '../src/entities/Crowd';
import { Gates } from '../src/entities/Gates';
import { ObstacleField } from '../src/world/ObstacleField';
import { Boss } from '../src/entities/Boss';
import { Pickups } from '../src/world/Pickups';

/*
 * ★★**当たり判定の WebAssembly を読む**（2026-09-19）。
 * **実機と同じ判定で測るために要る。** 物理抜きで測ると「測定器が実際のプレイを
 * 反映しない」――このリポジトリで何度も出ている失敗なので、sim も必ず同じ道を通す
 */
await initPhysics();


/**
 * @param greedy true なら「一番近い拾い物へ寄せる」操作にする。
 *   固定の sin では**狙って取る**が再現できず、中央に立つのと差が出ない（実測）。
 *   拾い物の設計が効いているかは、この操作と中央固定の差でしか測れない。
 */
function level(
  lv: number,
  drive: (t: number) => number,
  bossDrive?: (t: number) => number,
  greedy = false,
): { count: number; seconds: number; broke: number; ghosts: number; picked: number; mults: number; hung: boolean; lost: boolean } {
  /*
   * ★**走行ごとに種を進める。** 呼ばれる順番はスクリプトが決めているので毎回同じ並びになり、
   * **版どうしを同じコースで比べられる**（検品が 8/29 から指摘していた件）
   */
  seed = SEED_BASE + ++runNo;
  const sp = CFG.levels[lv];
  const crowd = new Crowd();
  const gates = new Gates(sp.start, sp.gateTier, sp.gateGap, resolveKnobs(lv + 1).gate);
  const obstacles = new ObstacleField();
  const boss = new Boss();
  const pickups = new Pickups();
  obstacles.reset(sp.obstacles, sp.obstacleFrom, sp.obstacleChance, resolveKnobs(lv + 1).obstacle);
  /*
   * ★**ボスを先に組む**（2026-09-06）。`Game.enter()` と同じ順番。
   * ゲートの打ち止め位置が `boss.bossAt` を見るので、逆にすると
   * **打ち止めが効かないまま静かに動く**（`Game` 側のコメントと同じ穴を sim でも踏む）
   */
  boss.reset(sp.rivals, (lv + 1) % 5 === 0);
  /*
   * ★★**ボス回のゲート打ち止めを sim にも入れた**（2026-09-06）。
   * ここが `sp.length - tailClear` のままだったので、**sim だけ広場の中にゲートを作り**、
   * 「ゴール時点で未決着のゲートが残る（0 でなければならない）」が
   * **Lv5/10/15/20 で NG を出し続けていた**。実機は §18 で
   *   ① `bossAt - open.gateClear` で打ち止め ② 広場の入口で `clearUnresolved()`
   * の2段構えにしてあるので、**測定器の側が古かった**（`- [!]` の「sim と実機で違う値」の型）
   */
  const bossAt = boss.bossAt;
  const gateStop = bossAt === null
    ? sp.length - CFG.gate.tailClear
    : Math.min(sp.length - CFG.gate.tailClear, bossAt - CFG.boss.open.gateClear);
  gates.reset(sp.start, sp.gateTier, gateStop, sp.minCount, sp.gateGap, resolveKnobs(lv + 1).gate);
  gates.reserve(sp.rivals, CFG.boss.clashZ + 6);
  let picked = 0;
  let mults = 0;
  gates.onSchedule = (a, b, clear) => { if (clear) obstacles.offer(a, b); pickups.offer(a, b); };
  gates.onResolve = (r) => crowd.setCount(r.after);
  pickups.onCoin = (_x, _z, n) => { picked += n; };
  pickups.onMult = () => { mults++; crowd.setCount(crowd.count * 2); };
  crowd.add(sp.start);

  let d = 0, t = 0, broke = 0;
  boss.onBreak = () => { broke++; };
  /*
   * ★**壁で止まるボス戦を sim にも入れる**（2026-08-28）。
   * `Game` は `boss.holding` のあいだ `distance` を凍らせる。
   * ここで同じことをしないと、**sim だけボスの前を素通りして**
   * 実機と違う結果を測ることになる（`- [!]` に何度も出ている「sim と実機で違う値」の型）
   */
  let hung = false;
  let openCleared = false;
  while (d < sp.length) {
    t += DT;
    // ★広場の入口で、打ち止めより先に作られた宙ぶらりんのゲートを引き上げる（`Game` と同じ）
    if (bossAt !== null && !openCleared && d - bossAt >= -CFG.boss.open.from) {
      openCleared = true;
      gates.clearUnresolved();
    }
    if (!boss.holding) d += CFG.runSpeed * obstacles.speedScale * DT;
    // ★止まったまま決着しないと本番はゲームが固まる。**必ず終わることを検査する**
    if (t > 400) { hung = true; break; }
    // ボスの帯だけ別の操作に切り替えられるようにする（位置取りの効き目を測るため）
    // ★`sp.bossAt` は**存在しないプロパティ**だった（2026-08-27 修正）。
    // undefined との差は NaN で比較が常に false ＝ **`bossDrive` が一度も使われていなかった**
    // （＝「ボスの帯だけ操作を変える」の比較は今まで測れていない）。ボスの位置は `rivals[].at`
    const inBand = sp.rivals.some((r) => Math.abs(d - r.at) <= CFG.boss.clashZ);
    let x = inBand && bossDrive ? bossDrive(t) : drive(t);
    if (greedy && !inBand) {
      const list = (pickups as unknown as { coins: { at: number; x: number; taken: number }[] }).coins;
      let best = Infinity, bx = 0;
      for (const c of list) {
        const ahead = c.at - d;
        if (c.taken || ahead < 0 || ahead > 14 || ahead >= best) continue;
        best = ahead; bx = c.x;
      }
      const ms = (pickups as unknown as { mults: { at: number; x: number }[] }).mults;
      for (const mu of ms) {
        const ahead = mu.at - d;
        // ×2 は印紙より価値が高いので、多少遠くても優先する
        if (ahead < 0 || ahead > 20 || ahead * 0.4 >= best) continue;
        best = ahead * 0.4; bx = mu.x;
      }
      if (best < Infinity) x = bx;
    }
    gates.update(DT, d, x, crowd.count, lateralHalfWidth(crowd.visualRadiusX));
    obstacles.update(DT, d, crowd, x);
    pickups.update(DT, d, crowd, x);
    boss.update(DT, d, crowd, x);
    // ボス戦中は社員を止める（`Game` と同じ扱い。止めないと輪を張ったまま削り続ける）
    crowd.update(DT, x);
    if (boss.lost) break;
    // ★**広場がゴール**（2026-09-06）。ボス回は倒した時点で走行が終わる（`length` まで走らない）
    if (bossAt !== null && boss.broken) break;
  }
  // ゴール時点で決着していないゲートが残っていないか（置き去りゲートの回帰テスト）
  const ghosts = ((gates as any).rows as { resolved: boolean }[]).filter((r) => !r.resolved).length;
  return { count: crowd.count, seconds: t, broke, ghosts, picked, mults, hung, lost: boss.lost };
}

console.log('\n=== 5本の難易度カーブ（§9）===');
console.log('§9 の想定ゴール人数: Lv1=60 / Lv2=120 / Lv3=250 / Lv4=400 / Lv5=500+');
const drives: [string, (t: number) => number][] = [
  ['中央固定', () => 0],
  ['左右に振る', (t) => Math.sin(t * 0.9) * 3.4],
  ['速く振る', (t) => Math.sin(t * 2.1) * 3.9],
];
for (let lv = 0; lv < CFG.levels.length; lv++) {
  const sp = CFG.levels[lv];
  console.log(
    `\nLv${lv + 1}  ${sp.length}m / 開始${sp.start}人 / 障害物[${sp.obstacles.join(',') || 'なし'}]` +
    ` / 社員${sp.rivals.some((r) => 'kind' in r) ? 'あり' : 'なし'} / ゲート型 tier${sp.gateTier}`,
  );
  for (const [name, fn] of drives) {
    const runs = Array.from({ length: 7 }, () => level(lv, fn));
    const counts = runs.map((r) => r.count).sort((a, b) => a - b);
    const reached = counts.map((n) => hearing(n).reached);
    const mid = counts[Math.floor(counts.length / 2)];
    console.log(
      `  ${name.padEnd(6)} ${runs[0].seconds.toFixed(0)}秒 / 中央値 ${String(mid).padStart(5)}人` +
      ` / 人数 ${counts.join(', ')}`,
    );
    console.log(`         → 到達段 ${reached.join(', ')}`);
  }
}


// ================= 反対派の一団（§4-F / §14-B-1）=================
console.log('\n=== 一団：位置取りの効き目（帯の中だけ操作を変える）===');
for (let lv = 0; lv < CFG.levels.length; lv++) {
  const sp = CFG.levels[lv];
  // ★`length` を `number` で見る（2026-09-08 検品）。全20レベルに一団が入って空配列の型が消え、
  // `1 | 2` と `0` の比較になって `typecheck:tools` が落ちた。**一団ゼロに戻せる形は残す**
  if ((sp.rivals.length as number) === 0) { console.log(`  Lv${lv + 1}  一団なし`); continue; }
  console.log(
    `  Lv${lv + 1}  ${sp.rivals.map((r) => `${r.hp}人@${r.at}m`).join(' / ')}` +
    ` （半幅${CFG.boss.halfW} / 加勢 ×${CFG.boss.joinRatio}）`,
  );
  const lines: [string, (t: number) => number][] = [
    ['正面から突っ込む', () => 0],
    ['端に寄せて流す', () => 4.6],
  ];
  const mid = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  for (const [name, bd] of lines) {
    const runs = Array.from({ length: 12 }, () => level(lv, (t) => Math.sin(t * 0.9) * 3.4, bd));
    console.log(
      `    ${name.padEnd(9)} 突破 ${mid(runs.map((r) => r.broke))}/${sp.rivals.length}` +
      ` / ゴール中央値 ${mid(runs.map((r) => r.count))}人`,
    );
  }
}

// ================= 置き去りゲート（2026-08-22 の実機バグ）=================
/*
 * ★★**「ゴールした回」だけを数える**（2026-09-11）。
 *
 * 9/8 の検品が「12レベルで各2件の置き去り」と報告して `exit 1` になっていたが、
 * ★**ゲートは壊れていなかった。** 数えていたのは**道中で全滅して途中で `break` した回**で、
 * その瞬間まだ前方に飛んでいたゲート2枚が「置き去り」に計上されていた。
 * 実測（20回を「ゴールした/負けた」で分けた）: **ゴールした回の置き去りは全20レベル 0件**。
 *
 * この検査の目的は「**通らないゲートを置き去りにしていないか**」＝ 打ち止め（`stopAt`）と
 * `clearUnresolved()` の回帰テストなので、**走り切っていない回は対象外**が正しい。
 * ★**検査が空振りする穴も塞ぐ**: 全滅ばかりのレベルはゴール回が 0 になりうるので、
 * **到達回数を併記し、0回なら「合格」ではなく「測れず」と出す**
 */
console.log('\n=== ゴール時点で残っている未決着ゲート（ゴールまで走り切った回だけ）===');
{
  let worst = 0;
  let blind = 0;
  for (let lv = 0; lv < CFG.levels.length; lv++) {
    let g = 0;
    let reached = 0;
    for (let i = 0; i < 20; i++) {
      const r = level(lv, (t) => Math.sin(t * 0.9) * 3.4);
      if (r.lost || r.hung) continue;
      reached++;
      g = Math.max(g, r.ghosts);
    }
    worst = Math.max(worst, g);
    if (reached === 0) blind++;
    console.log(`  Lv${lv + 1}: ${reached === 0 ? '測れず（20回すべて全滅）' : `${g}（ゴール ${reached}/20回）`}`);
  }
  if (worst > 0) ng++;
  if (blind > 0) console.log(`  注意: ${blind}レベルはゴールした回が1度も無く、この検査が空振りしています`);
  console.log(worst === 0 ? '  OK: 置き去りなし' : '  NG: 置き去りゲートが残る');
}


// ================= 拾い物（§14-B）=================
console.log('\n=== 印紙と ×2 の札（横へ動く理由が実際に働いているか）===');
for (let lv = 0; lv < CFG.levels.length; lv++) {
  const mid = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const still = Array.from({ length: 9 }, () => level(lv, () => 0));
  // 弧をなぞる操作。周期を弧の間隔に近づけて「外へ出て戻る」を繰り返す
  const chase = Array.from({ length: 9 }, () => level(lv, () => 0, undefined, true));
  const wave = Array.from({ length: 9 }, () => level(lv, (t) => Math.sin(t * 0.9) * 3.4));
  console.log(
    `  Lv${lv + 1}  中央固定 ${String(mid(still.map((r) => r.picked))).padStart(3)}枚` +
    ` / 左右に振る ${String(mid(wave.map((r) => r.picked))).padStart(3)}枚` +
    ` / 狙って取る ${String(mid(chase.map((r) => r.picked))).padStart(3)}枚` +
    ` / ×2 中央${mid(still.map((r) => r.mults))} 追う${mid(chase.map((r) => r.mults))}`,
  );
}

// ================= 失敗不可能レベル（§9 Lv1）=================
/*
 * ★**`minCount` は「ゲートが人数をここまでしか減らさない」という約束**（§9 Lv1）。
 * ★**一団に負けた回を混ぜない**（2026-09-11・置き去りゲートと同じ型の誤検出）。
 * 9/8 の検品の `Lv2 (minCount 3): 最小 1人 NG` は、**ゲートではなく一団で全滅した回**だった。
 * ただし「**Lv2 が全滅しうる**」こと自体は遊びの問題なので、**別の欄として毎回出す**
 * （黙って除外すると、除外したこと自体が見えなくなる）。
 * ★**`process.exit(1)` はここでしない**（2026-09-11）。9/8 はここで落ちたせいで、
 * **この下の「ゲームオーバー率」が一度も測れなかった**。NG は `bad` に貯めて最後にまとめて落とす
 */
console.log('\n=== minCount のレベルが 0人 で終わらないか（ゴールした回だけ）===');
{
  for (let lv = 0; lv < CFG.levels.length; lv++) {
    const sp = CFG.levels[lv];
    if (sp.minCount <= 0) continue;
    let worst = Infinity;
    let reached = 0;
    let lost = 0;
    for (const fn of [() => 0, (t: number) => Math.sin(t * 0.9) * 3.4, (t: number) => Math.sin(t * 2.6) * 4.5]) {
      for (let i = 0; i < 25; i++) {
        const r = level(lv, fn);
        if (r.lost || r.hung) { lost++; continue; }
        reached++;
        worst = Math.min(worst, r.count);
      }
    }
    const ok = reached > 0 && worst >= sp.minCount;
    if (!ok) ng++;
    console.log(
      `  Lv${lv + 1} (minCount ${sp.minCount}): ${reached}回の最小 ${reached === 0 ? '—' : `${worst}人`} ${ok ? 'OK' : 'NG'}`
      + (lost > 0 ? `  ★一団に負けて途中終了 ${lost}/75回（ゲートの約束とは別の問題）` : ''),
    );
  }
}

// ================= ゲームオーバー率（0人で打ち切り・2026-08-22）=================
console.log('\n=== 0人（ゲームオーバー）で終わる割合 ===');
for (let lv = 0; lv < CFG.levels.length; lv++) {
  const drives: [string, (t: number) => number][] = [
    ['中央固定', () => 0],
    ['左右に振る', (t) => Math.sin(t * 0.9) * 3.4],
    ['速く振る', (t) => Math.sin(t * 2.1) * 3.9],
  ];
  const out: string[] = [];
  for (const [name, fn] of drives) {
    const runs = Array.from({ length: 40 }, () => level(lv, fn));
    const dead = runs.filter((r) => r.count <= 0).length;
    out.push(`${name} ${dead}/40`);
  }
  console.log(`  Lv${lv + 1}  ${out.join(' / ')}`);
}

/* =====================================================================
 * ★★**壁で止まるボス戦が必ず決着するか**（2026-08-28 新設）
 *
 * 止まったまま決着しないと**ゲームが固まる**。これが今回の実装のいちばん危険な穴なので、
 * 全20レベル × 3通りの操作で「**必ず 突破 か 敗北 のどちらかで終わる**」ことを検査する。
 * ================================================================== */
{
  console.log('');
  console.log('=== 壁で止まるボス戦: 必ず決着するか ===');
  let hang = 0, checked = 0;
  const rows: string[] = [];
  for (let lv = 0; lv < CFG.levels.length; lv++) {
    const out: string[] = [];
    for (const [label, dr] of drives) {
      const r = level(lv, dr);
      checked++;
      if (r.hung) { hang++; out.push(`${label}:★固まった`); continue; }
      out.push(`${label}:${r.lost ? '敗北' : r.broke > 0 ? `突破${r.broke}` : '不戦'}`);
    }
    rows.push(`  Lv${String(lv + 1).padStart(2)}  ${out.join(' / ')}`);
  }
  for (const r of rows) console.log(r);
  console.log(`固まった走行: ${hang} / ${checked} ${hang === 0 ? 'ok' : 'NG'}`);
}

/*
 * ★**最後にまとめて落とす。** 途中で `process.exit(1)` しない理由は `ng` の宣言のコメント。
 * `bad` は段の境界（上で刷り済み）、`ng` は置き去りゲートと minCount
 */
console.log(`
=== 判定のまとめ ===`);
console.log(`  段の境界の NG: ${bad} / 置き去り・minCount の NG: ${ng}`);
if (bad + ng > 0) process.exit(1);

