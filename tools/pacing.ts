import './dom-shim';
import { initPhysics } from '../src/core/Physics';
import { CFG, resolveKnobs, lateralHalfWidth } from '../src/config';
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
 * **ペーシングの計測**（PROGRESS §15）。
 *
 * 「気持ちよさ」そのものは測れないが、**「多すぎる／少なすぎる」は測れる**。
 * 本人から「何かが足りないのではなく多すぎるのでは」と言われて作った道具で、
 * 削った結果が良くなったのかを**感覚ではなく数字で**確かめるために使う。
 *
 * 出す数字は4つ:
 *  1. **語彙の数** — そのレベルで何種類のものが出るか。**本家は3〜4種類**
 *  2. **判断／分** — 選択を要求される回数。
 *     ★2026-08-24 に**社員を判断に含めた**（外部レビューの指摘・正しい）。
 *     「逃げるしかない」は選択が無いという意味ではない —— **右へ逃げるか左へ逃げるか、
 *     いつ振り切るか**は判断そのもの。障害物は「当たるか当たらないか」だけなので今も入れない
 *  3. **空白の割合** — 何も起きていない時間。**多すぎても少なすぎてもだめ**
 *  4. **イベント／分** — 密度そのもの
 *
 * **2 と 4 は別物**なのが肝。密度が高くても判断が無ければ「忙しいだけ」になり、
 * 判断だけ多くて密度が無ければ「間延び」する。
 */
/**
 * **乱数の種**（2026-08-26 追加。検品 8/25 の `- [!]` への対応）。
 *
 * 種が無いあいだ、コードを1行も変えずに7回回すと **Lv3 の空白が 18〜32% と14ポイント振れた**。
 * 目安帯が 15〜35%（幅20）なので、**測定の揺れが合否帯の7割を占めていた**。
 * これでは「坂を入れて良くなったか」を前後で比べられない。
 *
 * `tools/skill.ts:42` と同じ mulberry32。**走行 i は必ず種 i で回す**ので、
 * 前の版と後の版を同じ種の集合で比べられる（対応のある比較）。
 */
