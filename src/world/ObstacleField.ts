import * as THREE from 'three';
import { CFG } from '../config';
import { ObstacleView, type ObstacleKind } from '../entities/Obstacle';
import type { ObstacleKnobs } from '../config';
import type { Crowd } from '../entities/Crowd';
import { hitWorld, type HitReport } from '../core/Physics';

interface Live {
  kind: ObstacleKind;
  at: number;
  /** 中心X（pinch では隙間の中心） */
  x: number;
  /** 半幅 */
  wide: number;
  view: ObstacleView;
  /** `onReach` を1回だけ鳴らすための印 */
  reached: boolean;
  /** ハンマーの往復位相／動く床の押す向き（±1） */
  phase: number;
  /**
   * ★**扇風機が今ふいているか**（2026-09-12）。**首振りはしない**（本人指定）ので、
   * 代わりにここが**ランダムに ON / OFF する**。`timer` が 0 を切ったら裏返す
   */
  blowing: boolean;
  /** 扇風機の切り替えまでの残り秒 */
  timer: number;
  /** この障害物で減った累計。ポップと SE に使う */
  damage: number;
  reported: boolean;
  /** ★当たり判定のワールドでこの障害物を指す番号（`Physics` の `owner`） */
  id: number;
  /** ★いま絵を置いた横位置。ポップを出す場所に使う */
  shownX: number;
  /** ★**触れ始めた時点の論理人数。** 3段階のダメージはこれに対する割合で決まる */
  base: number;
  /** ★触れ始めた時点の実体数。段階は「触れた実体 ÷ これ」で決める */
  bodies: number;
  /** ★この障害物がこれまでに触れた実体の数（延べではなく実数。触れた人は消えるので同じ） */
  touched: number;
  /** ★これまでに払ったダメージ（論理人数）。段階が上がったぶんだけ追加で払う */
  lossDone: number;
  /** ★理系用: この障害物でもう奪った桁の割合（段階は上がるだけ。`lossDone` と同じ作法） */
  digitDone: number;
  /** ★いま重なっているか。離れた瞬間に残りのポップを出す */
  touching: boolean;
  /** ★すでにポップで出した量。残りは離れたときにまとめて出す */
  popped: number;
}

/** 障害物1つぶんの当たり判定の状態。**新しく置くたびにここから始める** */
function freshHit(): Pick<Live, 'damage' | 'reported' | 'id' | 'shownX' | 'base' | 'bodies' | 'touched' | 'lossDone' | 'digitDone' | 'touching' | 'popped'> {
  return { damage: 0, reported: false, id: nextId++, shownX: 0, base: 0, bodies: 0, touched: 0, lossDone: 0, digitDone: 0, touching: false, popped: 0 };
}

/** 当たり判定のワールドで障害物を見分けるための通し番号 */
let nextId = 1;

/**
 * ★**人が減る型**（2026-09-19）。ここに無い型は当たり判定の箱を1つも出さない。
 * 坂・修正テープ・扇風機は**1人も減らさない**（2026-09-12 以来の決定）
 */
const HURTS: ReadonlySet<ObstacleKind> = new Set<ObstacleKind>(
  ['spike', 'hammer', 'hr', 'pinch', 'window', 'shredder', 'gap', 'stamp', 'fence'],
);

/**
 * ★**主人公がぶつかって弾かれる型**（本人指定「主人公は、はじかれるかな」）。
 * ★**穴と柵は入れない** ―― 穴は落ちるもの、柵は踏み倒すもので、
 * どちらも「壁として押し返される」と絵の意味が変わる
 */
const BLOCKS_HERO: ReadonlySet<ObstacleKind> = new Set<ObstacleKind>(
  ['spike', 'hammer', 'hr', 'pinch', 'window', 'shredder', 'stamp'],
);

/**
 * 障害物と人事部の管理（PROGRESS §4-D / §9）。Phase 3。
 *
 * 判定は §4-B の粒度表どおり **個体座標**。ヒマワリ配置は index が大きいほど外周なので、
 * 「外側から削れる」が自動で手に入る（★2026-09-15 以降は `Crowd.hitBox` が「箱に近い側から」欠けさせる）。
 *
 * **ゲートと重ならないようにする**のは意図的な設計判断で、
 * 0.5秒の暗算を強いた直後に避けを要求すると、理不尽さだけが残って学習にならない。
 */
export class ObstacleField {
  readonly group = new THREE.Group();
  /** 通り過ぎた障害物の被害報告（数字ポップ・SE 用） */
  onHit?: (x: number, loss: number, kind: ObstacleKind) => void;
  /**
   * ★**群衆の位置に届いた**ことを1回だけ知らせる（2026-08-26・計測用）。
   *
   * `onHit` は**減ったときしか鳴らない**ので、動く床・坂・修正テープのように
   * **1人も減らさないギミックは計測に一度も現れなかった**（`sim:pacing` の語彙に
   * `belt` が出ていなかったのはこれ。以前からの穴で、坂と修正テープで2つ増えるところだった）。
   * 「新要素に対応していない測定器は嘘の数字を出す」——外部レビューの指摘どおり
   */
  onReach?: (x: number, kind: ObstacleKind) => void;

