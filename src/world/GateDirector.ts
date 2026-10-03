import { CFG, MATH_ZONES, mathHelpSections, mathZone } from '../config';
import {
  applyOp, gridFor, usableByFamily, type GateChoice, type MathOp,
} from '../entities/gateOps';

/**
 * ゲートの中身を決める（PROGRESS §4-C の「ゲートの型」表 ＋ §3 のタイムテーブル）。
 *
 * Phase 2 では距離ベースの手続き生成。levels.json（§7）に移すのは Phase 7 で、
 * CrazyGames Basic Launch（Phase 6.5）の実データを見てからにする。
 * **`next()` が「中身」と「次までの距離」を一緒に返すのは、この差し替えを見越した形**
 * （levels.json 版に置き換えても Gates 側は触らずに済む）。
 *
 * **`projected` を持っている理由**: 「分岐点またぎ」は *手持ちの人数* で正解が変わる型なので、
 * 生成時点の実人数だけ見ると、まだ通過していないゲートのぶんだけ数値がズレる。
 * 上手に選んだ場合の見込み人数を進めておき、ゲートが解決するたびに実測へ寄せ直す。
 */

type Kind = 'plain' | 'smallLoss' | 'crossover' | 'trap' | 'bothLoss' | 'gamble' | 'modTrap';

export interface GateRow {
  choices: GateChoice[];
  /** このゲートから次のゲートまでの距離 */
  gapAfter: number;
}

/** ★**2枚の組の顔**（左右は問わない）。「1走行で同じ組を出さない」の鍵 */
function pairKey(a: GateChoice, b: GateChoice): string {
  return [`${a.op}:${a.v}`, `${b.op}:${b.v}`].sort().join('|');
}

/**
 * ★**レベルごとの「これまでの走行」の記憶**（2026-09-26）。**走行をまたいで持つ**（保存はしない）。
 *  - `use`: そのレベルで族が出た回数。1走行 9枚前後では札を全部出せないので、**出番の少なかった族を次の走行で先に出す**
 *  - `recent`: 直近 `RECENT_RUNS` 走行で出した組。**「もう一回」で同じ組から始まらない**ように避ける
 * ★**1回目の作り直しで、走行をまたぐと Lv7〜15 の1枚目が 500走行すべて同じ組だった**（`sim:variety`）。
 * 「新しい札を先に」を並び順の固定の鍵にしていたので、毎回同じ2族が頭に来ていた
 */
const LEVEL_MEM = new Map<number, { use: Map<MathOp, number>; recent: Set<string>[] }>();
const RECENT_RUNS = 3;
function levelMem(lv: number): { use: Map<MathOp, number>; recent: Set<string>[] } {
  let m = LEVEL_MEM.get(lv);
  if (!m) { m = { use: new Map(), recent: [] }; LEVEL_MEM.set(lv, m); }
  return m;
}

/**
 * ★★**そのレベルで出してよい札**（2026-09-26・本人「レベル5ごとに数式が必ず増えていく」）。
 * **説明書（`mathHelpSections`）に載せた札を、その区画まで全部積み上げる**。
 * `fresh` は**その区画で初めて載った札**で、走行の頭で優先して出す
 */
function mathPool(lv: number): { ops: MathOp[]; fresh: Set<MathOp> } {
  const zi = Math.max(0, MATH_ZONES.indexOf(mathZone(lv)));
  const help = mathHelpSections();
  const before = new Set(help.slice(0, zi).flatMap((h) => h.ops));
  const ops = [...new Set(help.slice(0, zi + 1).flatMap((h) => h.ops))];
  return { ops, fresh: new Set(ops.filter((op) => !before.has(op))) };
}

