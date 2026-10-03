import * as THREE from 'three';
import { CFG, type GateKnobs } from '../config';
import { GatePanel, GatePost } from './Gate';
import { applyOpBig, gateBounds, isGain, pickBounds, type Big, type GateChoice } from './gateOps';
import { GateDirector } from '../world/GateDirector';

/**
 * ★ゲートの改造（2026-08-26）。**3つとも「境界の位置」を動かす1つの仕組みで作る。**
 * 枠そのものを動かすとコースの外へ出るが、境目を動かせば常にコース内に収まる。
 */
type GateMode = 'plain' | 'slide' | 'timed' | 'hidden';

interface Row {
  at: number;
  choices: GateChoice[];
  panels: GatePanel[];
  /** この行の性格 */
  mode: GateMode;
  /** 揺れの位相 / 時限がどちら側へ寄るか（+1 か -1） */
  phase: number;
  /** 伏せ札の中身をもう見せたか */
  revealed: boolean;
  /**
   * ★**その札を「増える色」で塗ったか**（2026-09-21）。`choices` と同じ並び。
   * ★**`Γ(n)` や `Fₙ` は人数しだいで向きが変わる**ので、
   * **向きが変わったときだけ塗り直す**ために、塗った向きを覚えておく
   */
  paintedGain: boolean[];
  /** 枠の境界（左端・選択肢の間・右端）に立つ門柱。choices.length + 1 本 */
  posts: GatePost[];
  picked: number;
  resolved: boolean;
  /**
   * ★**確定した瞬間の境界を凍らせておく**（2026-08-27 修正）。
   *
   * `bounds()` は `row.resolved` で早期 return して**等分の境界**を返していた。
   * 当たり判定は確定の瞬間に正しい（ずれた）境界で取れているのに、
   * そのあとの破れ演出だけが等分位置で描かれるので、
   * **いちばん目が行くコマで枠が横に飛んで見えた**。とくに `timed` は
   * z=0 でズレが最大（`timedShut` まで痩せた状態）なので飛び幅も最大。
   *
   * Row は毎回 `rows.push` で作り直す新しいオブジェクトなので（プールしているのは
   * panel と post だけ）、前の行の値が残る心配はない。それでも `null` で明示する。
   */
  held: number[] | null;
  /** 通過後の経過秒。枠が破れる演出に使う */
  t: number;
  /**
   * ★**中身が見えてからの経過秒**（2026-08-28）。伏せ札が「？」から中身に変わる瞬間の演出に使う。
   * 本人評価「？ゲートはめっちゃよかった。ただ、？が消えるエフェクトが欲しい。唐突な気がする」
   */
  revealT: number;
  /**
   * ★**時限がどちら側を痩せさせるかを、もう決めたか**（2026-08-28）。
   * 出現時の乱数ではなく「**見えた瞬間にプレイヤーが乗っている側**」を痩せさせる。
   * こうすると「あとで決める」を潰す狙いはそのままで、
   * **止まっていれば必ず動かされ、動けば必ず選べる**になる。
   * ★追尾はしない（毎フレーム決め直すと、寄った側が常に痩せて理不尽に戻る）
   */
  aimed: boolean;
}

export interface GateResult {
  choice: GateChoice;
  before: number;
  after: number;
  /** ★上限のない人数（理系用で 10³⁰⁰ を越えたとき `over > 0`）。ふつうは `{ n: before/after, over: 0 }` */
  beforeBig: Big;
  afterBig: Big;
  /** 数字ポップを出すワールドX */
  x: number;
}

/**
 * ゲートの管理（出現・スクロール・判定・破れる演出）。
 *
 * 座標は「主人公が z=0 に固定で世界が流れる」方式（Course と同じ）。
 * 前方は **-Z**（three.js の標準向き）なので、走行距離 `at` の枠は `z = distance - at` に居る。
 */
export class Gates {
  readonly group = new THREE.Group();
  onResolve?: (r: GateResult) => void;
  /** 伏せ札の中身が見えた瞬間。音を鳴らすのは Game 側（Gates は音を持たない） */
  onReveal?: () => void;
  /** 行を確定した瞬間。**この2枚の間**が障害物を置ける唯一の場所（§4-D） */
  onSchedule?: (prevAt: number, at: number, clear: boolean) => void;
  /** このレベルのゲートのつまみ（`resolveKnobs(lv).gate`） */
  private g: GateKnobs = CFG.gate;