  private readonly pool: ObstacleView[] = [];
  private readonly live: Live[] = [];
  private index = 0;
  /** ★ハンマーの軸を左右互い違いにするための番号 */
  private hammerTurn = 0;
  /** このレベルで出してよい種類（§9 / CFG.levels）。**空なら1つも置かない** */
  private kinds: readonly ObstacleKind[] = [];
  private firstAt = Infinity;
  /** このレベルの密度（§9 のカーブ）。レベルごとに変える */
  private chance: number = CFG.obstacle.chance;
  /**
   * ★**このレベルで使うつまみの表**（2026-08-26・`resolveKnobs`）。
   * 以前はどのメソッドも `CFG.obstacle` を直に読んでいたので、
   * 幅も速さも**全レベル共通**だった＝区画制が書けなかった。
   * `reset` で差し替える。**`CFG` 自体は書き換えない**（やり直しで前の値が残るため）
   */
  private c: ObstacleKnobs = CFG.obstacle;
  /** 今フレーム、動く床から横へ押される量（m/秒）。Game が playerX に足す */
  push = 0;
  /**
   * ★今フレームの速度の増減（2026-08-26・坂）。
   * **正 ＝ 遅くなる / 負 ＝ 速くなる。** Game が前進距離に掛ける
   */
  slow = 0;
  /**
   * ★今フレームの横の効きやすさ（2026-08-26・修正テープ）。**1 ＝ 通常、小さいほど滑る。**
   * 押される `push` と違って、**自分の操作が鈍る**のがこの床の正体
   */
  slip = 1;
  /**
   * ★**今フレーム、主人公が障害物に押し出される量**（2026-09-19・本人「主人公は、はじかれるかな」）。
   * `Game` が `playerX` に足す。**群れは押し返されない**（隊列が崩れるので）
   */
  heroPush = 0;