export class GateDirector {
  private index = 0;
  private projected: number;
  /** 「大博打」のように、直後の1枚まで込みで意味が決まる型のための予約 */
  private queued: GateRow[] = [];
  /** 出してよい型の解禁段階（§9 / CFG.levels の gateTier） */
  private tier: number;
  /**
   * ★**このステージで出す型の並び**（2026-08-23）。
   *
   * それまでは `pickKind` がゲートごとに重み付き乱数を引いていた。
   * その結果、**1回の走行で大博打(×5)が2回出ることも、核(crossover)が0回のこともあった**。
   *
   * 実測（同じ乱数3つ・毎ゲート最善を選ぶ完璧な操作）:
   *   Lv4 で登れた段が 5 / 8 / 8。**操作が同じなのに乱数だけで3段ちがう。**
   *   操作なしの Lv5 は 2 / 4 / 7 で5段の開き。
   * 腕前の効果（+1〜4段）と運の幅（3〜5段）が同じかそれ以上だった。
   * これでは上手くなった実感が出ない。
   *
   * だから**ステージの頭で並びを1本決めておく**。
   * 出る型の顔ぶれは毎回ほぼ同じになり、残る差はプレイヤーの選択だけになる。
   *
   * ★**数式は触らない。** `crossPoint` は「＋と×の損得がひっくり返る位置」に
   * 正しく置いている。加算を人数比にすると数学的に乗算と同じになり、
   * **損益分岐点を見極めるという腕前そのものが消える**（外部レビューの指摘・正しい）。
   */
  private plan: Kind[] = [];
  /** 献立をどこまで消費したか。**ゲート番号ではない**（特別な型は出せるまで消費しない） */
  private planPos = 0;
  /** 倍率の献立をどこまで配ったか（`MUL_CYCLE`） */
  private mulPos = 0;
  /** 間隔の献立をどこまで配ったか（`GAP_CYCLE`） */
  private gapPos = 0;
  /**
   * ゲート間隔の倍率（`LevelSpec.gateGap`）。**1 ＝ 従来どおり。**
   * 復習回だけ下げて密度を上げる（§11-7 ③）。**並びそのものは変えない** ——
   * `GAP_CYCLE` の「詰まる／空く」の交互は密度を変えても保ちたいので、掛け算にしてある
   */
  private gapScale = 1;

  /** `×m` の m を順に配る。**乱数で引かない**（理由は `MUL_CYCLE`） */
  private nextMul(): number {
    return MUL_CYCLE[this.mulPos++ % MUL_CYCLE.length];
  }

  /**
   * ★**数学ボケモードのレベル**（1 始まり）。`null` ＝ 四則演算のふつうのゲート。
   * ★**モードそのものではなくレベルを持つ**のは、区画（`MATH_ZONES`）を引くのに要るから
   */
  private mathLv: number | null = null;
  /** ★この走行で出した族の回数と、出した組（`buildMath`）。`reset` で空にする */
  private readonly runUse = new Map<MathOp, number>();
  private readonly runPairs = new Set<string>();

  constructor(startCount: number, tier: number, gapScale = 1, mathLv: number | null = null) {
    this.projected = startCount;
    this.tier = tier;
    this.gapScale = gapScale;
    this.mathLv = mathLv;
    this.plan = buildPlan(tier);
    this.planPos = 0;
    this.mulPos = 0;
    this.gapPos = 0;
  }

  /**
   * レベルの頭に戻す。**index を戻さないと §3 の固定の2枚が出ない** ＝
   * やり直すたびに「最初の10秒」が別物になる（リトライで実際にそうなっていた）
   */
  reset(startCount: number, tier: number, gapScale = 1, mathLv: number | null = null): void {
    // ★終わった走行の組を、そのレベルの「直近の走行」に積んでから空にする
    if (this.mathLv !== null && this.runPairs.size > 0) {
      const r = levelMem(this.mathLv).recent;
      r.push(new Set(this.runPairs));
      if (r.length > RECENT_RUNS) r.shift();
    }
    this.mathLv = mathLv;
    this.runUse.clear();
    this.runPairs.clear();
    this.index = 0;
    this.projected = startCount;
    this.tier = tier;
    this.gapScale = gapScale;
    this.queued.length = 0;
    this.plan = buildPlan(tier);
    this.planPos = 0;
    this.mulPos = 0;
    this.gapPos = 0;
  }

  /** ゲートが解決したら実測へ寄せ直す */
  sync(count: number): void {
    this.projected = count;
  }

  next(): GateRow {
    const queued = this.queued.shift();
    if (queued) {
      this.advance(queued.choices);
      return queued;
    }

    const i = this.index++;
    const n = Math.max(1, this.projected);
    const built = this.build(i, n);
    const row: GateRow = { choices: built.choices, gapAfter: built.gapAfter ?? this.gap() };
    shuffle(row.choices);
    this.advance(row.choices);
    return row;
  }

  /**
   * 次のゲートを作るための見込み人数を進める。
   *
   * **元は「一番良い選択肢を選んだ場合」で進めていたが、それは楽観が過ぎた。**
   * 実際のプレイヤーは外すので、ゲートが解決するころには見込みが実人数の何倍にもなっていて、
   * **大きい群衆向けに作られた `−A` が小さい群衆に当たって一撃で 0 人**になる
   * （本人所感「難易度が理不尽」の主因・2026-08-22）。
   * 良い選択と悪い選択の中間を採ると、ズレが目に見えて小さくなる。
   */
  private advance(choices: GateChoice[]): void {
    const n = Math.max(1, this.projected);
    const results = choices.map((c) => applyOp(n, c));
    const best = Math.max(...results);
    const worst = Math.min(...results);
    this.projected = Math.max(1, Math.round(worst + (best - worst) * 0.55));
  }

