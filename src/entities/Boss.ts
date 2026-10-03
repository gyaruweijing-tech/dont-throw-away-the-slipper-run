import * as THREE from 'three';
import { Arena } from './Arena';
import { BossFigure, BOSSES } from './BossFigure';
import { CFG } from '../config';
import { buildCutoutGeometry, createCutoutMaterial } from './Cutout';
import { rivalParts } from './cutoutLayout';
import { charAtlas } from '../tex/atlas';
import { paperGrain } from '../tex/paper';
import { bubbleLines, LINES } from './Obstacle';
import type { Crowd } from './Crowd';

const P = CFG.palette;
/** ★社員の大きさ。**1か所にまとめる**（喋る動きの伸縮もここから作る） */
const SYAIN_SCALE = 2.6;

const B = CFG.boss;

/** 1体ぶんの出現予定 */
export interface RivalSpot {
  /** 出現距離 */
  readonly at: number;
  /** 人数（＝HP） */
  readonly hp: number;
  /**
   * ★**相手の顔**（2026-09-12・本人指定）。省くと `'crowd'`（反対派の一団）。
   *
   * ★**ロジックは完全に同じ。変わるのは絵だけ**（本人の言葉:
   * 「少し集団とは差を付けたいけど、ほとんど同じでいい。ボス戦も同じ戦い方しているし。
   * 変えるとしたらエフェクトぐらいでロジックは完全に同じでいい」）。
   * ★**`'syain'` は絶対に最後の spot にしないこと** —— `isBoss` / `bossAt` が
   * 「最後の一団＝ボス」で判定している（下のガードで守ってはいる）
   */
  readonly kind?: 'crowd' | 'syain';
}

/**
 * 反対派の一団 ／ ボス（PROGRESS §4-F・§14-B-1）。**「信じていない側の群れ」**として置く。
 *
 * §4-G が「味方は死なずグレーになって離脱する」と決めているので、その鏡像で作る:
 * ボスは怪物ではなく**灰色の群衆**で、HP ＝ 相手の人数。1対1で相殺して両方が減り、
 * 削り切れば**説得できた側がこちらに加わる**（`joinRatio`）。倒すのではなく黙らせる。
 *
 * **位置取りの余地を1個だけ残す**（§4-F の要求）:
 *  - 真正面 ＝ 重なりが最大 ＝ 交換が最速。**勝てるなら一番安く突破できる**
 *  - 端に寄る ＝ 重なりが減って交換が遅くなる ＝ **突破は諦めるかわり味方を残せる**
 *  - ボスの幅はコースの操作帯より広い（`halfW` 4.3 vs ±4.6）ので、**完全には避けられない**。
 *    避けきれるようにすると「寄せておけば無傷」になって選択が消える（社員の輪で一度やらかしている）
 *
 * 実在の個人が識別できる造形にしない。**役職・機能として置く**（§4-D のレッドライン）。
 */
export class Boss {
  readonly group = new THREE.Group();

  /** 残っている相手の人数。0 で突破 */
  hp = 0;
  active = false;
  /** 0..1 接近度。カメラの寄せと HUD の警告に使う */
  near = 0;

  /**
   * 突破した瞬間。
   * @param joined こちらに加わった人数
   * @param isBoss ★広場のボスを倒したか（道中の一団のすれ違い突破と区別する・2026-09-06）
   */
  onBreak?: (joined: number, isBoss: boolean) => void;
  /** 相殺が起きているあいだ（音を鳴らす側で間引く） */
  /**
   * ★**壁で止めているか**（2026-08-28）。`Game` はこれを見て走行を凍らせ、状態を `BOSS` にする。
   * 立つのは**そのレベルの最後の一団だけ**（道中の一団はすれ違うまま）
   */
  holding = false;
  /** ★**削り切れずに負けたか。** `Game` はこれを見てその場でリザルトへ送る */
  lost = false;
  /**
   * ★**バトルリング**（2026-08-28）。**`Boss` が持つ**ことで、
   * 出る／消えるがボスと完全に連動する（別々に持つと「後ろに置き去り」が起きる）
   */
  readonly arena = new Arena();