  constructor() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < CFG.obstacle.maxLive; i++) {
      const v = new ObstacleView(box);
      this.pool.push(v);
      this.group.add(v.group);
    }
  }

  /**
   * ゲートが1行確定するたびに呼ばれる。**その2枚の真ん中にだけ**障害物を置く（§4-D）。
   * 独立したスケジュールを持たせない理由は config の `minGateGap` のコメントにある。
   */
  /**
   * ★**直前の区間が空だったか**（2026-09-12）。
   * 本人の指定:「**2回以上何もギミックや敵がいない区間は存在しないように**」。
   * ★**確率では保証できない**ので（chance 0.9 でも 1% で 2連続が出る）、
   * **直前が空なら今回は必ず置く**という規則にした
   */
  private emptyRun = 0;

  offer = (prevAt: number, at: number): void => {
    const c = this.c;
    const gap = at - prevAt;
    if (this.kinds.length === 0) return;
    // 道の最初（`firstAt` の手前）と、狭すぎる区間は**空きに数えない**。
    // ここを数えると、スタート直後に強制配置が走って §3 の「最初の10秒」を壊す
    if (prevAt < this.firstAt || gap < c.minGateGap) return;
    if (this.live.length >= c.maxLive) { this.emptyRun++; return; }
    if (this.emptyRun < 1 && Math.random() > this.chance) { this.emptyRun++; return; }
    this.emptyRun = 0;
    const view = this.pool.pop();
    if (!view) return;
    const p = this.plan(this.index++);
    const mid = prevAt + gap / 2;
    let spot = mid + (Math.random() * 2 - 1) * (gap / 2) * c.jitter;
    /*
     * ★★**動く床はゲートの直前に置く**（2026-09-12・本人指定）。
     *
     * 前は区間の**中点**に置いていた。だから**押されてもその先に何も無く**、
     * 本人に「通っても何も変わらない」「まったく機能していない」と言われた。
     * ★**同じことを坂で一度学んでいて、このファイルに書いてあった**――
     * 「坂を中点に置いていた間、何の難易度にもなっていなかった」。
     * ゲートの直前なら、**横にずらされる＝選べる枠が制限される**
     * （本人「**おいそっちにずらされるんかい** って制限を創り出せる」）、
     * **前に押される＝式を読む時間が物理的に減る**。
     */
    // ★帯と風は**長さを持つ**ので、ゲートの手前に中心が来るように下げる（扇風機も同じ扱い）
    if (p.kind === 'belt') spot = at - c.beltRun * 0.5 - 2;
    if (p.kind === 'fan') spot = at - c.fanRun * 0.5 - 2;

    /*
     * ★★**とげは列で置く**（2026-09-12・本人「とげ一つだと、ちょっと弱すぎる」）。
     *
     * ★**1本ごとに別の障害物として置く。** 1つの箱にまとめない。
     * まとめると**斜めにした瞬間に絵と当たり判定がずれる** ――
     * 同じ日に動く床で直したバグを、自分で作り直すことになる。
     * 別々に置けば、**1本ごとの判定がそのまま正しい**。
     *
     * 斜めのときは 1 本ごとに奴へずらして階段状にする。
     */
    if (p.kind === 'spike') {
      const row = Math.max(1, Math.min(3, Math.round(c.spikeRow)));
      const slant = Math.random() < c.spikeSlant;
      const edge = CFG.courseWidth / 2 - CFG.playableInset;
      const step = p.wide * 2 + 0.25;
      // 列の中心を、列全体が道に収まる範囲に置き直す
      const span = (row - 1) * step;
      const room = Math.max(0.2, edge - p.wide - span / 2 - c.spikeSweep);
      const cx = (Math.random() * 2 - 1) * room;
      for (let i = 0; i < row; i++) {
        const v = i === 0 ? view : this.pool.pop();
        if (!v) break;
        this.live.push({
          ...p,
          x: cx + (i - (row - 1) / 2) * step,
          at: spot - (slant ? (i - (row - 1) / 2) * c.spikeSlantZ : 0),
          view: v, ...freshHit(), reached: false, blowing: true, timer: 0,
        });
      }
      return;
    }

    /*
     * ★**坂だけはゲートの直前に置く**（2026-08-26）。
     *
     * 本人の指摘「速度が変わって何が変わった？」がここ。**坂を中点に置いていた間、
     * 坂は「速くなったり遅くなったりするだけ」で、何の難易度にもなっていなかった。**
     * 下りきった直後にゲートが来るようにすると、**式を読む時間が物理的に短くなる**。
     * これで初めて「速い＝難しい」が成立する（＝坂に相手を与える）。
     */
    this.live.push({ ...p, at: spot, view, ...freshHit(), reached: false, blowing: true, timer: 0 });

    /*
     * ★**修正テープには必ず避けるものを重ねる**（2026-08-26）。
     *
     * 滑る床は**避ける相手がいなければ何も起きない**。Lv12〜15 で「難易度が変わらない」と
     * 言われた原因の半分がこれで、滑っている間に避けるものが無かった。
     * 帯の中に1つ、トゲを置く —— 帯の中心より少し奥に置くので、
     * **すでに滑り出したところで避けを要求される**
     */
    /*
     * ★**広い区間にはもう1個**（2026-09-12）。
     * ゲート間隔を詰めても、区間に1個だけなら密度は上限に当たる。
     * ★**新しい語彙は増やさない**（§15）―― 同じ顔をもう1枚置くだけ
     */
    if (gap >= c.minGateGap * 2 && this.live.length < c.maxLive) {
      const extra = this.pool.pop();
      if (extra) {
        const q = this.plan(this.index++);
        const at2 = q.kind === 'belt' ? at - c.beltRun * 0.5 - 2
          : q.kind === 'fan' ? at - c.fanRun * 0.5 - 2 : prevAt + gap * 0.28;
        if (Math.abs(at2 - spot) > 6) {
          this.live.push({ ...q, at: at2, view: extra, ...freshHit(), reached: false, blowing: true, timer: 0 });
        } else {
          this.pool.push(extra);
        }
      }
    }

    if (p.kind === 'whiteout') {
      const mate = this.pool.pop();
      if (mate) {
        /*
         * ★**相手はこのレベルに既にいる顔から選ぶ。**
         * トゲを決め打ちにしたら、トゲを出していない Lv15 で**語彙が8に増えて上限を超えた**。
         * 区画制は「顔を増やさずに難しくする」ものなので、ここで新顔を足しては本末転倒
         */
        const dodgeable = this.kinds.filter((k) => k === 'spike' || k === 'gap' || k === 'pinch' || k === 'hr');
        const kind = dodgeable.length > 0 ? dodgeable[Math.floor(Math.random() * dodgeable.length)] : 'spike';
        const wide = kind === 'gap' ? c.gapW / 2 : kind === 'hr' ? c.hrW / 2 : c.spikeW / 2;
        const edge = CFG.courseWidth / 2 - CFG.playableInset;
        // 帯の外に出ない x に置く（帯の中で避けさせるのが目的）
        const x = p.x + (Math.random() < 0.5 ? -1 : 1) * (p.wide * 0.55);
        this.live.push({
          kind, x: THREE.MathUtils.clamp(x, -edge + wide, edge - wide), wide, phase: 0,
          at: spot + c.whiteoutRun * 0.18, view: mate, ...freshHit(), reached: false, blowing: true, timer: 0,
        });
      }
    }
  };

  /**
   * ★**前進速度に掛ける倍率**（坂）。**Game も sim も必ずこれを通す。**
   *
   * 直に `slow` を読んで各所で計算すると、実機と sim で違う速度を使うことになり、
   * **測定器が実際のプレイを反映しない**（外部レビューの指摘・正しい）。
   * 天井を置くのは、坂が重なったときに止まる／飛ぶのを防ぐため
   *
   * ★★**2026-09-13: 速くする側の天井を -0.35 → -0.60 に広げた。**
   * この -0.35 は**坂があった時代の名残**で、坂は 9/12 に廃止されている。
   * ★**`beltBoost` を 0.34 → 0.55 に上げても、この clamp が -0.35 で刈っていて
   * 実機の速さは ×1.35 のまま 1% も変わらなかった**（本人の「動く床は
   * 難易度にあまり影響がない」に、つまみ側の天井も効いていた）。
   * 遅くする側（+0.55）はそのまま。★**重なっても最悪 ×1.60 で、飛ばない**
   */
  get speedScale(): number {
    return 1 - THREE.MathUtils.clamp(this.slow, -0.60, 0.55);
  }

  /** @param centerX 主人公の横位置。窓口が「どれだけ外したか」を測るのに要る */
  /*
   * ★★**2026-09-19: `capFor` を消した。**
   * 「1つの障害物で失える上限」を人数の割合から作る仕組みだったが、
   * **上限の設計は当たり判定が嘘だった時代の対症療法**（当たっていないのに減るので、
   * 減りすぎないように蓋をしていた）。いまは**触れた実体の割合で段階を決める** `payout` が持つ。
   * 柵の定数（`fenceCost`）と窓口の絞り（`windowSqueeze`）だけ、そこへ引き継いだ。
   */


  update(dt: number, distance: number, crowd: Crowd, centerX: number): void {
    const c = this.c;
    this.push = 0;
    this.slow = 0;
    this.slip = 1;
    this.heroPush = 0;

    /*
     * ★★**ここから当たり判定は Rapier**（2026-09-19）。
     * 手順は `Collision-Sim` の `src/simulation.ts` と同じ:
     * **置く → 1ステップ回す → 始まった重なりを受け取る**。
     */
    const hit = hitWorld();
    hit.begin();
    // ★**群れは「前のフレームの終わり」の位置**。障害物は 9m/秒 なので 1コマ 0.15m のずれ。
    // 先に群れを動かすと `Game` の並び（ゲート→障害物→群れ）を崩すので、ここはずらさない
    crowd.writeHitBodies(hit);
    hit.putHero(centerX);
    // 窓口の絞りは時間で戻す。**戻さないと2つ目の窓口以降ずっと細いまま**になる
    crowd.squeeze = Math.min(1, crowd.squeeze + ((1 - c.windowSqueeze) / c.windowRecover) * dt);

    /*
     * ★**2026-09-19: `half`（判定の奥行き `depth*0.5+0.35`）を消した。**
     * 全部の障害物を**同じ 1.8m の帯**として見ていた値で、実物のとげ（奥行き 0.7m 前後）の
     * およそ3倍あった。いまは奥行きも `place()` が絵から出す
     */
    // ---- 1周目: 動かして、絵を置いて、**絵と同じ場所に**当たり判定の箱を出す ----
    for (const o of this.live) {
      const z = distance - o.at;   // 前方は -Z

      let x = o.x;
      /** ★回転ハンマーの腕の角度。**絵と当たり判定はこの1つから出す** */
      let spin = 0;
      if (o.kind === 'hammer') {
        spin = distance * 0.12 * c.hammerSpeed + o.phase;
        x = o.x + Math.sin(spin) * c.hammerSweep;
      } else if (o.kind === 'spike' && c.spikeSweep > 0) {
        /*
         * ★**動くとげ**（2026-09-12・区画「とげ」の 4 本目）。
         * ★**上の hammer と完全に同じ式**を使う。別の動かし方を発明しない。
         * `spikeSweep: 0`（既定）のときはここに入らず、今までと同じ静止のとげになる
         */
        x = o.x + Math.sin(distance * 0.12 * c.spikeSpeed + o.phase) * c.spikeSweep;
      } else if (o.kind === 'shredder') {
        // **一方向に滑る隙間。** 近づくほど端へ寄っていくので、通りながら追うしかない
        const u = THREE.MathUtils.clamp(z / c.shredderRun + 0.5, 0, 1);
        x = o.x + (u - 0.5) * 2 * c.shredderSlide * o.phase;
      }
      /*
       * ★**巨大赤判子。** 落下の進み具合を**距離から**作る。
       * 秒で作ると、坂で速度が変わった瞬間に「影が出てから落ちるまでに進む距離」が変わり、
       * 同じ絵なのに避けられたり避けられなかったりする（外部レビューの指摘・正しい）。
       * 距離で作れば、坂の上でも下でも影と落下点の関係は変わらない
       *
       * ★**`place` より前で計算する**（2026-08-27 修正）。
       * ここが `place` のあとにあったので、`place` は**1つ前のフレームの高さ**で
       * 判子を描いていた。毎フレーム1コマ遅れる ＝ 落下の速い最後で目に見えてずれる。
       */
      if (o.kind === 'stamp') {
        const u = THREE.MathUtils.clamp((z + c.stampTell) / c.stampTell, 0, 1);
        // 落下は最後で速い。ずっと等速で降りてくると「いつ落ちるか」が読めない
        o.view.stampY = (1 - u) * (1 - u) * 7;
      }

      if (o.kind === 'fan') {
        o.timer -= dt;
        if (o.timer <= 0) {
          o.blowing = !o.blowing;
          // 同じ長さで点滅すると機械に見える。0.6〜1.4 倍のばらつきを持たせる
          o.timer = (o.blowing ? c.fanOn : c.fanOff) * (0.6 + Math.random() * 0.8);
        }
        if (o.blowing && Math.abs(z) < c.fanRun * 0.5) this.push = c.fanPush * o.phase;
      }

      /*
       * ★**動く床の加速**（`beltBoost`）。**帯の上にいるあいだ前進が速くなる。**
       *
       * ★★**2026-09-19 の当たり判定 Rapier 化（`540d2cd`）で `update()` を作り直したとき、
       * この1行が落ちていた**（2026-09-20 に本人の実機「動く床が反応していない」で発覚）。
       * 落ちているあいだ `this.slow` は冒頭の `= 0` 以外に代入が無く、
       * `speedScale` は**常に 1.0** ＝ 動く床は「何も起こらない置物」だった。
       * `belt` のある Lv12・13・14・15・19・20 だけ尺が伸びていたのはこれ。
       *
       * ★**負の値を入れる。** `speedScale` は `1 - clamp(slow, -0.60, 0.55)` なので、
       * 負 ＝ 速くなる。`-0.55` で ×1.55（天井 -0.60 の1歩手前）。
       * ★**扇風機と同じ「帯の中にいるか」の書き方**を使う（別の判定を発明しない）
       */
      if (o.kind === 'belt' && Math.abs(z) < c.beltRun * 0.5) this.slow = -c.beltBoost;

      // ★**風の切り替えは絵より前に置く。** あとに置くと、絵だけ1フレーム遅れて吹き始める
      o.view.place(o.kind, x, z, o.wide, o.kind === 'hammer' ? spin : o.phase, o.x, c.hammerSweep, o.blowing);
      o.shownX = x;

      /*
       * ★★**障害物が群れの位置に届いた合図**（`onReach`）。**1つにつき1回だけ。**
       *
       * ★**2026-09-19 の当たり判定 Rapier 化（`540d2cd`）で落ちていた**（9/19 の検品が特定済み）。
       * 落ちているあいだ `sim:pacing` は**障害物を1つも数えず**、
       * ★**全20レベルが語彙3 `[gate coin rival]`・合計 98 → 60** になっていた。
       * **遊びは壊れていない。壊れていたのは測定器のほう。**
       *
       * ★★**「物理が触れた瞬間」ではなく、ここで鳴らす。** 触れた瞬間だと
       * **避けきった障害物が語彙に数えられない** ―― §15 の予算は
       * 「**何種類の顔が出たか**」を数えるものなので、**避けたかどうかは関係ない**。
       * 動く床・扇風機のように**1人も減らさないギミック**も数える必要がある
       * （`onHit` は減ったときしか鳴らないので、この合図が別に要る）
       */
      if (!o.reached && z > -2) {
        o.reached = true;
        this.onReach?.(x, o.kind);
      }
      /*
       * ★**判定の箱は `place()` が絵と一緒に詰めたもの**（`Obstacle.ts` の `hits`）。
       * ここで寸法を書かない ―― 書いた瞬間に「絵と判定が2か所」に戻る
       */
      if (HURTS.has(o.kind)) {
        for (const box of o.view.hits) hit.putPart(o.id, box);
      }
    }

    // ---- 判定を1ステップ進める ----
    const reports = hit.step();

    // ---- 2周目: 当たりを payout して、通り過ぎたものを片づける ----
    for (let i = this.live.length - 1; i >= 0; i--) {
      const o = this.live[i];
      const z = distance - o.at;
      const r = reports.get(o.id);
      if (r) this.payout(o, r, crowd, c, centerX);
      else if (o.touching) {
        // 離れた。残っているぶんのポップをここで出す
        o.touching = false;
        if (o.damage > o.popped) {
          this.onHit?.(o.shownX, o.damage - o.popped, o.kind);
          o.popped = o.damage;
        }
      }

      // ★帯は長いので、**帯の後端が通り過ぎるまで**消さない。
      // 16m 固定のままだと 40m の坂が途中で消えて、乗っている最中に効果が切れる
      const gone = o.kind === 'belt' ? c.beltRun * 0.5 + 16 : o.kind === 'fan' ? c.fanRun * 0.5 + 16 : 16;
      if (z > gone) {
        o.view.hide();
        this.pool.push(o.view);
        this.live.splice(i, 1);
      }
    }
  }

  /**
   * ★★**当たったぶんを払う**（2026-09-19・phase 2「ダメージは3段階」）。
   *
   * 本人の指定:「**当たった範囲＝ダメージにするからダメ。大きく被る／割と被る／
   * 少ししか被らないの3段階に分ければいい**」。だからここは2階建てになっている。
   *
   *  1. **誰が消えるか** … 物理が「実際に触れた」と言った個体だけ。嘘が無いので絵が正しい
   *  2. **何人減るか** … 触れた実体の**割合**で段階を決め、その段階の割合を
   *     **触れ始めた時点の人数**に掛ける。★**実体839体の上限に影響されない**
   *
   * ★**段階は上がるだけ**（`lossDone` までしか払わない）。下がらないので、
   * 本人が 2026-09-15 に指摘した「**数字だけが上下する**」は構造的に起きない。
   */
  private payout(o: Live, r: HitReport, crowd: Crowd, c: ObstacleKnobs, centerX: number): void {
    // --- 主人公は押し返す（本人「主人公は、はじかれるかな」）---
    if (r.heroBoxes.length > 0 && BLOCKS_HERO.has(o.kind)) {
      for (const b of r.heroBoxes) {
        const pad = CFG.crowd.heroHalf + b.hx + CFG.hit.heroPad;
        // ★**めり込みが浅いほうへ出す**（`collision-basics.md` §3 の法線と同じ考え方）
        const to = centerX >= b.x ? b.x + pad : b.x - pad;
        if (Math.abs(to - centerX) > Math.abs(this.heroPush)) this.heroPush = to - centerX;
      }
    }

    if (r.agents.length === 0 && o.touching) return;
    if (r.agents.length === 0) return;

    if (!o.touching) {
      o.touching = true;
      o.base = crowd.count;
      o.bodies = Math.max(1, crowd.drawn);
      if (o.kind === 'window') crowd.squeeze = c.windowSqueeze;
    }
    o.touched += r.agents.length;

    /*
     * ★**柵だけは定数**（2026-08-28 の判断をそのまま残す）。
     * 割合だと何人いても痛みが同じで**判断が生まれない**。定数にすると
     * 「大群なら踏み倒せて、小勢なら迂回するしかない」になる
     */
    let target: number;
    // ★理系用: 同じ段階で奪う桁の割合（`DigitHit`）。ほかのモードは使わない
    let digit = 0;
    const D = crowd.digitHit;
    if (o.kind === 'fence') {
      target = Math.min(c.fenceCost, Math.max(0, o.base - 1));
      if (D) digit = D.fence;
    } else {
      const ratio = o.touched / o.bodies;
      const H = CFG.hit;
      const big = ratio >= H.tierBig, mid = ratio >= H.tierMid;
      const step = big ? H.lossBig : mid ? H.lossMid : H.lossSmall;
      const scale = o.kind === 'hr' ? H.hrScale : 1;
      target = o.base * step * scale;
      if (D) digit = (big ? D.big : mid ? D.mid : D.small) * scale;
    }
    /*
     * ★★**理系用は桁も奪う**（2026-09-26）。段階が上がったぶんだけ上乗せする（下がらない）。
     * 人数が少ないうちは `shrinkDigits` が何もしないので、ふつうの人数の手触りは変わらない
     */
    if (digit > o.digitDone) {
      crowd.shrinkDigits(1 - (1 - digit) / (1 - o.digitDone));
      o.digitDone = digit;
    }

    const inc = target - o.lossDone;
    if (inc <= 0) return;
    /*
     * ★**払える量に見合う人数だけ飛ばす。** 実体1体は論理 `count/drawn` 人ぶんなので、
     * それに満たない払いで人を飛ばすと、**飛んだのに数が減らない**（見た目と数字が食い違う）
     */
    const perBody = crowd.count / Math.max(1, crowd.drawn);
    const bodies = inc >= perBody * 0.5 ? r.agents : [];
    const got = crowd.strike(bodies, inc);
    if (got <= 0) return;
    o.lossDone += got;
    o.damage += got;
    /*
     * ★**当たったその瞬間に1回鳴らす**（2026-09-15 の原則「当たった感じと音をずらさない」）。
     * 残りは**離れたときにまとめて**1回。★**毎フレーム鳴らさない** ――
     * 個体判定は1回の通過で何フレームも当たるので、素直に出すと連射になる
     */
    if (!o.reported) {
      o.reported = true;
      o.popped = o.damage;
      this.onHit?.(o.shownX, o.damage, o.kind);
    }
  }

  /**
   * ★**検査用。狙った場所に1本だけ置く**（2026-09-19・`tools/hit-check.ts`）。
   *
   * 遊びの流れからは呼ばない。**当たり判定が「当たるべきときに当たり、
   * 当たらないべきときに当たらない」ことを機械で確かめる**ために要る
   * （`Collision-Sim` の `tools/verify.mjs` と同じ役割）。
   */
  placeForTest(kind: ObstacleKind, at: number, x: number, wide: number, phase = 0): boolean {
    const view = this.pool.pop();
    if (!view) return false;
    this.live.push({ kind, x, wide, phase, at, view, ...freshHit(), reached: false, blowing: true, timer: 0 });
    return true;
  }

  /**
   * @param kinds このレベルで出してよい種類（空ならこのレベルは障害物なし）
   * @param knobs このレベルのつまみ（`resolveKnobs(lv).obstacle`）。
   *   **省略できない。** 既定値に落ちる道を残すと、sim と実機で違う値を測ることになる
   */
  reset(kinds: readonly ObstacleKind[], firstAt: number, chance: number, knobs: ObstacleKnobs): void {
    this.chance = chance;
    this.c = knobs;
    for (const o of this.live) {
      o.view.hide();
      this.pool.push(o.view);
    }
    this.live.length = 0;
    /*
     * ★**つまみを view 全部に配る**（2026-08-27 修正）。
     * ここまでで生きている view は全部 pool に戻っているので、pool を舐めれば全部に届く。
     * 配らないと `ObstacleView.place` が既定値のままになり、
     * **絵（既定値）と当たり判定（区画のつまみ）が別の数字を見る**。
     */
    for (const v of this.pool) v.setKnobs(knobs);
    this.index = 0;
    this.hammerTurn = 0;
    /*
     * ★★**2026-09-13: `fanTurn` と `emptyRun` を足した**（9/13 朝の検品）。
     * `hammerTurn` だけ戻していて、同じ性質の2つが漏れていた。
     * ★**sim には絶対に出ない** —— どの sim も走行ごとに `new ObstacleField()` するので常に 0 から始まる。
     * **実機だけ**（`Game` は1個を使い回す）レベルとリトライをまたいで持ち越していた。実害は2つ:
     *   ① 扇風機の**左右交互が次のレベルで裏返る**（右から始まる回と左から始まる回が混ざる）
     *   ② 直前のレベルが空き区間で終わっていると、**次のレベルの最初の区間に
     *      `obstacleChance` を無視して必ず障害物が置かれる** ＝ `offer` のコメントが
     *      「**§3 の『最初の10秒』を壊す**」と書いて守ろうとしていた穴そのもの
     */
    this.fanTurn = 0;
    this.emptyRun = 0;
    this.kinds = kinds;
    this.firstAt = firstAt;
  }

  /** 扇風機を左右交互に置くための番号（回転ハンマーの `hammerTurn` と同じ作法） */
  private fanTurn = 0;

  private plan(i: number): { kind: ObstacleKind; x: number; wide: number; phase: number } {
    const c = this.c;
    const edge = CFG.courseWidth / 2 - CFG.playableInset;
    /*
     * **最初の kinds.length 個は「配列の順に1個ずつ」出す。** そのあとだけランダム。
     *
     * 元は `slice(0, 1 + floor(i/2))` で解禁していたが、1レベルに置かれる障害物は
     * 6〜7個しかない。6種類のレベルでは window が i>=6、shredder が i>=8、hr が i>=10 で
     * **後ろ3種が一度も出ないまま終わっていた**（本人が「窓口ってどれ？」と言ったのがこれ）。
     * 順番に1個ずつ出せば「今回の新顔」も伝わるし、全部が必ず一度は出る。
     */
    /*
     * ★地形（坂）は別枠で置くので、ここでは引かない。
     * 引いてしまうと「避けるものが出ない区間」ができて、密度が落ちる
     */
    const pool = this.kinds;
    const list = pool.length > 0 ? pool : this.kinds;
    const kind = i < list.length
      ? list[i]
      : list[Math.floor(Math.random() * list.length)];

    if (kind === 'pinch' || kind === 'window' || kind === 'shredder') {
      // 隙間は minLateralRange を必ず上回らせる。届かない隙間はただの事故
      const raw = kind === 'window' ? c.windowGap : kind === 'shredder' ? c.shredderGap : c.pinchGap;
      const gap = Math.max(CFG.minLateralRange, raw) / 2;
      // シュレッダーは滑るぶん、始点を中央寄りにしないと端まで振り切れて避けようがなくなる
      const room = kind === 'shredder' ? edge - gap - c.shredderSlide : edge - gap;
      const slide = kind === 'shredder' ? (Math.random() < 0.5 ? 1 : -1) : 0;
      return { kind, x: (Math.random() * 2 - 1) * Math.max(0.3, room), wide: gap, phase: slide };
    }
    // 修正テープは帯。避けられる幅にしておく（全幅にすると「必ず滑る」＝選択が消える）
    if (kind === 'whiteout') {
      const w = c.whiteoutW / 2;
      return { kind, x: (Math.random() * 2 - 1) * Math.max(0.3, edge - w), wide: w, phase: 0 };
    }
    // 判子は点。落ちる場所を選べるようにコース内で散らす
    if (kind === 'stamp') {
      const w = c.stampR;
      return { kind, x: (Math.random() * 2 - 1) * Math.max(0.3, edge - w), wide: w, phase: 0 };
    }
    if (kind === 'gap') {
      const w = c.gapW / 2;
      return { kind, x: (Math.random() * 2 - 1) * (edge - w), wide: w, phase: 0 };
    }
    if (kind === 'belt') {
      /*
       * ★★**動く床は「前へ進むだけ」1種になった**（2026-09-12・本人指定で横と斜めを廃止）。
       * 横へ流す役目は `fan`（扇風機）へ移した ―― **風のほうが直感的だから**。
       * ★**常に道幅いっぱい・中央。** よけるものではなく、**乗ると速くなる床**
       */
      return { kind, x: 0, wide: CFG.courseWidth / 2, phase: 1 };
    }
    if (kind === 'fan') {
      /*
       * ★★**扇風機**（2026-09-12・本人指定）。
       *
       * > **本人:「扇風機は、ハンマーと同じように、道の横におく。
       * > 扇風機の向きを変えれば風を流す方向で、プレーヤーがどっちに動かされるかっていうのが調整できる」**
       *
       * ★**回転ハンマーと同じ置き方**（`edge * 0.92`）。道の端の装置という読み方を共有する。
       * ★**左右を互い違いに**するので、右から吹く番と左から吹く番が交互に来る
       * （ハンマーの `hammerTurn` と同じ作法）。
       * `phase` は**風の向き**: 右に置いた扇風機は **-X（左）** へ吹く ＝ 置いた側の逆
       */
      /*
       * ★**道の外（歩道の上）に立てる。** `edge * 0.92` だとハンマーと同じ位置になるが、
       * 扇風機は**当たるものではない**ので、**壁の外**に置いて群れと絶対に触れさせない。
       * 風だけが道に届く ―― これがいちばん直感に近い
       */
      const side = this.fanTurn++ % 2 === 0 ? 1 : -1;
      return { kind, x: side * (CFG.courseWidth / 2 + 0.5), wide: c.fanW / 2, phase: -side };
    }
    if (kind === 'hammer') {
      /*
       * ★★**軸を道の端に置く**（2026-09-12・本人指定）。
       *
       * > **本人の言葉:「今『よける』ことが不可能になっている。道の真ん中に置かれているから。
       * > 道の端っこに回転ハンマーの中心をもってくればいい。半分は回転して道の外にいて
       * > あたらないけど半分は当たる、それが回転して動いているみたいなのが作れるし、
       * > 互い違いにおくことで、ゲーム性をだすこともできる」**
       *
       * 軸が中央だと頭がコースを往復して**逃げ場がない**。
       * 端に置くと、頭は `軸 ± 振り幅` を動くので**半周ぶんは道の外**に出る。
       * ★**左右を互い違いにする**ので、右が空く番と左が空く番が交互に来る。
       * （頭は2つあるが、反対側の頭は完全に道の外になる）
       */
      const side = this.hammerTurn++ % 2 === 0 ? 1 : -1;
      return { kind, x: side * edge * 0.92, wide: c.hammerW / 2, phase: Math.random() * Math.PI * 2 };
    }
    /*
     * ★**ホッチキス芯の柵**（2026-08-28）。**迂回できる側を必ず残して置く。**
     *
     * 同じ日に、ゲートで**まったく同じ穴**をやらかしている ——
     * 枠をコース幅 11m で置いていたが、大群のときプレイヤーが立てるのは
     * ±`minLateralRange`(2.2m) だけで、**痩せた枠は物理的に選べなかった**。
     * 障害物側では最初からそれを保証する（この関数の上の
     * 「届かない隙間はただの事故」と同じ作法）。
     *
     * 柵は [x-w, x+w]。開いている側が**可動域の最悪値と `fenceDetour` 以上重なる**ように
     * x の範囲を決めてから、その中で振る。**必ず片側に寄る**ので、
     * 「そのまま突っ切って人数を払う」か「寄って避けて時間を払う」かの二択になる
     */
    if (kind === 'fence') {
      const w = c.fenceW;
      const reach = CFG.minLateralRange;
      // 左を開ける場合の x の範囲。左端の開口が reach と fenceDetour 以上重なる条件
      const lo = w - (reach - c.fenceDetour);
      // 柵が可動域に一度も掛からないと、避ける必要すら無くなる
      const hi = Math.min(edge - w, w + reach);
      const cx = lo >= hi ? lo : lo + Math.random() * (hi - lo);
      const side = Math.random() < 0.5 ? 1 : -1;
      return { kind, x: side * cx, wide: w, phase: 0 };
    }

    const wide = (kind === 'hr' ? c.hrW : c.spikeW) / 2;
    /*
     * ★**動くとげは、振り幅のぶんだけ置ける範囲を狭める**（2026-09-12）。
     * shredder が `room = edge - gap - shredderSlide` でやっているのと同じ作法。
     * これをやらないと、端に置かれたとげが**コースの外へ振れて消える**か、
     * 逆に常に壁に埋まって「避ける幅が無い」になる。
     * 静止のとき（`spikeSweep: 0`）は今までと同じ範囲になる
     */
    const sweep = kind === 'spike' ? c.spikeSweep : 0;
    const room = Math.max(0.3, edge - wide - sweep);
    return { kind, x: (Math.random() * 2 - 1) * room, wide, phase: sweep > 0 ? Math.random() * Math.PI * 2 : 0 };
  }
}