let seed = 1;
Math.random = (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** 種の集合そのものを変えて測り直すための下駄。`SEED_BASE=7 npm run sim:pacing` */
const SEED_BASE = Number(process.env.SEED_BASE ?? 1);
const setSeed = (run: number): void => {
  seed = (SEED_BASE * 1000 + run) | 0;
  // ★**空回しを入れる。** mulberry32 は隣り合う種の1発目が強く相関するので、
  // 種 0..11 をそのまま使うと**12走行の頭が全部そっくりになる**（＝ばらつきが人工的に消え、
  // 中央値が偏る）。実際、空回し無しでは Lv3 の空白が 8% と目安帯 15〜35% を大きく外した
  for (let i = 0; i < 16; i++) Math.random();
};

/**
 * 走行数。**種を固定しても標本数の問題は消えない。**
 * 6本では中央値が1本の外れ値で動くので 12 にした（種つきなので再現はする）。
 * ★何本が適切かは測り方の設計なので、変えるときは `RUNS=24 npm run sim:pacing` で確かめてから
 */
const RUNS = Number(process.env.RUNS ?? 12);

const DT = 1 / 60;
/** これ以内に続いた印紙は同じ弧とみなす（秒） */
const ARC_MERGE = 0.45;

interface Tally {
  /** ★実測の走行秒数。坂が入ると `length / runSpeed` では出せない */
  secs: number;
  vocab: Set<string>;
  /** `until` があるものは**点ではなく区間**（印紙の弧のように数秒続くもの） */
  events: { at: number; kind: string; decision: boolean; until?: number }[];
}

function run(lv: number, drive: (t: number) => number): Tally {
  const sp = CFG.levels[lv];
  const crowd = new Crowd();
  const gates = new Gates(sp.start, sp.gateTier, sp.gateGap, resolveKnobs(lv + 1).gate);
  const obstacles = new ObstacleField();
  const boss = new Boss();
  const pickups = new Pickups();
  gates.reset(sp.start, sp.gateTier, sp.length - CFG.gate.tailClear, sp.minCount, sp.gateGap, resolveKnobs(lv + 1).gate);
  obstacles.reset(sp.obstacles, sp.obstacleFrom, sp.obstacleChance, resolveKnobs(lv + 1).obstacle);
  boss.reset(sp.rivals, (lv + 1) % 5 === 0);
  gates.reserve(sp.rivals, CFG.boss.clashZ + 6);
  crowd.add(sp.start);

  const t: Tally = { secs: 0, vocab: new Set(), events: [] };
  let d = 0;
  let time = 0;

  gates.onSchedule = (a, b, clear) => { if (clear) obstacles.offer(a, b); pickups.offer(a, b); };
  gates.onResolve = (r) => {
    crowd.setCount(r.after);
    t.vocab.add('gate');
    // **選択と言えるのは「選択肢の結果が違う」ときだけ。** 同じ結果の2枚は判断ではない
    t.events.push({ at: time, kind: 'gate', decision: true });
  };
  /*
   * ★**「届いた」で数える**（2026-08-26）。以前は `onHit`（減ったとき）で数えていたので、
   * **動く床のように1人も減らさないギミックが語彙にもイベントにも出てこなかった。**
   * 坂と修正テープを足すところだったので、先にここを直した。
   *
   * ★**坂と修正テープは「判断」に数える。** 速度と操作の効きが変わるので、
   * 「どこで曲がるか」を選び直させられる ＝ 社員を判断に数えたのと同じ理屈（§15）。
   * 動く床も同じ性質だが、判断に入れるかは据え置き（従来の数字と比べられなくなるため）
   */
  obstacles.onReach = (_x, kind) => {
    t.vocab.add(kind);
    // ★動く床は「押されるのを読んで対処する」ので判断に数える（旧「坂」と同じ扱い）
    t.events.push({ at: time, kind, decision: kind === 'belt' || kind === 'whiteout' });
  };
  boss.onClash = () => {
    if (!t.vocab.has('rival')) t.events.push({ at: time, kind: 'rival', decision: true });
    t.vocab.add('rival');
  };
  /*
   * ★**2026-08-24 まで印紙を1回もイベントに数えていなかった**（vocab に入れるだけだった）。
   * 弧は「ゲート間の死んだ時間に横へ動く理由を置く」ためのものなので、
   * **数えていなかったぶん、それまでのイベント/分と空白の割合は過小評価だった。**
   *
   * ただし**1枚1イベントにしてはいけない**。1本の弧に十数枚あるので数字が爆発して意味を失う。
   * 弧は**数秒続く区間**なので、`ARC_MERGE` 秒以内に続いた拾いは1本の弧としてまとめ、
   * `until` を持つ区間イベントにする（点イベントの前後1.2秒とは扱いを変える）
   */
  pickups.onCoin = () => {
    t.vocab.add('coin');
    const last = t.events[t.events.length - 1];
    if (last && last.kind === 'coinArc' && time - (last.until ?? last.at) <= ARC_MERGE) {
      last.until = time;
      return;
    }
    t.events.push({ at: time, kind: 'coinArc', decision: false, until: time });
  };

  while (d < sp.length) {
    time += DT;
    /*
     * ★★**殴り合いで止まっている時間を数える**（2026-09-11・9/8 の検品の `- [!]` #7）。
     *
     * ここは `boss.holding` を見ずに**毎フレーム距離を進めていた**ので、
     * **一団の前で止まっている秒数が1秒も表に入っていなかった**。
     * `sim:phase4` は 2026-08-28 に同じ穴を塞いでいる（＝ 前例がリポジトリ内にあった）。
     * ★**9/7 に道中の一団が全20レベルに戻ったので、誤差はボス回4本から全20レベルに広がった。**
     *
     * ★**この日から、表の「尺（秒）」「判断/分」「空白%」は過去の表と地続きではない。**
     * 止まっている時間は**判断が1つも起きない時間**なので、
     * 空白の割合は上がり、判断/分は下がる（＝ いままでの数字は良く出すぎていた）
     */
    if (!boss.holding) d += CFG.runSpeed * obstacles.speedScale * DT;
    const x = drive(time);
    gates.update(DT, d, x, crowd.count, lateralHalfWidth(crowd.visualRadiusX));
    obstacles.update(DT, d, crowd, x);
    pickups.update(DT, d, crowd, x);
    boss.update(DT, d, crowd, x);
    /*
     * ★**2026-09-12: 社員専用の数え方を消した。**
     * 社員は `Boss` の spot（`kind: 'syain'`）になったので、
     * 上の `'rival'` と同じ経路で**語彙にも判断にも数えられている**。
     * ★**ここでも数えると二重になる**（同じ判断が2か所にある）。
     * ただし ★**語彙の数え方が 9/11 以前と地続きでなくなる** ——
     * 以前は「集団」と「社員」で 2 語彙、今はどちらも `rival` なので 1 語彙。
     * 見た目は 2 つのままなので、**実際に覚えることが 1 つ減った**のが正しい
     */
    crowd.update(DT, x);
  }
  t.secs = time;
  return t;
}

/**
 * 何も起きていない時間の割合。
 * **点イベントは前後 `pad` 秒**を「起きている」とみなし、
 * **区間イベント（印紙の弧）はその区間そのもの＋前後0.3秒**を使う。
 * ★弧を点として扱うと、数秒続く行為が1.2秒の点に潰れて実感と数字がずれる（外部レビューの指摘・正しい）
 */
function idleRatio(t: Tally, total: number, pad = 1.2): number {
  if (t.events.length === 0) return 1;
  const spans = t.events
    .map((e) => (e.until !== undefined
      ? [Math.max(0, e.at - 0.3), Math.min(total, e.until + 0.3)] as const
      : [Math.max(0, e.at - pad), Math.min(total, e.at + pad)] as const))
    .sort((a, b) => a[0] - b[0]);
  let busy = 0;
  let cur = spans[0][0];
  let end = spans[0][1];
  for (const [s, e] of spans.slice(1)) {
    if (s > end) { busy += end - cur; cur = s; end = e; } else { end = Math.max(end, e); }
  }
  busy += end - cur;
  return Math.max(0, 1 - busy / total);
}

console.log('=== ペーシング計測（§15）===');
console.log('目安: 語彙 上限7 / 判断 12〜20回・分 / 空白 15〜35%');
console.log('★イベント/分は「判断系」と「拾い物」に分けて出す。合算の目安（旧25〜45）は使わない —');
console.log('  ノーリスクの印紙と、当たれば減る障害物を同じ1イベントとして足すと、');
console.log('  **時間が埋まっているだけ**の状態を「密度が足りている」と誤読する（実際に誤読した）。');
console.log('（本家 Count Control Legends の語彙は 3〜4。密度は高いが種類は少ない）\n');

const drives: [string, (t: number) => number][] = [
  ['中央固定', () => 0],
  ['左右に振る', (t) => Math.sin(t * 0.9) * 3.4],
];

for (let lv = 0; lv < CFG.levels.length; lv++) {
  const sp = CFG.levels[lv];
  const rows: string[] = [];
  /** 見出しに出す走行秒。**坂が入ると length / runSpeed では出せない**ので実測を使う */
  let shownSecs = sp.length / CFG.runSpeed;
  const vocabAll = new Set<string>();
  for (const [name, fn] of drives) {
    const runs = Array.from({ length: RUNS }, (_, i) => { setSeed(i); return run(lv, fn); });
    for (const r of runs) for (const v of r.vocab) vocabAll.add(v);
    const mid = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    // ★秒数も走行ごとに違う（坂）。走行ごとにその走行の秒で割る
    shownSecs = mid(runs.map((r) => r.secs));
    // ★「拾い物（印紙の弧）」と「それ以外」を分けて出す。合算すると質の違いが消える
    const arcs = mid(runs.map((r) => (r.events.filter((e) => e.kind === 'coinArc').length / r.secs) * 60));
    const real = mid(runs.map((r) => (r.events.filter((e) => e.kind !== 'coinArc').length / r.secs) * 60));
    const dec = mid(runs.map((r) => (r.events.filter((e) => e.decision).length / r.secs) * 60));
    const idle = mid(runs.map((r) => idleRatio(r, r.secs) * 100));
    rows.push(
      `    ${name.padEnd(6)} 判断 ${dec.toFixed(0).padStart(2)}回/分` +
      ` / 判断系ｲﾍﾞﾝﾄ ${real.toFixed(0).padStart(2)}回/分` +
      ` / 拾い物 ${arcs.toFixed(0).padStart(2)}回/分 / 空白 ${idle.toFixed(0).padStart(2)}%`,
    );
  }
  console.log(
    `Lv${lv + 1}  ${sp.length}m/${shownSecs.toFixed(0)}秒  **語彙 ${vocabAll.size}**` +
    `  [${[...vocabAll].join(' ')}]`,
  );
  for (const r of rows) console.log(r);
}