  private readonly director: GateDirector;
  private readonly pool: GatePanel[] = [];
  private readonly postPool: GatePost[] = [];
  private readonly rows: Row[] = [];
  private nextAt: number = CFG.gate.firstAt;
  private prevAt = 0;
  /** 一団の帯。**ここにはゲートも障害物も置かない**（暗算と相殺を同時に要求しない） */
  private bands: { from: number; to: number }[] = [];
  /** この距離を越えたゲートは作らない（ゴール手前の置き去りを防ぐ） */
  private stopAt = Infinity;
  /**
   * ゲートの結果がこれを下回らないようにする。**§9 の「Lv1 は失敗不可能」を担保する唯一の場所。**
   * 生成側（GateDirector）の下限だけでは足りない —— あちらが見ているのは
   * **「上手に選んだ場合の見込み人数(projected)」**であって実際の人数ではないので、
   * 選択を外し続けると小さい実人数に大きい損が当たって 0 人になる（実測で出た）
   */
  private floor = 0;
  /** いまプレイヤーが動ける半幅（m）。`update` が毎フレーム入れ替える */
  private halfWidth = CFG.courseWidth / 2 - CFG.playableInset;

  /**
   * @param knobs このレベルのつまみ（`resolveKnobs(lv).gate`）。
   *   ★**省略できない**（2026-08-27）。既定値 `CFG.gate` に落ちる道を残していたせいで、
   *   sim 4本が渡し忘れたまま **時限・横滑り・伏せ札の3種が一度も発火していなかった**
   *   （`CFG.gate` の既定は `timedChance`/`slideChance`/`hiddenChance` が全部 0）。
   *   `ObstacleField.reset` のコメントが「既定値に落ちる道を残すと sim と実機で
   *   違う値を測ることになる」と書いているとおりで、`Gates` だけその道が残っていた
   */
  /**
   * @param mathLv 数学ボケモードのレベル（**1 始まり**）。`null` ＝ ふつうの四則演算ゲート。
   *   ★**モードそのものを渡さない**のは、`GateDirector` が要るのは区画を引くレベルだけだから
   */
  constructor(startCount: number, tier: number, gapScale: number, knobs: GateKnobs, mathLv: number | null = null) {
    this.g = knobs;
    this.director = new GateDirector(startCount, tier, gapScale, mathLv);
    this.grow(knobs.maxRows);
  }

  /**
   * ★**プールを、そのレベルが要求する行数まで伸ばす**（2026-09-06）。
   *
   * ★**直した穴**: ここは `CFG.gate.maxRows`（**全レベル共通の既定値 4**）で確保していたのに、
   * `update()` は `this.g.maxRows`（＝**区画のつまみ**）で行数を決めていた。
   * つまり**区画で `maxRows` を 5 に上げた瞬間**、パネルか門柱が足りなくなって
   * `if (panels.length < choices.length ...) break;` の保険に落ち、
   * ★**エラーも警告も出ないままゲートが静かに出なくなる**（`- [!]` 2026-08-28）。
   *
   * いまの `ZONES` は `maxRows` を触っていないので**まだ発火していない**。
   * 直し方は「プールも `knobs.maxRows` で確保する」か「触れないつまみだと明示する」の二択だったが、
   * ★**後から増やせる形**にすれば、どちらを選んでも壊れない
   * （`reset` から毎回呼ぶので、区画が要求する数は必ず満たされる）。
   * 減らしはしない —— **使い回すためのプールなので、余っていても害が無い**
   */
  private grow(rows: number): void {
    const want = Math.max(CFG.gate.maxRows, Math.ceil(rows));
    /*
     * ★**足りているときは何も作らない。** `reset()` から毎レベル呼ばれるので、
     * ここで無条件に `new PlaneGeometry` すると**遊ぶたびに捨てジオメトリが増える**
     * （使われないので画面には出ないぶん、気づけない類いの溜まり方）
     */
    if (this.pool.length < want * 3) {
      const geo = new THREE.PlaneGeometry(1, 1);
      while (this.pool.length < want * 3) {
        const p = new GatePanel(geo);
        this.pool.push(p);
        this.group.add(p.mesh);
      }
    }
    // 1行あたり最大3択＝境界4本。maxRows 行ぶんプールする
    if (this.postPool.length < want * 4) {
      const postGeo = new THREE.BoxGeometry(1, 1, 1);
      while (this.postPool.length < want * 4) {
        const post = new GatePost(postGeo);
        this.postPool.push(post);
        this.group.add(post.mesh);
      }
    }
  }