  /**
   * ★**ボスの巨体**（2026-08-28）。**ボス回だけ**これを出し、
   * 道中の一団は今までどおり小さい人の群れのまま。
   * 「一団＝群衆／ボス＝1体」と役割が分かれているほうが、5本ごとの区切りが立つ
   */
  readonly figure = new BossFigure();
  /** のけぞり。殴られるたびに増え、少しずつ戻る */
  private lean = 0;
  /**
   * ★★**倒れ切る**（2026-09-16・本人「斜めに倒れて途中で止まってよくわからない。床まで倒れ切っていい」）。
   * 前は `lean` を 4.5（約57°）で止めていた。**後ろ（城の側）へ**、だんだん速く、床まで倒す。
   * ★**前へ倒さない理由**: 絵は板なので、前へ90°倒すと**裏を上にして寝る**（表の絵が見えなくなる）
   */
  private fall = 0;
  private fallV = 0;
  private landed = false;
  /** ★床に着いた瞬間（1回だけ）。砂煙と揺れを `Game` が出す。z はボスの位置、height は身長 */
  onLanded?: (z: number, height: number) => void;

  /**
   * ★**このレベルがボス回か**（2026-08-28）。**5の倍数のレベルだけ true。**
   *
   * ここを分けないと、道中の一団まで走行を止めてバトルリングを出してしまい、
   * **「5本ごとにボス」という区切りが完全に消える**（1レベルに3回ボス戦が起きる）。
   * 本人が「できていないこと」の筆頭に挙げたのが**まさにこの区切り**なので、
   * バトルリングを出す前に、ここを先に決めておく必要があった
   */
  private bossLevel = false;
  /** 前回の挑戦で削り残した HP。`advance()` が広場のボスにだけ適用する */
  private carry = 0;
  /**
   * ★**何体目のボスか**（0 = Lv5 の①同僚たち … 3 = Lv20 の④決裁）。
   * 2026-09-06 まで**4体とも①の絵**で通していた（本人「ボスが5も15も同じだったけど」）。
   * 参考画像は 8/28 に渡されていて `assets/ref/` にある。表を引くだけにしてある
   */
  private bossIndex = 0;

  /**
   * ★**この一団が「ボス」か。** ボス回の、最後の一団だけ。
   * ★**走行を止める判断とバトルリングを出す判断は、必ずここ1つを見る**
   * （別々に書いて実際に食い違った・2026-08-28 実機で発見）
   */
  private get isBoss(): boolean {
    // ★社員は絶対にボスにしない（2026-09-12）。広場・城・凱旋は一団のもの
    return this.bossLevel && this.kind !== 'syain' && this.si === this.spots.length - 1;
  }

  /**
   * ★**「いま出ている相手がボスか」を外から見る**（2026-09-12）。
   *
   * 検品（2026-09-12 朝）がこう積んでいた: `Game` の持ち越し HP の保存が
   * `bossAt !== null`（＝**レベル単位**）で判定していて、
   * 「いま負けた相手がボスか」ではない。
   * ★**ボス回の道中に一団を置いた瞬間に顕在化する**と書かれており、
   * 2026-09-12 に社員を道中の spot にしたので、**まさにその瞬間が来た**。
   */
  get isBossNow(): boolean {
    return this.isBoss;
  }

  /**
   * ★**広場のボスが立っている距離**（2026-09-06）。ボス回でなければ `null`。
   *
   * `isBoss` が「いま出ている一団がボスか」を見るのに対し、こちらは**走り出す前から決まっている
   * 場所**を返す。壁を逃がす区間・ゲートの打ち止め・ステージの終端が、この1つの値を見る。
   * ★**同じ判断が2か所にある**を避けるため、`Game` はここ以外からボスの位置を計算しない
   */
  get bossAt(): number | null {
    if (!this.bossLevel || this.spots.length === 0) return null;
    /*
     * ★**社員の spot はボスではない**（2026-09-12）。
     * 並びの最後を無条件に返すと、ボス回の最後に社員を置いた瞬間に
     * **広場の位置・ゲートの打ち止め・ステージの終端が全部ずれる**。
     */
    for (let i = this.spots.length - 1; i >= 0; i--) {
      if (this.spots[i].kind !== 'syain') return this.spots[i].at;
    }
    return null;
  }