  /**
   * ★**ゲートの間隔も献立にする**（2026-08-24 / `GAMEPLAY.md` A-3）。
   *
   * ここは `gapMin(30) + rand * 14` だった。走行距離は固定なので、
   * **間隔が乱数 ＝ 1走行のゲート本数が乱数**になる（実測 Lv3 で 7〜9本）。
   * ゲートは人数を掛け算するので、**本数が2本ちがえば結果は4〜16倍ちがう。**
   * 型の顔ぶれを固定しても（A-1）、本数が乱数なら運の幅はそこで決まってしまう。
   *
   * 順に配れば合計距離が毎回同じになり、本数が揃う。
   * 平均は 37m（旧の乱数と同じ）に保ってあるので、**密度は変えていない。**
   * 並びは「詰まる／空く」が交互に来るように散らしてある（等間隔だと機械的に見える）。
   */
  private gap(): number {
    return GAP_CYCLE[this.gapPos++ % GAP_CYCLE.length] * this.gapScale;
  }

  private build(i: number, n: number): { choices: GateChoice[]; gapAfter?: number } {
    if (this.mathLv !== null) return this.buildMath(i, n);
    // §3 の最初の10秒。ここだけは固定する
    if (i === 0) return { choices: [{ op: 'add', v: 30 }, { op: 'add', v: 5 }] };   // 素直
    if (i === 1) return { choices: [{ op: 'add', v: 20 }, { op: 'sub', v: 10 }] };  // 小損

    // 味方がほぼ居ない状態で損の選択肢だけ出すと詰む。必ず増える型に落とす。
    // **tier0（Lv1〜2）は §9 の「失敗不可能」を守るため下限を上げる。**
    // smallLoss の損は max(5, n*0.25) なので、8人以下で出すと 0 人に落ちうる（実測で出た）
    const floor = this.tier === 0 ? 8 : 2;
    if (n <= floor) return { choices: [{ op: 'add', v: 20 }, { op: 'add', v: 8 }] };

    const g = CFG.gate;
    // 3枚組は選択肢が増えるぶん判断が重い。核（分岐点またぎ）を教えたあとから
    if (this.tier >= 2 && i >= g.tripleFrom && Math.random() < g.tripleChance) {
      const m = this.nextMul();
      return {
        choices: [
          { op: 'add', v: crossPoint(n, m, 0.8 + Math.random() * 0.5) },
          { op: 'mul', v: m },
          { op: 'sub', v: Math.max(5, Math.round(n * 0.4)) },
        ],
      };
    }

    switch (this.pickKind(n)) {
      // 核。`+A` と `×m` の損得が手持ちでひっくり返る位置に A を置く
      case 'crossover': {
        const m = this.nextMul();
        return { choices: [{ op: 'add', v: crossPoint(n, m, 0.75 + Math.random() * 0.7) }, { op: 'mul', v: m }] };
      }

      // 「掛け算は正義」の思い込みを刈る。手持ちが少ないと ×3 より +50 が勝つ（分岐点は25人）
      case 'trap':
        return { choices: [{ op: 'mul', v: 3 }, { op: 'add', v: 50 }] };

      // 大博打。**直後に必ず大きな損を置く**ので、このゲートは単体では判断できない（§4-C 初出 Lv14）
      case 'gamble': {
        // 後続の `−v` は **大博打を取る前の人数** から作る。取った後（n*5）から作ると、
        // 安全な側を選んだプレイヤーだけが 0 人に飛ぶ理不尽になる（実測で 0 人が出た）。
        // こう置くと「×5 を取ったなら −v、取らなかったなら ÷2」と**正解が前段の選択で変わる**。
        // ÷2 が常に残るので、どう転んでも全滅しない
        this.queued.push({
          choices: shuffled([
            { op: 'sub', v: loss(n, crossPoint(n, 2, 0.85 + Math.random() * 0.6)) },
            { op: 'div', v: 2 },
          ]),
          gapAfter: this.gap(),
        });
        // 直後の損とセットで1つの判断にしたいので、間隔を詰めて出す
        return {
          choices: [{ op: 'mul', v: 5 }, { op: 'add', v: crossPoint(n, 5, 0.3 + Math.random() * 0.35) }],
          gapAfter: CFG.gate.gapMin * 0.62,
        };
      }

      /*
       * **mod の罠（§4-C ★）。** `mod k` は何千人いても最大 k−1 人にしかならない。
       * 相手側には**必ず素直な `+A` を置く**。両方が罠だと理不尽になるし、
       * 「mod を避ければよい」と一度学べば以降はただの視認テストになる ＝ それでいい。
       * **人数が十分多いときにしか出さない**（少人数だと mod のほうが得になり、罠が成立しない）
       */
      case 'modTrap': {
        const k = MODS[Math.floor(Math.random() * MODS.length)];
        return { choices: [{ op: 'mod', v: k }, { op: 'add', v: near(n * 0.35) }] };
      }

      // 損失最小化。避けられない配置。
      // **v は必ず n の 0.5 倍をまたぐ範囲で振る** — 常に n*0.35 のような比で作ると
      // 「−A のほうが常に得」になって選択が消える（÷2 との分岐点は v = n/2）
      case 'bothLoss':
        return { choices: [{ op: 'sub', v: loss(n, crossPoint(n, 2, 0.64 + Math.random() * 0.84)) }, { op: 'div', v: 2 }] };

      case 'smallLoss':
        return { choices: [{ op: 'add', v: near(n * 0.5) }, { op: 'sub', v: loss(n, Math.max(5, Math.round(n * 0.25))) }] };

      default:
        return { choices: [{ op: 'add', v: near(n * 1.2) }, { op: 'add', v: Math.max(3, Math.round(n * 0.15)) }] };
    }
  }