  /**
   * @param halfWidth いまプレイヤーが動ける半幅（m）。`lateralHalfWidth()` の戻り値。
   *   ★**省略できない**（2026-08-28）。これを知らずに枠を置いていたせいで、
   *   Lv6〜10 の時限ゲートは**痩せた側が物理的に選べなかった**
   */
  update(dt: number, distance: number, centerX: number, count: number, halfWidth: number, over = 0): void {
    const g = this.g;
    this.halfWidth = halfWidth;

    // --- 出現 ---
    while (this.rows.length < g.maxRows && this.nextAt - distance <= g.spawnAhead) {
      // 帯に掛かるゲートは帯の向こう側へ送る
      for (const b of this.bands) {
        if (this.nextAt > b.from && this.nextAt < b.to) this.nextAt = b.to;
      }
      // ゴール手前は打ち止め。**通らないゲートを置き去りにしない**
      if (this.nextAt > this.stopAt) break;
      const plan = this.director.next();
      const choices = plan.choices;
      const panels = this.take(choices.length);
      const posts = this.takePosts(choices.length + 1);
      // 取れなければ出さない（プール切れ。gapMin と maxRows の設定ミスの保険）
      if (panels.length < choices.length || posts.length < choices.length + 1) {
        this.give(panels);
        this.givePosts(posts);
        break;
      }
      /*
       * ★**性格を1つだけ選ぶ。** 重ねない —— 揺れながら閉じて中身も見えない枠は、
       * 難しいのではなく**理不尽**になる（§4 の「理不尽さだけが残って学習にならない」）
       */
      const roll = Math.random();
      let mode: GateMode = 'plain';
      if (roll < g.hiddenChance) mode = 'hidden';
      else if (roll < g.hiddenChance + g.timedChance) mode = 'timed';
      else if (roll < g.hiddenChance + g.timedChance + g.slideChance) mode = 'slide';
      for (let i = 0; i < choices.length; i++) {
        if (mode === 'hidden') panels[i].paintHidden();
        else panels[i].paint(choices[i], count, over);
      }
      const paintedGain = choices.map((c) => isGain(c, count, over));
      this.rows.push({
        at: this.nextAt, choices, panels, posts, picked: -1, resolved: false, held: null, t: 0,
      revealT: -1, aimed: false,
        mode, phase: mode === 'timed' ? (Math.random() < 0.5 ? 1 : -1) : Math.random() * Math.PI * 2,
        revealed: mode !== 'hidden',
        paintedGain,
      });
      // 障害物はゲートの中点に置かれる（§4-D）。中点が帯に落ちるかどうかを一緒に渡す。
      // **拾い物まで止めると一団の前後が丸ごと空白の走行になる**ので、止めるのは障害物だけ
      const mid = (this.prevAt + this.nextAt) / 2;
      const clear = !this.bands.some((b) => mid > b.from && mid < b.to);
      this.onSchedule?.(this.prevAt, this.nextAt, clear);
      this.prevAt = this.nextAt;
      this.nextAt += plan.gapAfter;
    }

    // --- スクロールと判定 ---
    for (let r = this.rows.length - 1; r >= 0; r--) {
      const row = this.rows[r];
      const z = distance - row.at;   // 前方は -Z
      const n = row.choices.length;
      // ★境界（0..1 の n+1 個）。**絵と判定で同じ配列を使う**のが肝で、
      // 別々に計算すると「見えている枠と当たる枠がずれる」という最悪のバグになる
      const bounds = this.bounds(row, z, n);

      // ★伏せ札は手前で中身を見せる。**距離**で見せる（秒だと坂で変わる）
      if (!row.revealed && z > -g.hiddenReveal) {
        row.revealed = true;
        row.revealT = 0;
        for (let i = 0; i < n; i++) {
          row.panels[i].paint(row.choices[i], count, over);
          row.paintedGain[i] = isGain(row.choices[i], count, over);
        }
        this.onReveal?.();
      }

      /*
       * ★★**向きが変わったら塗り直す**（2026-09-21）。
       * 札は**ずっと手前で描かれる**ので、近づくまでに人数が変わる。
       * `Γ(n)` は n=3 で減り n=4 で増えるので、**塗ったときの色のままだと嘘になる**。
       * ★**ほとんどの札は一生向きが変わらない**ので、塗り直しはめったに起きない
       * （毎フレーム比べているのは真偽値1つで、テクスチャは触っていない）
       */
      if (row.revealed || row.mode !== 'hidden') {
        for (let i = 0; i < n; i++) {
          const now = isGain(row.choices[i], count, over);
          if (now === row.paintedGain[i]) continue;
          row.paintedGain[i] = now;
          row.panels[i].paint(row.choices[i], count, over);
        }
      }
      if (row.revealT >= 0) row.revealT += dt;

      /*
       * ★**時限は「いま乗っている側」を痩せさせる**（2026-08-28）。
       * 出現時の乱数だと、痩せる側と正解の側が無関係に決まるので、
       * **正解が痩せた側に来た瞬間に「どうあがいても選べない」**が起きていた。
       * 見えた瞬間の1回だけ決める（毎フレーム決め直すと追尾になって理不尽に戻る）
       */
      if (row.mode === 'timed' && !row.aimed && z > -g.timedTell) {
        row.aimed = true;
        row.phase = centerX >= 0 ? 1 : -1;
      }

      if (!row.resolved && z >= 0) {
        row.resolved = true;
        // ★確定に使ったのと**同じ配列**を演出にも使う。等分へ戻すと枠が横に飛ぶ
        row.held = bounds;
        row.picked = pickBounds(centerX, bounds, CFG.courseWidth);
        const choice = row.choices[row.picked];
        // ★上限のない人数で計算する（10³⁰⁰ まではいままでの `applyOp` と同じ値）
        let big = applyOpBig(count, over, choice);
        if (big.over === 0 && big.n < this.floor) big = { n: this.floor, over: 0 };
        const after = big.n;
        this.director.sync(after);
        this.onResolve?.({ choice, before: count, after, beforeBig: { n: count, over }, afterBig: big, x: centerX });
      }

      if (row.resolved) row.t += dt;
      const k = row.resolved ? Math.min(1, row.t / g.breakTime) : 0;

      for (let i = 0; i < n; i++) {
        // 境界から中心と幅を作る（`plain` なら従来どおり等分になる）
        const x = CFG.courseWidth * ((bounds[i] + bounds[i + 1]) / 2 - 0.5);
        const w = CFG.courseWidth * (bounds[i + 1] - bounds[i]);
        if (!row.resolved) {
          /*
           * ★**伏せ札が中身に変わる瞬間だけ、判子を押したように一度ふくらむ**（2026-08-28）。
           * カメラは揺らさない —— 通過のシェイクと混ざると
           * 「中身が出た」のか「通り抜けた」のか区別が付かなくなる
           */
          const rt = row.revealT;
          const pop = rt >= 0 && rt < g.revealPop ? 1 - rt / g.revealPop : 0;
          row.panels[i].place(x, z, w, 1 + pop * 0.30, 1);
        } else if (i === row.picked) {
          /*
           * 選んだ枠だけ「破れて」広がりながら消える。選んだ実感はここで作る。
           *
           * ★**外へはみ出させない**（2026-08-23 実機で発見）。
           * 幅を 25% 広げるのに中心を動かしていなかったので、端の枠が
           * コースの外（半幅5.5）を越えて **背景の下駄箱に重なっていた**。
           * 「ゲートが道の外に出ている」ように見える原因がこれ。
           * 広げた分だけ中心を内側へ寄せて、外側の端をコースの縁で止める。
           */
          const bw = w * (1 + k * 0.25);
          const half = CFG.courseWidth / 2;
          let bx = x;
          if (bx + bw / 2 > half) bx = half - bw / 2;
          if (bx - bw / 2 < -half) bx = -half + bw / 2;
          row.panels[i].place(bx, z, bw, 1 + k * 0.35, 1 - k);
        } else {
          // 選ばなかった枠は静かに落ちる。同じ演出にすると何を選んだか分からなくなる
          row.panels[i].place(x, z, w, 1 - k * 0.15, (1 - k) * 0.55);
        }
      }

      // 門柱は境界(0..n)に立つ。破れ演出とは連動させず、通過とともに素直にフェードアウト
      const postAlpha = row.resolved ? 1 - k : 1;
      for (let j = 0; j <= n; j++) {
        row.posts[j].place(CFG.courseWidth * (bounds[j] - 0.5), z, g.height, postAlpha);
      }

      if (k >= 1 || z > 16) {
        this.give(row.panels);
        this.givePosts(row.posts);
        this.rows.splice(r, 1);
      }
    }
  }