  onClash?: () => void;

  /** このレベルの出現予定。**1体ずつしか画面に居ないので mesh は使い回す** */
  private spots: readonly RivalSpot[] = [];
  private si = -1;
  private at = Infinity;
  private startHp = 0;
  private acc = 0;
  /** 決着済み（突破した／帯を通り過ぎた） */
  private settled = false;
  private t = 0;

  private readonly mesh: THREE.InstancedMesh;
  /**
   * ★**社員の姿**（2026-09-12）。**1 体だけ**なので InstancedMesh にしない。
   * `Syain.ts` が使っていたのと**同じ切り抜き**（`rivalParts('syain')` ・倍率 2.0）。
   * ★絵を作り直さないのが大事 —— 本人の指定は「今のところはいまのまでいい」
   */
  private readonly syainFigure: THREE.Mesh;
  /**
   * ★**「スリッパよこせ…」のフキダシ**（2026-09-12・本人の思いつき）。
   *
   * ★**文字にしなかった理由を残す。** 本作は§4-D ・§4-I で
   * **言語不要**（海外のポータルに出す前提）を硬い要件にしていて、
   * 人事部のフキダシも「…」という**記号だけ**だった。
   * だから**スリッパの絵を描いて、その横に「！」を添える**形にした。
   * 意味は同じ（「そのスリッパをよこせ」）で、**訳さなくても伝わる**。
   * 主人公がスリッパを抱えて走っているので（§0 確定事項）、絵だけで繋がる
   */
  private readonly syainBubble: THREE.Sprite;
  /** いま出ている相手の顔。`advance()` で spot から拾う */
  private kind: 'crowd' | 'syain' = 'crowd';
  private readonly slots: { x: number; y: number; z: number }[] = [];
  private readonly bar: THREE.Mesh;
  private readonly barMat: THREE.MeshBasicMaterial;
  /** HP バーの受け皿（減らない側）。満タンの幅を示すために要る */
  private readonly barBack: THREE.Mesh;
  private readonly barBackMat: THREE.MeshBasicMaterial;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3(1, 1, 1);