  /**
   * ★★★**理系用モードのゲート**（2026-09-26 作り直し）。仕様は `MATHMODE.md`。
   *
   * > 本人「第2ステージで、全く同じセットの数式が3回か4回出てきた。つまんねって思った」
   * > 「Lv13 あたりでも Lv1・2 と同じ数式ばかり。レベルが上がっても何も増えていない」
   * > 「ゲームバランスは一旦無視して、とりあえずいろんな数式が出まくるって方針に」
   * > 「2枚の札が近いって条件も撤廃。3倍4倍の差があろうと、計算できる人が受けられる恩恵」
   *
   * ★**前の版が同じ札ばかりになっていた理由**（調べて分かったこと）:
   *  1. 人数の上限 99,999 を越える札を外していた → 人数が増えると `n!` `2ⁿ` `ₙC₂` などが全部消える
   *  2. 「2枚の結果が 0.5〜2倍」「増える幅 1.1〜1.5倍」に入る対しか作らなかった
   *     → 指数を細かく回せる `n^k` `(n^k)′` `∫xᵏ` だけが勝ち残る
   *  3. 最初の2枚は「1,000人を越えない札」だけに絞っていた → 1組に固定
   *  4. 1走行で何を出したか覚えていなかった → 同じ組が3〜4回
   *
   * ★**いまの作り方**:
   *  - 札の顔ぶれは**区画を積み上げる**（Lv11〜15 は Lv1〜15 の説明書に載った札ぜんぶ）
   *  - **この走行でまだ出ていない族** → **これまでの走行で出番の少なかった族**の順に2族選ぶ（同点は乱数）
   *  - ★**1枚目のゲートの片方は、その区画で新しく増えた札**（レベル5ごとに増えたことが必ず見える）
   *  - **直近3走行で出した組も避ける**（「もう一回」で同じ組から始まらない）
   *  - 指数などのつまみは**使える候補から無作為**（狙った人数へ寄せない）
   *  - **1走行で同じ組（2枚の顔）は二度と出さない**
   *  - ★**2枚は必ず別の族**（本人指定・前から変わらない）
   *  - 最初の2枚と、人がほとんど居ないとき（≦4人）だけ、**どちらか1枚は増える札**にする（ここで殺さない）
   */
  private buildMath(i: number, n: number): { choices: GateChoice[]; gapAfter?: number } {
    const lv = this.mathLv ?? 1;
    const { ops, fresh } = mathPool(lv);
    const mem = levelMem(lv);
    const all = usableByFamily(n, ops, gridFor);
    const needGrow = i < 2 || n <= 4;

    /** 族の並び順: この走行で出た回数 → そのレベルで出た回数 → 乱数 */
    const order = (fams: MathOp[]): MathOp[] => fams
      .map((op) => ({ op, k: [this.runUse.get(op) ?? 0, mem.use.get(op) ?? 0, Math.random()] }))
      .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2])
      .map((x) => x.op);

    const fams = [...all.keys()];
    const growFams = fams.filter((op) => (all.get(op) ?? []).some((x) => x.r > n));
    let firsts = order(needGrow ? growFams : fams);
    // ★1枚目のゲートは、新しく増えた札を片方に置く（置けるなら）
    if (i === 0) {
      const f = firsts.filter((op) => fresh.has(op));
      if (f.length) firsts = [...f, ...firsts.filter((op) => !fresh.has(op))];
    }
    const pickOf = (op: MathOp, grow: boolean): GateChoice[] => {
      const list = (all.get(op) ?? []).filter((x) => !grow || x.r > n).map((x) => x.c);
      shuffle(list);
      return list;
    };

    /*
     * 族の組を順に試し、まだ出していない組が作れたら決まり。
     * 1周目は「この走行」と「直近3走行」の両方で未出の組、2周目は「この走行」で未出の組
     */
    for (const avoidRecent of [true, false]) {
      for (const a of firsts) {
        for (const b of order(fams.filter((op) => op !== a))) {
          for (const ca of pickOf(a, needGrow)) {
            for (const cb of pickOf(b, false)) {
              // ★逃げ道への差し替え（`guardBothLoss`）のあとの顔で判定する。前で判定すると差し替えで同じ組に戻る
              const got = this.guardBothLoss(ops, n, [ca, cb]);
              if (got[0].op === got[1].op) continue;
              const key = pairKey(got[0], got[1]);
              if (this.runPairs.has(key)) continue;
              if (avoidRecent && mem.recent.some((r) => r.has(key))) continue;
              return { choices: this.remember(got) };
            }
          }
        }
      }
    }

    /*
     * ★**ここに来るのは、使える族が1つ以下か、組を出し尽くした回だけ**（ほぼ起きない）。
     * 同じ組でもいいので別の族の2枚を出す。それも無理なら増える2枚で逃がす
     */
    if (fams.length >= 2) {
      const [a, b] = order(fams);
      return { choices: this.remember([pickOf(a, false)[0], pickOf(b, false)[0]]) };
    }
    const k = PLAIN_K[Math.floor(Math.random() * PLAIN_K.length)];
    return { choices: this.remember([{ op: 'pow2', v: 0 }, { op: 'lcm', v: k }]) };
  }

  /** ★**この走行で出した族と組を覚える**（`buildMath` の「同じ組は二度と出さない」の本体） */
  private remember(choices: GateChoice[]): GateChoice[] {
    this.runPairs.add(pairKey(choices[0], choices[1]));
    for (const c of choices) {
      const op = c.op as MathOp;
      this.runUse.set(op, (this.runUse.get(op) ?? 0) + 1);
      const use = levelMem(this.mathLv ?? 1).use;
      use.set(op, (use.get(op) ?? 0) + 1);
    }
    return choices;
  }

  /**
   * ★**2枚とも減る対のときだけ、落ち幅に蓋をする。**
   *
   * ★**片方が増える対なら、もう片方はどれだけ強い減らし方でもよい** ――
   * それは**選ばなければいい選択肢**だから。危ないのは**2枚とも減って逃げ場が無い対**。
   * 四則演算の `bothLoss`（`−A` と `÷2`）が**どちらも底の見える2枚**なのと同じ考え方。
   */
  private guardBothLoss(ops: readonly MathOp[], n: number, choices: GateChoice[]): GateChoice[] {
    const floor = n * CFG.gate.mathFaceFloor;
    if (choices.some((c) => applyOp(n, c) >= n)) return choices;      // 逃げ道があるなら自由
    if (choices.every((c) => applyOp(n, c) >= floor)) return choices; // どちらも底が見えるなら自由

    let worst = 0;
    for (let i = 1; i < choices.length; i++) {
      if (applyOp(n, choices[i]) < applyOp(n, choices[worst])) worst = i;
    }
    const keep = choices[1 - worst];
    /*
     * ★**逃げ道（増える側）に差し替える。** ★**差し替え先も必ず別の族**
     * —— ここを `pow` 固定にしたら `pow vs pow` が 73.7% になったことがある（9/21 の失敗）
     */
    const up = Math.round(n * (1.2 + Math.random() * 0.8));
    const all = usableByFamily(n, ops, gridFor);
    const cands: { c: GateChoice; r: number }[] = [];
    for (const [op, list] of all) {
      if (op === keep.op) continue;
      for (const x of list) if (x.r > n) cands.push(x);
    }
    if (cands.length === 0) return choices;
    // 狙った人数にいちばん近いものを選ぶ
    cands.sort((a, b) => Math.abs(a.r - up) - Math.abs(b.r - up));
    choices[worst] = cands[0].c;
    return choices;
  }

  /**
   * §9 の難易度カーブ。**レベル(tier)で型が解禁され、そのうえで人数(≒進行度)でも絞る。**
   * 2段構えにする理由: tier だけだと Lv5 の序盤に少人数で両損が出て理不尽になり、
   * 人数だけだと Lv1 でいきなり核が出て何も教えられない。
   */
  /**
   * 何番目のゲートで何の型を出すか。**献立から順に取る。**
   *
   * ただし献立をそのまま通すと理不尽になる場合がある（少人数での両損など）ので、
   * **人数による安全装置は残して、通らない型は代わりの型へ送る。**
   * 条件は今までと同じ（ここを変えると難易度の話が混ざって、何が効いたか分からなくなる）。
   */
  private pickKind(n: number): Kind {
    const t = this.tier;
    /** @param count 人数。省略すると今の人数。**「人数が育てば出せるか」を試すために差し替える** */
    const ok = (k: Kind, count: number = n): boolean => {
      switch (k) {
        // ×3 と +50 の分岐点は 25 人。**その前後をまたぐ帯でだけ出す**ので
        // 「+50 が always 正解」と覚えられない
        case 'trap': return t >= 2 && count <= 45;
        case 'bothLoss': return t >= 2 && count >= 30;   // 少人数で両損は理不尽なだけ
        case 'gamble': return t >= 3 && count >= 60;     // 直後の損を吸える体力がついてから
        // **mod は人数が多いときだけ。** 少人数だと mod のほうが得になって罠が成立しない
        case 'modTrap': return t >= 4 && count >= 260;
        case 'crossover': return t >= 1;             // 核（Lv3 初出）
        default: return true;
      }
    };
    /*
     * ★**献立は「番号で引く表」ではなく「消費する待ち行列」**（2026-08-24 / `GAMEPLAY.md` A-1・A-3）。
     *
     * 経緯を2段で書く。どちらも「献立にしたのに顔ぶれが揃わない」の原因だった。
     *
     * **① 添字が2枚ずれていた。**
     * ここは `this.index - 1`（＝ `build` に渡る `i`）で `plan` を引いていた。
     * だが `build` は `i===0/1`（§3 の最初の10秒の固定2枚）を**返す前に return** していて、
     * その2枚では `pickKind` が呼ばれない。つまり `plan[0]` と `plan[1]` は
     * **一度も読まれない死に札**だった。悪いことに `buildPlan` は「先頭は固定」として
     * 死んでいた 0 番を守り、可動枠を死んだ 1 番にも配っていたので、
     * **毎ステージ1枚が無作為に消えていた**（検品の実測400走行で顔ぶれがばらついた原因）。
     *
     * **② 位置を固定しても、発火条件が人数依存なら固定になっていない。**
     * 大博打は `n >= 60` を満たさないと核へ差し替わって**消えていた**（Lv5 で 42% の走行のみ）。
     * 添字を直して 62% まで上がったが、まだ「出る回と出ない回」がある
     * ＝ ×5 が出るかどうかで結果が何倍も変わるので、**運の幅がそこで決まってしまう**。
     *
     * **だから番号で引くのをやめた。** 献立を先頭から消費し、
     * **出せない特別な型（大博打・罠）は消費せず、出せる番が来るまで待たせる。**
     * 普通の型（核・小損・素直・両損）は今までどおり代役に差し替えて消費する。
     * 「位置を1枚ずらす」ほうが「一度も出ない」よりはるかに幅が小さい。
     */
    const want = this.planPos < this.plan.length
      ? this.plan[this.planPos]
      : (this.planPos % 2 === 0 ? 'crossover' : 'smallLoss');
    if (ok(want)) {
      this.planPos++;
      return want;
    }
    /*
     * ★**待ってよいのは「人数が育てば出せる」型だけ**（2026-08-24・入れた直後に踏んだ穴）。
     *
     * 最初は PINNED を全部待たせた。すると `trap`（`n <= 45` ＝**人数が少ないときの型**）で
     * **行列が永久に詰まった。** 人数は増える一方なので、待つほど条件から遠ざかる。
     * その結果 Lv4 は献立の残り全部が代役（核）に化けて、無操作でも 2838人 まで伸びた。
     *
     * だから**下限で止まっている型だけ待たせる。** 上限を追い越した型は諦めて消費する。
     */
    /*
     * ★**「待てるか」を表で持つのをやめた**（2026-08-27 修正）。
     *
     * 前は `WAIT_UNTIL = { gamble: 60, modTrap: 260 }` という**手写しの表**だった。
     * `ok()` の人数条件だけを写していて **tier 条件が抜けていた**ので、
     * tier の足りない型が `PLANS` に1枚入った瞬間に
     * **待ち行列が永久に詰まり、以降の献立が全部代役に化ける**（8/24 に `trap` で実際に踏んだ穴）。
     * `GAMEPLAY.md` §10 でレベルを20本・100本へ広げると決めたので、献立が増えれば必ず踏む。
     *
     * だから表をやめ、**`ok()` そのものに「人数を最大にしても通らないか」を聞く。**
     * 通らないなら、待っても永久に出ないので諦めて消費する。
     *
     * 今の `CFG.levels` では挙動は変わらない:
     *  * `gamble`（`n >= 60` の下限型）… 最大人数なら通る → **待つ**（旧表と同じ）
     *  * `modTrap`（`n >= 260` かつ `t >= 4`）… tier が足りていれば待つ。
     *    ★**足りていなければ消費する** —— ここが旧表に無かった穴
     *  * `trap`（`n <= 45` の**上限型**）… 人数は増える一方なので待っても遠ざかる → 消費（旧表と同じ）
     *
     * 待つのは `PINNED`（出るか出ないかで結果が何倍も変わる型）だけ。
     * 普通の型は今までどおり代役に差し替えて消費する。
     */
    const canWait = PINNED.has(want) && ok(want, Number.MAX_SAFE_INTEGER);
    if (!canWait) this.planPos++;
    for (const k of ['crossover', 'smallLoss', 'plain'] as Kind[]) {
      if (ok(k)) return k;
    }
    return 'plain';
  }
}