  /**
   * ★**枠の境界を 0..1 で返す**（n+1 個）。`plain` なら等分。
   *
   * - `slide` … 内側の境界がまとめて左右に揺れる。**乗るべき側が動く**
   * - `timed` … 近づくにつれて片側へ寄っていく。**あとで決める、ができない**
   *
   * どちらも**内側の境界だけ**動かす。両端(0 と 1)は動かさないので、
   * 枠がコースの外へ出ることは構造的に起きない
   */
  private bounds(row: Row, z: number, n: number): number[] {
    // 確定済みなら、確定の瞬間に使った境界をそのまま返す（演出中に枠を動かさない）
    if (row.held) return row.held;
    return gateBounds(row.mode, row.phase, z, n, this.g, this.halfWidth, CFG.courseWidth);
  }

  /** リトライ用（Phase 4 のリザルトから呼ぶ） */
  /** 一団の帯を空ける。@param spots 出現距離の一覧 @param half 前後に空ける幅 */
  reserve(spots: readonly { at: number }[], half: number): void {
    this.bands = spots.map((s) => ({ from: s.at - half, to: s.at + half }));
  }

  /**
   * まだ決着していないゲートを引き上げる。フィニッシュへ移る瞬間に呼ぶ。
   * 生成の打ち止め（stopAt）と二重にしてあるのは、`spawnAhead` ぶん先に作る作りなので
   * 打ち止めだけだと「作った直後に走行が終わる」端のケースが残るため
   */
  clearUnresolved(): void {
    for (let r = this.rows.length - 1; r >= 0; r--) {
      if (this.rows[r].resolved) continue;
      this.give(this.rows[r].panels);
      this.givePosts(this.rows[r].posts);
      this.rows.splice(r, 1);
    }
  }