  constructor() {
    // **敵は役職として描き分ける**（§14）。色違いではなく別の絵にした
    const geo = buildCutoutGeometry(rivalParts('hr'));
    const n = B.maxDrawn;
    const phase = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    // aFade = 1 ＝ シェーダの uGrey 側に振り切る。**離脱した味方と同じ灰色**になる（§4-G）
    const fade = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1);
    const tint = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1);
    geo.setAttribute('aPhase', phase);
    geo.setAttribute('aFade', fade);
    geo.setAttribute('aTint', tint);

    /*
     * **色は灰色ではなく判子の赤にする。**
     * 当初は §4-G の「離脱した味方＝灰色」の鏡像として灰色にしたが、
     * **離脱していく味方と見分けがつかず「増えてるのか減ってるのか敵なのか分からない」**
     * と実機で言われた（2026-08-22）。意味の一貫性より、まず敵だと分かることを優先する。
     * シェーダの `uGrey` を赤に差し替えるだけで済む（aFade=1 で全員そちらへ振り切る）。
     */
    // 立ちはだかっているので cadence 0（走らない）
    const mat = createCutoutMaterial(charAtlas(), { cadence: 0, grain: paperGrain(512) });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;

    // **手前の列から並べる。** 減ったぶんは先頭から捨てて描くので、
    // **ぶつかっている側の列から消えて**いき、相殺しているように見える
    const perRow = B.perRow;
    const span = (B.halfW * 2) / perRow;
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      this.slots.push({
        x: (col - (perRow - 1) / 2) * span + (row % 2) * span * 0.5,
        y: 0,
        z: -row * B.rowDepth,
      });
      phase.setX(i, Math.random() * Math.PI * 2);
    }

    // 締め切り線。残り人数の帯（§4-I の書類の語彙。数字は HUD 側が出す）
    /*
     * ★**HP バー**（2026-08-28 に作り直し・本人の参考画像 Count Control Legends 型）。
     *
     * 「**HP を上に表示させて、ボス戦っていうのを分かりやすくするといい**」。
     * 前は朱の帯1枚だけで、**バトルリング（同じ朱）の上に出すと同化して読めなかった**ので、
     * ★**濃い茶の受け皿を1枚下に敷いて、その上を朱が減っていく**形にした。
     * 受け皿は減らない ＝ **満タンがどこかが分かる**（帯だけだと「短い」のか「元から短い」のか不明）
     */
    const barGeo = new THREE.BoxGeometry(1, 0.26, 0.16);
    this.barBackMat = new THREE.MeshBasicMaterial({ color: 0x4a3524, transparent: true, opacity: 0.9 });
    this.barBack = new THREE.Mesh(barGeo, this.barBackMat);
    this.barBack.scale.x = B.halfW * 2;
    this.barBack.renderOrder = 3;

    this.barMat = new THREE.MeshBasicMaterial({ color: P.stamp, transparent: true, opacity: 0.95 });
    this.bar = new THREE.Mesh(barGeo, this.barMat);
    this.bar.renderOrder = 4;
    this.bar.position.z = 0.02;   // 受け皿より必ず手前

    /*
     * ★**社員の姿とフキダシ**（2026-09-12）。
     * 起動時に 1 体だけ作って使い回す（`mesh` と同じ作法）。
     * 社員の spot が無いレベルでも作るのは、**実行中に確保しない**ため
     * （携帯のブラウザで効く。`SyainPack` も同じ理由でそうしていた）
     */
    this.syainFigure = new THREE.Mesh(
      buildCutoutGeometry(rivalParts('syain')),
      createCutoutMaterial(charAtlas(), { cadence: 0, grain: paperGrain(512) }),
    );
    // ★2026-09-13: 2.0 → 2.6（本人「社員ももっと大きくして敵っていう感じを出してほしい」）
    this.syainFigure.scale.setScalar(SYAIN_SCALE);
    this.syainFigure.visible = false;

    this.syainBubble = bubbleLines(LINES.syain);
    this.syainBubble.visible = false;

    this.group.add(this.mesh, this.syainFigure, this.syainBubble, this.barBack, this.bar);
    this.group.visible = false;
  }

  /**
   * @param centerX 主人公の横位置
   * @returns 相殺で減った論理人数
   */
  update(dt: number, distance: number, crowd: Crowd, centerX: number): number {
    if (this.at === Infinity) return 0;
    this.t += dt;

    // 前方は -Z。ゲートと同じ座標の作り方にしておくと配置がズレない
    const z = distance - this.at;
    /*
     * ★**バトルリングは「ボス回の、最後の一団」だけ**（2026-08-28）。
     *
     * 最初 `bossLevel` だけで出したら、**Lv5 の 140m にいる道中の一団にもリングが出た**
     * （実機で発見）。走行を止める条件とリングを出す条件が**別々に書かれていた**のが原因で、
     * 「同じ判断が2か所にある」典型。★**`isBoss` 1つに集約した**
     */
    if (this.isBoss && z >= -B.showFrom && z <= B.despawnZ) this.arena.place(z);
    else this.arena.hide();

    if (z < -B.showFrom) { this.group.visible = false; this.figure.hide(); this.near = 0; return 0; }
    if (z > B.despawnZ) {
      this.group.visible = false;
      this.figure.hide();
      this.active = false;
      this.near = 0;
      // 次の一団へ。**プールを増やさず1体を使い回す**（間隔が十分あるので同時に2体は出ない）
      this.advance();
      return 0;
    }

    this.active = !this.settled;
    this.group.visible = true;
    this.group.position.z = z;
    this.near = THREE.MathUtils.clamp(1 - Math.abs(z) / B.showFrom, 0, 1);
    this.draw(dt);

    if (this.settled || Math.abs(z) > B.clashZ) return 0;

    /*
     * ★**壁で止まるボス戦**（2026-08-28・本人指定「止まって数をぶつける」）。
     *
     * 立つのは**そのレベルの最後の一団だけ**。道中の一団まで止めると
     * 1本の走行が何度も途切れて、**ボスが事件でなくなる**。
     * （Step2 で道中の `rivals` を消せば、これは自動的に「5本目だけ」になる）
     */
    /*
     * ★★**2026-09-07: 道中の一団も止まって殴り合う**（本人指定）。
     *
     * 9/6 に道中の一団を全部消したのは、「一団＝ボス」の約束を作るためだった。
     * 本人の答えは「**一団はあってほしい。戦う速度も演出もボスと同じでいい**」。
     * ボスを特別にしているのは**広場・城・凱旋・判子CLEAR**のほうで、殴り合いそのものではない。
     * だから殴り合いは全部の一団に開放し、isBoss は**広場の演出だけ**を持つ役に戻した。
     *
     * すれ違い相殺（この下）は everyRivalHolds を false にすれば戻る。**データで戻せる形に残す**
     */
    if (B.everyRivalHolds || this.isBoss) {
      if (z >= -B.stopZ) this.holding = true;
      return this.holding ? this.brawl(dt, crowd) : 0;
    }

    // --- 重なり ＝ 位置取りの効き目（道中の一団は今までどおりすれ違う） ---
    const r = Math.max(0.6, Math.min(crowd.visualRadiusX, B.halfW));
    const lo = Math.max(-B.halfW, centerX - r);
    const hi = Math.min(B.halfW, centerX + r);
    const overlap = THREE.MathUtils.clamp((hi - lo) / (2 * r), 0, 1);
    if (overlap <= 0) return 0;

    // 交換の速さは相手の人数で決める。**帯を通り抜ける時間は一定**なので、
    // 大人数のボスでも「1人ずつ延々」にならない（壇の payTime と同じ考え方）
    const rate = Math.max(B.rateMin, this.startHp / B.clashTime);
    this.acc += rate * overlap * dt;
    const step = Math.floor(this.acc);
    if (step <= 0) return 0;
    this.acc -= step;

    // **1対1で相殺**（§4-F）。ただし最後の1人は残す ＝ 事故で全滅させない（NPC の原則）
    const room = Math.max(0, crowd.count - CFG.minSurvivors);
    const n = Math.min(step, Math.ceil(this.hp), room);
    if (n <= 0) return 0;

    this.hp -= n;
    const lost = crowd.remove(n);
    /*
     * ★★**理系用は桁も奪う**（2026-09-26・`DigitHit`）。殴り合いで削った HP の割合だけ、
     * 一団なら `rival`・ボスなら `boss` の割合の桁を少しずつ奪う（勝ち切ると満額）。ほかのモードは何もしない
     */
    if (crowd.digitHit) {
      const d = crowd.digitHit;
      crowd.shrinkDigits(((this.isBoss ? d.boss : d.rival) * n) / Math.max(1, this.startHp));
    }
    // ★殴られた手応え。角度だけで「効いている」を出す（新しい語彙は増やさない）
    this.lean = Math.min(1, this.lean + 0.10);
    this.onClash?.();

    if (this.hp <= 0) {
      this.hp = 0;
      this.settled = true;
      this.active = false;
      // 黙らせた側がこちらに加わる。**これが突破の報酬**で、端に逃げると手に入らない
      const joined = Math.round(this.startHp * B.joinRatio);
      crowd.add(joined);
      if (this.isBoss) this.wonBoss = true;
      this.onBreak?.(joined, this.isBoss);
    }
    return lost;
  }

  /**
   * ★**殴り合いの速さ（人/秒）**（2026-09-11）。**計算はここ1か所だけ**にする。
   *
   * ★**`rateMin` を掛けない。** すれ違い相殺（`update()`）は「帯を通る約1.3秒」という
   * 時間の制約があるので下限が要るが、殴り合いは**走行を止めている**ので制約が無い。
   * ここに下限を入れていたせいで、**`brawlTime` が一度も効かず Lv1 の一団は 0.25秒で
   * 終わっていた**（2026-09-11 に測って発覚。`config.ts` の `rivalBrawlTime` のコメント）。
   *
   * ★**8/28 の「同じ判断が2か所にある」事故と同じ型を避ける**ため、
   * 長さを決める式はこのゲッターに集約した（`update()` 側は相殺用で別の式のまま）。
   * `startHp` は満タン基準なので、**持ち越しで半分から始めても速さは変わらない**
   * （＝ 2回目は半分の時間で終わる。削った手応えが時間にも出る）
   */
  private get brawlRate(): number {
    const t = this.isBoss ? B.brawlTime : B.rivalBrawlTime;
    return this.startHp / Math.max(0.1, t);
  }

  /**
   * ★**殴り合い**（2026-08-28）。止まっているあいだ、**1対1で削り合う**。
   *
   * ★**勝敗は始まった時点で決まっている**（人数 > HP なら必ず勝つ）。
   * それでも見せるのは、**「数をぶつけた」という手応えがここにしか無い**から。
   *
   * ★**長さは `brawlRate` が決める**（2026-09-11）。ボスは `brawlTime` 5.5秒、
   * 道中の一団は `rivalBrawlTime` 2.6秒。**相手の大きさに関係なく一定**にしてある。
   * （8/28 の「短いほどよい」は効率で測った判断で、9/6 に本人が明示的に上書きした）
   *
   * @returns この1フレームで減った論理人数
   */
  private brawl(dt: number, crowd: Crowd): number {
    this.acc += this.brawlRate * dt;
    const step = Math.floor(this.acc);
    if (step <= 0) return 0;
    this.acc -= step;

    // 最後の1人は残す（障害物・NPC と同じ原則）。**残り1人になったら削れない ＝ 負け**
    const room = Math.max(0, crowd.count - CFG.minSurvivors);
    const n = Math.min(step, Math.ceil(this.hp), room);
    if (n <= 0) {
      if (this.hp > 0) {
        // ★**削り切れなかった。** 止まったまま永遠に殴り続けるとゲームが固まるので、
        // ここで必ず決着させる（`Game` が拾ってリザルトへ送る）
        this.lost = true;
        this.holding = false;
      }
      return 0;
    }

    this.hp -= n;
    const lost = crowd.remove(n);
    /*
     * ★★**理系用は桁も奪う**（2026-09-26・`DigitHit`）。殴り合いで削った HP の割合だけ、
     * 一団なら `rival`・ボスなら `boss` の割合の桁を少しずつ奪う（勝ち切ると満額）。ほかのモードは何もしない
     */
    if (crowd.digitHit) {
      const d = crowd.digitHit;
      crowd.shrinkDigits(((this.isBoss ? d.boss : d.rival) * n) / Math.max(1, this.startHp));
    }
    this.onClash?.();

    if (this.hp <= 0) {
      this.hp = 0;
      this.settled = true;
      this.active = false;
      this.holding = false;   // ★壁が破れる ＝ 走行が再開する
      const joined = Math.round(this.startHp * B.joinRatio);
      crowd.add(joined);
      if (this.isBoss) this.wonBoss = true;
      this.onBreak?.(joined, this.isBoss);
    }
    return lost;
  }

  /**
   * ★**このレベルのボスを倒したか**（リザルトの段数がこれで決まる）。
   *
   * ★**2026-09-06 夜のバグ修正。** 前は `settled && hp <= 0` を返していたが、
   * `settled` は**1体ぶんの状態**で、ボスが後ろへ流れて `advance()` に入ると `false` に戻る。
   * 達成感の演出（勝ってから城の門まで 40m 歩く）を入れた瞬間に**必ずそこを通る**ので、
   * ★**倒したのにリザルトが 0段・コイン 0** になった（実機の手動ステップで発見）。
   * 走行が続いても下ろさない旗として持ち直す —— 下ろすのは `reset()`（＝次の挑戦）だけ
   */
  get broken(): boolean {
    return this.wonBoss;
  }
  /** 上の旗の実体。**`advance()` では絶対に触らない** */
  private wonBoss = false;

  /**
   * @param spots このレベルで出す一団の一覧（距離の昇順）。空 ＝ 1体も出ない。
   * **道中に2〜4回出すのが §14-B-1 の本体**で、一番大きい最後の1体が「ボス」になる。
   */
  /**
   * @param carry ★**前回の挑戦で削り残した HP**（2026-09-06・本人指定）。0 なら満タンから。
   *   「1回目で半分削った → 2回目はその半分から始まる」。**広場のボスにだけ効く**（道中の一団は毎回満タン）
   */
  /** @param bossIndex ★何体目のボスか（`Math.floor(level / 5)`）。絵を選ぶのに使う */
  reset(spots: readonly RivalSpot[], bossLevel: boolean, carry = 0, bossIndex = 0): void {
    this.spots = spots;
    this.bossLevel = bossLevel;
    this.carry = carry;
    this.bossIndex = bossIndex;
    // ★旗を下ろすのはここだけ（`advance()` では触らない）
    this.wonBoss = false;
    this.si = -1;
    this.advance();
  }

  /** 次の予定へ進む。予定を使い切ったら二度と出ない */
  private advance(): void {
    this.si++;
    const s = this.spots[this.si];
    this.at = s ? s.at : Infinity;
    this.hp = s ? s.hp : 0;
    // ★顔もここで拾う。**`isBoss` がこれを見るので、hp より先に決まっている必要がある**
    this.kind = s?.kind ?? 'crowd';
    /*
     * ★**満タンの値は持ち越しでも動かさない**（2026-09-06）。
     *
     * HP バーの幅は `hp / startHp` なので、ここに持ち越した値を入れると
     * **半分まで削ったボスが、次の挑戦では満タンのバーで出てくる** ＝ 削った意味が絵から消える。
     * 交換の速さ（`brawl` の rate）と加わる人数（`joinRatio`）も満タン基準のままにしておく。
     * ★**動かすのは `hp` だけ**
     */
    this.startHp = Math.max(1, this.hp);
    if (this.isBoss && this.carry > 0 && this.carry < this.hp) this.hp = this.carry;
    this.acc = 0;
    this.settled = false;
    this.active = false;
    this.near = 0;
    /*
     * ★**壁の状態も必ず戻す**（2026-08-28）。1体を使い回す作りなので、
     * ここで戻し忘れると**次の一団が最初から止まった状態で出る**。
     * `REVIEW.md` の急所5「消す処理が hide() にあるか」と同型の穴
     */
    this.holding = false;
    this.lost = false;
    this.arena.hide();
    this.figure.hide();
    // ★消す処理を hide() に集める（REVIEW.md の急所⑤）。社員だけ残る事故を防ぐ
    this.syainFigure.visible = false;
    this.syainBubble.visible = false;
    this.lean = 0;
    this.fall = 0;
    this.fallV = 0;
    this.landed = false;
    this.group.visible = false;
    this.mesh.count = 0;
  }

  /** @param dt 殴りの動きに要る（2026-09-14） */
  private draw(dt: number): void {
    const frac = this.startHp > 0 ? Math.max(0, this.hp / this.startHp) : 0;

    /*
     * ★**ボス回は「巨体1体」、道中の一団は今までどおり「群衆」**（2026-08-28）。
     * 本人のイメージ:「でっかいボス一匹。そこに集団の我々が突っ込んでいく」。
     * 役割で見た目を分けることで、**5本ごとの区切り**が絵として立つ
     */
    /*
     * ★**社員**（2026-09-12・本人指定で「逃げる相手」から「戦って倒す相手」へ）。
     *
     * ★**ここで分岐するのは絵だけ。** 止まる・殴り合う・削り切る・加わるは
     * 一団・ボスと**完全に同じコード**を通る（`update` / `brawl` は一切見ていない）。
     * 本人の指定そのまま:「変えるとしたらエフェクトぐらいでロジックは完全に同じでいい」。
     *
     * ★**口の伸縮は残した。** `Syain.ts` の「がーがー」は体を縦に伸ばす動きで作っていて、
     * これが社員の性格そのものだった。騒音の輪（ダメージ）は廃止したが、
     * **うるさいという見た目は残す**のが§4-D の意図に近い
     */
    if (this.kind === 'syain') {
      this.mesh.count = 0;
      this.figure.hide();
      const open = (0.5 + 0.5 * Math.sin(this.t * 9)) * 0.8;
      this.syainFigure.scale.set(SYAIN_SCALE - open * 0.13, SYAIN_SCALE + open * 0.29, SYAIN_SCALE);
      this.syainFigure.position.y = open * 0.10;
      this.syainFigure.visible = true;
      this.syainBubble.position.set(0, 4.7, 0.2);
      this.syainBubble.visible = this.active;
      const top = 4.05;
      this.bar.position.y = top;
      this.barBack.position.y = top;
      this.barBack.visible = this.active;
      this.bar.visible = this.active;
      const fullS = B.halfW * 2;
      const wS = Math.max(0.001, fullS * frac);
      this.bar.scale.x = wS;
      this.bar.position.x = -(fullS - wS) / 2;
      this.barMat.opacity = 0.95;
      return;
    }
    this.syainFigure.visible = false;
    this.syainBubble.visible = false;

    if (this.isBoss) {
      this.mesh.count = 0;
      this.figure.build(BOSSES[this.bossIndex % BOSSES.length]);
      /*
       * のけぞりは殴られた瞬間に増え、離すと戻る（`brawl` から積む）。
       * ★**決着したあとは戻さず、そのまま倒す**（2026-09-06）。
       * 凱旋（`Game` の CLEAR）で城まで歩いていくあいだ、ボスは画面の中を後ろへ流れていく。
       * 立ったまま流れると「**倒したのに立っている**」になり、達成感がその場で消える。
       * 新しい語彙は増やさない —— **のけぞりの角度をそのまま伸ばすだけ**
       */
      if (this.settled) {
        // のけぞりは戻しながら、後ろへ倒す。**重力のように加速**させると「重いものが倒れた」になる
        this.lean = Math.max(0, this.lean - dt * 3);
        if (!this.landed) {
          this.fallV += B.fallAccel * dt;
          this.fall = Math.min(Math.PI / 2, this.fall + this.fallV * dt);
          if (this.fall >= Math.PI / 2) {
            this.landed = true;
            this.onLanded?.(this.group.position.z, this.figure.height);
          }
        }
      } else {
        this.lean = Math.max(0, this.lean - 0.06);
      }
      this.figure.place(this.group.position.z, frac, this.lean, this.fall);
      // ★殴り合っているあいだだけ、腕を振って体が弾む（2026-09-14）。
      // **`place` のあと**に呼ぶ ―― `place` が position.y を書くので、順が逆だと弾みが消える
      this.figure.setPunch(dt, this.holding);
      const top = this.figure.height * 1.06;
      this.bar.position.y = top;
      this.barBack.position.y = top;
      this.barBack.visible = this.active;
      this.bar.visible = this.active;
      const full = B.halfW * 2;
      const w = Math.max(0.001, full * frac);
      this.bar.scale.x = w;
      this.bar.position.x = -(full - w) / 2;
      this.barMat.opacity = 0.95;
      return;
    }
    this.figure.hide();

    // **一団の大きさは人数で決める。** maxDrawn 固定にすると、
    // 30人の一団も260人の一団も同じ壁に見えて「今回は重い」が伝わらない
    const total = Math.min(B.maxDrawn, Math.max(B.minDrawn, Math.ceil(this.startHp)));
    const shown = Math.min(total, Math.ceil(total * frac));
    // 減ったぶんは**手前の列から**捨てる。奥の列が残るので「押し返されている」に見える
    const gone = total - shown;
    for (let j = 0; j < shown; j++) {
      const s = this.slots[gone + j];
      // 立ったまま少しだけ揺れる。完全な静止だと書き割りに見える
      this.v.set(s.x + Math.sin(this.t * 1.6 + j) * 0.04, s.y, s.z);
      this.m.compose(this.v, this.q, this.sc);
      this.mesh.setMatrixAt(j, this.m);
    }
    this.mesh.count = shown;
    this.mesh.instanceMatrix.needsUpdate = true;

    /*
     * ★**左端そろえで減らす**（2026-08-28）。中央から両側に縮むと
     * 「どちらへ減っているか」が読めない。左端を固定すると**残量として読める**
     */
    const full = B.halfW * 2;
    const w = Math.max(0.001, full * frac);
    this.bar.scale.x = w;
    this.bar.position.x = -(full - w) / 2;
    this.barMat.opacity = 0.95;
    /*
     * ★**バーの高さはボスの背丈に連動させる**（2026-08-28）。
     * 2.5m 固定のままだと、巨人ボスを入れた瞬間に**顔の高さに帯が重なる**
     */
    const top = 2.5 + B.rowDepth * 0.5;
    this.bar.position.y = top;
    this.barBack.position.y = top;
    this.barBack.visible = this.active;
    this.bar.visible = this.active;
  }
}