/**
 * ステージごとの型の並び（＝献立）。**先頭2枚は `build` 側で固定**なので、ここは3枚目以降。
 *
 * 決め方の原則:
 *  * **核（crossover）を必ず複数入れる。** これが無い走行があると、
 *    そのステージは「大きいほうを選ぶだけ」になる
 *  * **大博打（gamble・×5）は1回まで。** 出るか出ないかで結果が何倍も変わるので、
 *    回数が運で決まると腕前が埋もれる
 *  * **罠（trap / modTrap）も1回まで。** 一度踏めば意味は分かるので、
 *    何度も出すとただの事故になる
 */
const PLANS: Record<number, Kind[]> = {
  0: ['plain', 'smallLoss', 'plain', 'smallLoss', 'plain'],
  1: ['smallLoss', 'crossover', 'plain', 'crossover', 'smallLoss', 'crossover'],
  2: ['crossover', 'smallLoss', 'trap', 'crossover', 'bothLoss', 'crossover', 'smallLoss'],
  3: ['crossover', 'smallLoss', 'bothLoss', 'gamble', 'crossover', 'crossover', 'bothLoss'],
  /*
   * ★**2026-08-24: `modTrap` を外した**（`GAMEPLAY.md` §12-7）。
   * tier4 を Lv17 で解禁したので初めて実測できたが、**踏むと走行が終わる**:
   * 直前 50,070人 → 直後 11人、ゴール平均 59人 ＝ **0.1% しか戻せない**（`npm run sim:trap`）。
   * mod は「何千人いても最大 k−1 人」なので、**難易度ではなく今までの全否定**になる。
   * 型そのものは `gateOps` に残してあるので、**この1行に 'modTrap' を戻すだけで復活する。**
   * 戻すなら「人数が小さいうちに一度教える」形にする（＝tier をもっと早く解禁する）のが先。
   *
   * modTrap を抜いても tier4 は tier3 より重い（`trap` と `bothLoss` と `gamble` が同居し、核が4枚）。
   */
  4: ['crossover', 'trap', 'crossover', 'bothLoss', 'gamble', 'crossover', 'crossover', 'trap'],
};