  /**
   * @param stopAt この距離より先にはゲートを作らない
   * @param floor ゲートの結果の下限（0 なら 0 人まで行ける）
   * @param knobs このレベルのつまみ。**省略できない**（理由は constructor のコメント）
   */
  reset(startCount: number, tier: number, stopAt: number, floor: number, gapScale: number, knobs: GateKnobs, mathLv: number | null = null): void {
    this.g = knobs;
    // ★このレベルの行数ぶんだけプールを確保してから並べ始める（既定値に落ちる道を残さない）
    this.grow(knobs.maxRows);
    this.stopAt = stopAt;
    this.floor = floor;
    for (const row of this.rows) {
      this.give(row.panels);
      this.givePosts(row.posts);
    }
    this.rows.length = 0;
    this.nextAt = CFG.gate.firstAt;
    this.prevAt = 0;
    this.director.reset(startCount, tier, gapScale, mathLv);
  }

  private take(n: number): GatePanel[] {
    const out: GatePanel[] = [];
    for (let i = 0; i < n && this.pool.length > 0; i++) out.push(this.pool.pop() as GatePanel);
    return out;
  }

  private give(panels: GatePanel[]): void {
    for (const p of panels) {
      p.hide();
      this.pool.push(p);
    }
  }

  private takePosts(n: number): GatePost[] {
    const out: GatePost[] = [];
    for (let i = 0; i < n && this.postPool.length > 0; i++) out.push(this.postPool.pop() as GatePost);
    return out;
  }

  private givePosts(posts: GatePost[]): void {
    for (const p of posts) {
      p.hide();
      this.postPool.push(p);
    }
  }
}