/**
 * 献立を作る。**並びは毎回まったく同じにはしない**（同じステージが完全に同じ展開だと飽きる）。
 * ただし**先頭は固定**する。最初に何を教えるかは運で決めてよい所ではない。
 * 顔ぶれ（どの型が何回出るか）は変わらないので、運の幅はほとんど増えない。
 */
function buildPlan(tier: number): Kind[] {
  const base = PLANS[Math.min(4, Math.max(0, tier))] ?? PLANS[0];
  /*
   * ★**特別な型は動かさない**（2026-08-23、献立を入れた直後の実測で判明）。
   *
   * 顔ぶれを固定しただけでは足りなかった。**順番を運に残していた。**
   * 大博打(×5)が3枚目に出るか7枚目に出るかで、最終人数が何倍も変わる
   * （実測: Lv5 の完璧操作で登れた段が 3〜10 段。幅7）。
   * だから大博打と罠は**献立に書いた位置に固定**し、
   * 入れ替えるのは普通の型（核・小損・素直・両損）だけにする。
   */
  const movable = base.map((k, i) => ({ k, i })).filter((o) => o.i > 0 && !PINNED.has(o.k));
  const order = movable.map((o) => o.k);
  shuffle(order);
  const out = base.slice();
  movable.forEach((o, j) => { out[o.i] = order[j]; });
  return out;
}

/**
 * **献立の中で動かさない型。** 出るか出ないかで結果が何倍も変わるので、
 * 順番も回数も運に委ねない。`buildPlan` は位置を固定し、`pickKind` は消費を遅らせる
 */
const PINNED = new Set<Kind>(['gamble', 'trap', 'modTrap']);

/*
 * ★**`WAIT_UNTIL` の表は 2026-08-27 に廃止した。**
 * 「人数が育てば出せる型と、その下限」を手で写す表だったが、`ok()` の人数条件だけを
 * 写して **tier 条件が落ちていた**。表を保つのをやめ、`pickKind` が `ok()` に
 * 「人数を最大にしても通らないか」を直接聞く形にした（＝二重管理そのものが消えた）。
 */

/** mod の法。**小さいほど残酷**なので、初手から 3 は出さず 12〜40 を中心にする */
const MODS = [12, 15, 20, 25, 30, 40] as const;

/**
 * ★**倍率の並びも献立にする**（2026-08-24 / `GAMEPLAY.md` A-3）。
 *
 * 型の顔ぶれを固定した（A-1）あと Lv3 を測ったら、**運の幅が 9.1倍 → 21.5倍 に悪化**していた。
 * 原因は献立が意図どおりに効いたことそのもの ——
 * `PLANS[1]` には核（crossover）が3枚あり、核が増えるほど `×m` を引く回数が増える。
 * そして `m` は `0.62/0.28/0.10` の重み付き乱数だった。
 * **3回とも ×2 なら 8倍、3回とも ×4 なら 64倍。完璧に選んでも 8倍の差が乱数だけで開く。**
 *
 * 型を固定したのに倍率を乱数のままにしていたのは、**献立と同じ間違いをもう一段下でやっていた**。
 * だから並びを先に決めて順に配る。`×` が常に ×2 だと
 * 「掛け算＝大きいほう」という固定観念だけで選べてしまうので、**種類は散らしたまま回数を固定する。**
 *
 * ×5（大博打）と ×3（罠）はここを通さない。あれは型そのものが倍率を決めている。
 */
const MUL_CYCLE = [2, 3, 2, 4, 2, 3, 2, 4] as const;

/** ゲート間隔の並び。平均は旧の乱数と同じ 37m（`gapMin` 30 〜 `gapMax` 44 の中央） */
const GAP_CYCLE = [32, 42, 36, 44, 30, 40, 34, 38] as const;

/**
 * `+A` と `×m` の**分岐点**は `A = n*(m-1)`。ratio で分岐点のどちら側かを決める。
 * ratio < 1 なら `×m` が正解、> 1 なら `+A` が正解。
 *
 * **型は分岐点の位置で決まる。** ここを `n * 定数` で書くと分岐点が人数と一緒に動いて、
 * 常に同じほうが正解になり型そのものが消える（両損ゲートで実際にやらかした）。
 */
function crossPoint(n: number, m: number, ratio: number): number {
  return near(n * (m - 1) * ratio);
}

/**
 * 損の値。**その場の人数を全部持っていく `−A` は作らない。**
 * 引き算は必ず「痛いが立て直せる」範囲に収める（÷2 と並べる型では ÷2 側が保険になるが、
 * 見込みがズレていると −A 側が全滅になり、選択ではなく事故になる）
 */
function loss(n: number, raw: number): number {
  return Math.max(1, Math.min(near(raw), Math.floor(n * 0.82)));
}

/** 桁が読みやすい数に丸める。0.5秒で暗算させるので端数を出さない */
function near(raw: number): number {
  const v = Math.max(3, raw);
  const step = v < 20 ? 1 : v < 100 ? 5 : v < 500 ? 10 : v < 5000 ? 50 : 500;
  return Math.max(3, Math.round(v / step) * step);
}

/** どちらが当たりか位置で覚えられないように毎回入れ替える */
function shuffle<T>(a: T[]): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

function shuffled<T>(a: T[]): T[] {
  shuffle(a);
  return a;
}

/** 素の札で相手の数が要るときに使う数。★**小さい素数から選ぶ**（合成数だと結果が読みにくい） */
const PLAIN_K = [3, 5, 7, 11, 13];


